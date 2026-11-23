# Provedor OIDC do GitHub Actions: o CI troca o token do job por credenciais temporárias,
# sem chave estática. Só existe um por conta; se já houver, o autor o importa (README).
locals {
  oidc_host         = "token.actions.githubusercontent.com"
  github_repository = "henriqueluza/aws-cost-playground"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]

  lifecycle {
    prevent_destroy = true
  }
}
