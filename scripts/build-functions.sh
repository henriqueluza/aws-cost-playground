#!/usr/bin/env bash
# Monta o zip das Lambdas (api e llm-proxy usam o mesmo pacote) a partir de api/ e do uv.lock.
#
# Contrato (#22):
#   uso:    scripts/build-functions.sh <saida.zip>   (rodar da raiz do repositório)
#   exige:  uv; acessa só o índice de pacotes do lock, nunca a AWS
#   zip:    app/ e as dependências de runtime (sem as de dev) na raiz do zip, para
#           Python $(cat api/.python-version) em aarch64 (Lambda arm64)
#   stdout: só o sha256 do zip, em hex (a conversão para base64 do digest, que o S3 e o
#           CodeSha256 da Lambda usam, fica com quem chama)
#   saída:  0 com o zip criado; 2 para uso errado; 1 para qualquer outra falha
set -euo pipefail

echo "build-functions.sh: ainda não implementado" >&2
exit 1
