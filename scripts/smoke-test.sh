#!/usr/bin/env bash
# Smoke test pós-deploy (#23). Só leitura: GET no site e na API, sem credencial.
#
# Uso: scripts/smoke-test.sh <site_url> <api_base_url> <config.json publicado> <manifest.json do release>
#
#   1. `<site_url>/` responde 2xx.
#   2. `<site_url>/config.json` é o JSON publicado (comparação com chaves ordenadas).
#   3. `<site_url>/prices/manifest.json` é byte a byte o do release: prova que o site no ar
#      é o do artefato conferido.
#   4. `GET <api_base_url>/quota` sem token devolve 401 (authorizer JWT no ar).
#
# SMOKE_RETRY_DELAY (segundos, padrão 10) é o intervalo entre tentativas.
# Saída: 0 passou; 1 reprovou; 2 uso incorreto.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "uso: $0 <site_url> <api_base_url> <config.json> <manifest.json>" >&2
  exit 2
fi
site_url="${1%/}" api_base_url="${2%/}" config="$3" manifest="$4"
delay="${SMOKE_RETRY_DELAY:-10}"

for url in "$site_url" "$api_base_url"; do
  case "$url" in
    https://?*) ;;
    *) echo "::error::smoke: as URLs têm de começar com https://" >&2; exit 2 ;;
  esac
done
for file in "$config" "$manifest"; do
  [ -f "$file" ] || { echo "::error::smoke: arquivo de referência ausente: $(basename "$file")" >&2; exit 2; }
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl_opts=(--fail --silent --show-error --max-time 15 --retry 5 --retry-delay "$delay" --retry-all-errors)

curl "${curl_opts[@]}" --output /dev/null "$site_url/"
curl "${curl_opts[@]}" --output "$tmp/config.json" "$site_url/config.json"
# Cada jq roda sozinho: JSON inválido de qualquer lado aborta, em vez de comparar dois vazios.
jq -S . "$tmp/config.json" > "$tmp/served.json"
jq -S . "$config" > "$tmp/expected.json"
if ! cmp -s "$tmp/served.json" "$tmp/expected.json"; then
  echo "::error::smoke: o /config.json servido difere do publicado" >&2
  exit 1
fi
curl "${curl_opts[@]}" --output "$tmp/manifest.json" "$site_url/prices/manifest.json"
if ! cmp -s "$tmp/manifest.json" "$manifest"; then
  echo "::error::smoke: o /prices/manifest.json servido difere do release" >&2
  exit 1
fi

# Sem token a API tem de recusar com 401. Repete por causa da propagação do DNS.
code=000
for _ in 1 2 3 4 5 6; do
  code=$(curl --silent --max-time 15 --output /dev/null --write-out '%{http_code}' "$api_base_url/quota" || true)
  [ "$code" = "401" ] && exit 0
  sleep "$delay"
done
echo "::error::smoke: GET /quota sem token devolveu $code (esperado 401)" >&2
exit 1
