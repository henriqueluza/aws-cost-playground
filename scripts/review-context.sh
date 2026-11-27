#!/usr/bin/env bash
# Coleta o que o revisor automático de PR lê, antes de o agente começar (#364).
#
# O agente não tem shell nem `gh`: recebe estes arquivos como DADO. Tudo aqui vem de quem abriu
# ou comentou o PR e não é instrução para ninguém. Só entram comentários de dois autores: o bot
# do workflow (com o marcador da revisão) e o autor do PR (a "Resposta à revisão" da skill
# address-review). Comentário de qualquer outra conta fica de fora, com ou sem marcador.
#
# Uso:  review-context.sh <numero-do-pr> <diretorio-de-saida>
# Env:  GH_TOKEN (somente leitura basta), GH_REPO (dono/repo),
#       REVIEW_WAIT_SECONDS (padrão 600) e REVIEW_POLL_SECONDS (padrão 15): espera dos checks.
set -euo pipefail

MARKER='<!-- review-pr -->'
BOT='github-actions[bot]'
OWN_WORKFLOW='review-pr'

pr="${1:-}"
out="${2:-}"
repo="${GH_REPO:-}"
[[ "$pr" =~ ^[1-9][0-9]{0,8}$ ]] || { echo "número de PR inválido" >&2; exit 2; }
[ -n "$out" ] || { echo "uso: review-context.sh <pr> <dir>" >&2; exit 2; }
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "GH_REPO inválido" >&2; exit 2; }
wait_seconds="${REVIEW_WAIT_SECONDS:-600}"
poll_seconds="${REVIEW_POLL_SECONDS:-15}"
[[ "$wait_seconds" =~ ^[0-9]+$ && "$poll_seconds" =~ ^[0-9]+$ ]] || { echo "espera inválida" >&2; exit 2; }

mkdir -p "$out"

gh pr view "$pr" --json number,title,body,author,labels,baseRefName,headRefName,headRefOid,commits >"$out/pr.json"
gh pr diff "$pr" >"$out/diff.patch"
gh pr diff "$pr" --name-only >"$out/files.txt"
author="$(jq -r '.author.login // ""' "$out/pr.json")"

# Issues citadas no corpo do PR (no máximo 5). Só o número sai do corpo; o resto vem da API.
issues="$(jq -r '.body // ""' "$out/pr.json" |
  { grep -oiE '(closes|fixes|resolves|parte de|refs) #[0-9]{1,9}' || true; } |
  { grep -oE '[0-9]+$' || true; } | awk '!seen[$0]++' | head -n 5)"
: >"$out/issues.jsonl"
for number in $issues; do
  gh issue view "$number" --json number,title,body,labels,state >>"$out/issues.jsonl" 2>/dev/null || true
done

# Rodadas anteriores: autor esperado E forma esperada. O marcador sozinho não basta.
gh api --paginate "repos/$repo/issues/$pr/comments" |
  jq -s --arg bot "$BOT" --arg marker "$MARKER" --arg author "$author" '
    (add // []) | map(select(
      (.user.login == $bot and .user.type == "Bot" and (.body | startswith($marker)))
      or ($author != "" and .user.login == $author and .user.type == "User"
          and (.body | test("^[#\\s]*Resposta à revisão")))
    )) | map({id, author: .user.login, created_at, updated_at, body})' >"$out/comments.json"

# Testes, lint e build rodam nos outros workflows do PR, sem token de escrita e sem o segredo do
# agente. Aqui só se espera o resultado, que também é dado.
deadline=$((SECONDS + wait_seconds))
while :; do
  gh pr checks "$pr" --json name,state,bucket,workflow >"$out/checks.raw" 2>/dev/null || true
  jq -e 'type == "array"' "$out/checks.raw" >/dev/null 2>&1 || echo '[]' >"$out/checks.raw"
  jq --arg own "$OWN_WORKFLOW" 'map(select(.workflow != $own))' "$out/checks.raw" >"$out/checks.json"
  total="$(jq 'length' "$out/checks.json")"
  pending="$(jq 'map(select(.bucket == "pending")) | length' "$out/checks.json")"
  if [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then break; fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "checks ainda pendentes depois de ${wait_seconds}s: seguem como pendentes" >&2
    break
  fi
  sleep "$poll_seconds"
done
rm -f "$out/checks.raw"

echo "contexto em $out: $(wc -l <"$out/files.txt" | tr -d ' ') arquivo(s) no diff," \
  "$(jq 'length' "$out/comments.json") comentário(s) de rodada anterior, $total check(s), $pending pendente(s)"
