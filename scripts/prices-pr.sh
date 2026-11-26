#!/usr/bin/env bash
# Abre ou atualiza o PR único com o catálogo regravado em web/public/prices/.
#
# Commit com dois pais: a árvore é sempre main + catálogo novo (o PR só mostra preços),
# e o segundo pai é a ponta anterior da branch do PR. O push vira fast-forward e o PR
# é atualizado sem force push.
# Manifest fora da comparação: ele leva a data do dia e muda em toda execução; só os
# arquivos de preço decidem se há mudança (ele vai junto no commit quando há).
#
# Uso: bash scripts/prices-pr.sh <body-file>   (cwd = raiz do repo, HEAD = main)
# Stdout: uma linha entre "sem mudança", "pr criado", "pr atualizado" e "pr fechado".
set -euo pipefail

readonly BRANCH=prices/catalogo
readonly BASE=main
readonly PRICES=web/public/prices
readonly MANIFEST=web/public/prices/manifest.json
readonly TITLE='chore(prices): atualização semanal do catálogo'
readonly EXCLUDE_MANIFEST=":(exclude)$MANIFEST"
readonly CLOSE_COMMENT='Fechado automaticamente: o catálogo gerado nesta execução é igual ao de main.'
readonly BOT_NAME='github-actions[bot]'
readonly BOT_EMAIL='41898282+github-actions[bot]@users.noreply.github.com'

die() {
  printf 'prices-pr: %s\n' "$1" >&2
  exit 1
}

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  printf 'uso: bash scripts/prices-pr.sh <body-file> (o arquivo precisa existir)\n' >&2
  exit 2
fi
readonly BODY=$1

[ "$BRANCH" != "$BASE" ] || die "BRANCH igual a BASE ($BASE): abortado"
prefix=$(git rev-parse --show-prefix)
[ -z "$prefix" ] || die "rode a partir da raiz do repositório"
head=$(git rev-parse --verify 'HEAD^{commit}')
base_ref=$(git rev-parse --verify --quiet "refs/remotes/origin/$BASE^{commit}") || base_ref=
[ "$head" = "$base_ref" ] || die "HEAD não é origin/$BASE: rode a partir do checkout de $BASE"

# Define PR com o número do PR aberto da branch, ou vazio se não houver.
# --head filtra só pelo nome: PR de fork com a mesma branch nunca é editado nem fechado.
find_open_pr() {
  PR=$(gh pr list --head "$BRANCH" --base "$BASE" --state open --json number,isCrossRepository \
    --jq '[.[] | select(.isCrossRepository | not)][0].number // empty')
  case "$PR" in
    *[!0-9]*) die "resposta inesperada de gh pr list" ;;
  esac
}

create_pr() {
  gh pr create --base "$BASE" --head "$BRANCH" --title "$TITLE" --body-file "$BODY" >&2 ||
    die "gh pr create falhou; confira se o repositório permite que o GitHub Actions crie PR (Settings > Actions > General)"
  printf 'pr criado\n'
}

# Sucesso se o índice difere de <rev> nos preços (sem o manifest); falha se é igual.
index_differs_from() {
  local rc=0
  git diff --cached --quiet "$1" -- "$PRICES" "$EXCLUDE_MANIFEST" || rc=$?
  case "$rc" in
    0) return 1 ;;
    1) return 0 ;;
    *) die "git diff falhou (código $rc)" ;;
  esac
}

# Uso: commit_tree <tree> <mensagem> -p <pai> [-p <pai>]
commit_tree() {
  local tree_sha=$1 message=$2
  shift 2
  GIT_AUTHOR_NAME=$BOT_NAME GIT_AUTHOR_EMAIL=$BOT_EMAIL \
    GIT_COMMITTER_NAME=$BOT_NAME GIT_COMMITTER_EMAIL=$BOT_EMAIL \
    git commit-tree "$tree_sha" "$@" -m "$message"
}

# Arquivos novos não rastreados contam: compara o índice, não a árvore de trabalho.
git add -A -- "$PRICES"

# (a) Igual a main: o PR aberto, se houver, perde o sentido.
if ! index_differs_from "$head"; then
  find_open_pr
  if [ -n "$PR" ]; then
    gh pr close "$PR" --comment "$CLOSE_COMMENT" >&2
    printf 'pr fechado\n'
  else
    printf 'sem mudança\n'
  fi
  exit 0
fi

# (b) A branch já existe: parte da ponta dela; igual à ponta não gera commit, mas
# abre um PR novo se não houver aberto (o anterior foi fechado ou o create falhou após o push).
tip=
rc=0
git ls-remote --exit-code origin "refs/heads/$BRANCH" >/dev/null || rc=$?
case "$rc" in
  0)
    git fetch --no-tags --depth=1 origin "refs/heads/$BRANCH" >&2
    tip=$(git rev-parse --verify 'FETCH_HEAD^{commit}')
    if ! index_differs_from "$tip"; then
      find_open_pr
      if [ -n "$PR" ]; then
        printf 'sem mudança\n'
      else
        create_pr
      fi
      exit 0
    fi
    ;;
  2) ;;
  *) die "git ls-remote falhou (código $rc)" ;;
esac

# (c) Commit sobre main com a ponta como segundo pai; push sem força (corrida falha).
tree=$(git write-tree)
msg="chore(prices): catálogo da Price List de $(date -u +%F)"
if [ -n "$tip" ] && [ "$tip" != "$head" ]; then
  commit=$(commit_tree "$tree" "$msg" -p "$head" -p "$tip")
else
  commit=$(commit_tree "$tree" "$msg" -p "$head")
fi
git push origin "$commit:refs/heads/$BRANCH" >&2

# (d) Um único PR: atualiza o corpo do aberto ou cria.
find_open_pr
if [ -n "$PR" ]; then
  gh pr edit "$PR" --body-file "$BODY" >&2
  printf 'pr atualizado\n'
else
  create_pr
fi
