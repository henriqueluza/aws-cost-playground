# Provedor OIDC do GitHub Actions: o CI troca o token do job por credenciais temporárias,
# sem chave estática. Só existe um por conta; se já houver, o autor o importa (README).
locals {
  oidc_host = "token.actions.githubusercontent.com"

  # Prefixo do claim `sub` no formato imutável do GitHub: `repo:<dono>@<id do dono>/<repo>@<id do repo>`.
  # Conferido em 27/11/2026 com um token real deste repositório (#366). Os IDs não mudam em
  # rename nem em transferência, e um repositório recriado com o mesmo nome recebe outro ID:
  # por isso são literais aqui, e não variáveis (um valor errado no apply trocaria quem assume
  # os papéis sem passar pelos testes). Como conferir: README, "Formato do `sub`".
  github_owner      = "henriqueluza"
  github_owner_id   = "60079862"
  github_repo       = "aws-cost-playground"
  github_repo_id    = "1463554125"
  github_sub_prefix = "repo:${local.github_owner}@${local.github_owner_id}/${local.github_repo}@${local.github_repo_id}"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]

  lifecycle {
    prevent_destroy = true
  }
}
