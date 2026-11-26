#!/usr/bin/env bash
# `init -backend=false`, `validate` e `terraform test` em cada raiz e em cada módulo de infra/.
# Sem credenciais e sem estado: os testes usam `mock_provider`. Nunca roda plan nem apply.
#
#   infra/tools/tf_checks.sh            # usa a pasta infra/ deste repositório
#   infra/tools/tf_checks.sh <pasta>    # outra árvore com envs/, bootstrap/ e modules/
#
# Roda todos os diretórios, lista os que falharam e sai com 1 se houver algum.
# Para baixar o provider uma vez só, defina TF_PLUGIN_CACHE_DIR (o CI define).
set -euo pipefail

infra="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
lock=".terraform.lock.hcl"
failed=()
count=0

check() { # check <diretório> [opções do init]
  local dir="$1"
  shift
  count=$((count + 1))
  echo "::group::$dir"
  if terraform -chdir="$dir" init -backend=false -input=false "$@" &&
    terraform -chdir="$dir" validate &&
    terraform -chdir="$dir" test; then
    echo "::endgroup::"
  else
    echo "::endgroup::"
    echo "::error::init, validate ou terraform test falhou em $dir"
    failed+=("$dir")
  fi
}

has_tf() { compgen -G "$1/*.tf" >/dev/null; }

# Raízes: versionam o lockfile, que o init não pode alterar.
for dir in "$infra"/envs/*/ "$infra/bootstrap/"; do
  dir="${dir%/}"
  if has_tf "$dir"; then check "$dir" -lockfile=readonly; fi
done

# Módulos: não versionam lockfile (.gitignore). Cada um recebe uma cópia do lockfile de um
# ambiente, para ser testado com o mesmo provider que os ambientes travam (e não com o mais
# novo que a restrição aceitar). A cópia fica fora do git.
env_lock=$(compgen -G "$infra/envs/*/$lock" | head -n 1 || true)
for dir in "$infra"/modules/*/; do
  dir="${dir%/}"
  has_tf "$dir" || continue
  if [ -n "$env_lock" ]; then cp "$env_lock" "$dir/$lock"; fi
  check "$dir"
done

if [ "$count" -eq 0 ]; then
  echo "::error::nenhum diretório com .tf em $infra (falha fechada)"
  exit 1
fi
if [ "${#failed[@]}" -gt 0 ]; then
  printf 'Falharam (%d de %d):\n' "${#failed[@]}" "$count"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo "OK: $count diretórios."
