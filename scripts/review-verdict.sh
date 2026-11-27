#!/usr/bin/env bash
# Publica o veredito da revisão automática de PR (#364). É o ÚNICO caminho do workflow de revisão
# para comentar e mexer em label: o agente não tem token de escrita nem shell, só devolve
# `verdict` e `body`, e este script recusa qualquer veredito fora da lista.
#
# Labels que este script toca, e nenhuma outra: review:approved, changes-requested, needs-human
# e re-review (só remoção). Nunca agent:authorized, infra:destroy-approved, skip-review nem
# size:exception.
#
# Env:  PR_NUMBER, VERDICT, BODY, GH_TOKEN (pull-requests: write), GH_REPO (dono/repo).
set -euo pipefail

MARKER='<!-- review-pr -->'
BOT='github-actions[bot]'
MAX_BODY=60000

pr="${PR_NUMBER:-}"
verdict="${VERDICT:-}"
body="${BODY:-}"
repo="${GH_REPO:-}"
[[ "$pr" =~ ^[1-9][0-9]{0,8}$ ]] || { echo "PR_NUMBER inválido" >&2; exit 2; }
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "GH_REPO inválido" >&2; exit 2; }

case "$verdict" in
  approved)
    add=("review:approved")
    remove=("changes-requested" "needs-human")
    ;;
  changes-requested)
    add=("changes-requested")
    remove=("review:approved" "needs-human")
    ;;
  needs-human)
    add=("needs-human")
    remove=("review:approved")
    ;;
  needs-human+changes-requested)
    add=("needs-human" "changes-requested")
    remove=("review:approved")
    ;;
  *)
    echo "veredito fora da lista: nada foi publicado" >&2
    exit 2
    ;;
esac
remove+=("re-review")

[ -n "${body//[[:space:]]/}" ] || { echo "comentário vazio: nada foi publicado" >&2; exit 2; }
body="${body#"$MARKER"}"
body="$MARKER"$'\n'"${body:0:$MAX_BODY}"

# Um comentário por PR: atualiza o do bot (autor E marcador), senão cria.
comment_id="$(gh api --paginate "repos/$repo/issues/$pr/comments" |
  jq -rs --arg bot "$BOT" --arg marker "$MARKER" '
    (add // []) | map(select(.user.login == $bot and .user.type == "Bot" and (.body | startswith($marker))))
    | (last | .id) // empty')"
if [ -n "$comment_id" ]; then
  jq -n --arg body "$body" '{body: $body}' |
    gh api -X PATCH "repos/$repo/issues/comments/$comment_id" --input - >/dev/null
else
  jq -n --arg body "$body" '{body: $body}' |
    gh api -X POST "repos/$repo/issues/$pr/comments" --input - >/dev/null
fi

# Primeiro sai o veredito antigo, depois entra o novo: uma falha no meio nunca deixa aprovação
# junto com pedido de mudança.
for label in "${remove[@]}"; do
  encoded="$(jq -rn --arg label "$label" '$label | @uri')"
  if ! error="$(gh api -X DELETE "repos/$repo/issues/$pr/labels/$encoded" 2>&1 >/dev/null)"; then
    case "$error" in
      *"HTTP 404"*) ;; # a label não estava aplicada
      *)
        echo "falha ao remover a label $label" >&2
        exit 1
        ;;
    esac
  fi
done
jq -n '{labels: $ARGS.positional}' --args "${add[@]}" |
  gh api -X POST "repos/$repo/issues/$pr/labels" --input - >/dev/null

echo "veredito publicado no PR #$pr: $verdict"
