#!/usr/bin/env bash
# Acha o deploy de staging de um SHA (#23). Só leitura, pela API do GitHub.
#
# Uso: scripts/find-staging-release.sh <sha de 40 caracteres>
# Env: GH_TOKEN (com `actions: read`) e GITHUB_REPOSITORY (`dono/repositório`).
#
# Imprime `<id do run> <tentativa>` do run de `deploy-staging.yml` desse SHA, e só se o
# deploy e o smoke test de staging passaram (infra/tools/release_gate.py). O workflow de
# produção chama este script antes e depois de baixar o artefato: a mesma saída nas duas
# vezes prova que o artefato baixado é o da tentativa conferida.
# Saída: 0 achou; 1 recusado; 2 uso incorreto, falha da API ou resposta inválida.
set -euo pipefail

if [ "$#" -ne 1 ] || ! [[ "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "uso: $0 <sha de 40 caracteres hexadecimais>" >&2
  exit 2
fi
sha="$1"
: "${GITHUB_REPOSITORY:?defina GITHUB_REPOSITORY}"
gate="$(cd "$(dirname "$0")/.." && pwd)/infra/tools/release_gate.py"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

api() {
  gh api --method GET "$@" || { echo "::error::falha ao consultar a API do GitHub" >&2; exit 2; }
}

api "repos/$GITHUB_REPOSITORY/actions/workflows/deploy-staging.yml/runs" \
  -f head_sha="$sha" -f per_page=100 > "$tmp/runs.json"
release=$(python3 "$gate" staging-run "$sha" "$tmp/runs.json")
api "repos/$GITHUB_REPOSITORY/actions/runs/${release%% *}/jobs" \
  -f filter=latest -f per_page=100 > "$tmp/jobs.json"
python3 "$gate" staging-jobs "$tmp/jobs.json"
echo "$release"
