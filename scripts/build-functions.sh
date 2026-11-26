#!/usr/bin/env bash
# Monta o zip das Lambdas (api e llm-proxy usam o mesmo pacote) a partir de api/ e do uv.lock.
#
# Contrato (#22):
#   uso:    scripts/build-functions.sh <saida.zip>   (rodar da raiz do repositório)
#   exige:  uv; acessa só o índice de pacotes do lock, nunca a AWS
#   zip:    app/ e as dependências de runtime (sem as de dev) na raiz do zip, para
#           Python $(cat api/.python-version) em aarch64 (Lambda arm64); e contracts/ só com
#           blocks.json e edges.json, que app/contracts.py lê em execução (#242)
#   stdout: só o sha256 do zip, em hex (a conversão para base64 do digest, que o S3 e o
#           CodeSha256 da Lambda usam, fica com quem chama)
#   saída:  0 com o zip criado; 2 para uso errado; 1 para qualquer outra falha
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "uso: scripts/build-functions.sh <saida.zip>" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$1" in
  /*) out="$1" ;;
  *) out="$PWD/$1" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$(dirname "$out")"
rm -f "$out"

# Só as dependências de runtime do lock, com hashes. O boto3 entra de propósito:
# é a versão do lock (testada), não a do runtime da Lambda.
uv export --quiet --project "$root/api" --locked --no-dev --no-emit-project \
  --format requirements.txt --output-file "$tmp/requirements.txt" >&2

# Alvo explícito (Lambda arm64), sem compilar nada na máquina local.
uv pip install --quiet --target "$tmp/package" -r "$tmp/requirements.txt" \
  --python-platform aarch64-manylinux_2_28 \
  --python-version "$(tr -d '[:space:]' < "$root/api/.python-version")" \
  --only-binary :all: --require-hashes --no-deps >&2

# Console scripts não servem na Lambda e o shebang deles leva o caminho do interpretador local.
rm -rf "$tmp/package/bin"

cp -R "$root/api/app" "$tmp/package/app"
find "$tmp/package" -name __pycache__ -type d -prune -exec rm -rf {} +
find "$tmp/package" -name '*.pyc' -delete
rm -rf "$tmp/package/app/tests"

# Contratos lidos em execução (app/contracts.py procura contracts/ ao lado de app/). Só os dois
# arquivos, por nome: exemplos e cenários ficam fora do pacote. Arquivo ausente derruba o build.
mkdir "$tmp/package/contracts"
cp "$root/contracts/blocks.json" "$root/contracts/edges.json" "$tmp/package/contracts/"

# Reprodutível (o zip grava mtime em hora local, daí o TZ=UTC): mtimes fixos (1980-01-01 UTC), ordem estável e sem atributos extras (-X).
find "$tmp/package" -exec touch -h -d @315532800 {} + 2>/dev/null \
  || find "$tmp/package" -exec env TZ=UTC touch -h -t 198001010000 {} +
(
  cd "$tmp/package"
  find . -mindepth 1 ! -type d | sed 's|^\./||' | LC_ALL=C sort | TZ=UTC zip -X -q "$out" -@ >&2
)

shasum -a 256 "$out" | cut -d' ' -f1
