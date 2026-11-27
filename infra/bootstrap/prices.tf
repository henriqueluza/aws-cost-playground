# Papel `prices`: usado pelo workflow semanal (e manual) que gera o catálogo de preços e
# abre um PR. Só lê a Price List Query API, que é dado público; não toca em nada da conta.
resource "aws_iam_role" "prices" {
  name                 = "acp-ci-prices"
  description          = "leitura da Price List API pelo workflow de precos"
  max_session_duration = 3600

  # O workflow roda por agenda e por disparo manual, sem environment: o `sub` é o do branch.
  # `StringEquals` nas duas condições: sem curinga, nenhum outro repositório, branch,
  # environment ou `pull_request` casa com o `sub`.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "GitHubMainBranch"
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_host}:aud" = "sts.amazonaws.com"
          "${local.oidc_host}:sub" = "${local.github_sub_prefix}:ref:refs/heads/main"
        }
      }
    }]
  })

  lifecycle {
    prevent_destroy = true
  }
}

# A Price List não aceita ARN no `Resource` nem tem chave de condição própria (Service
# Authorization Reference, "AWS Price List"): `*` é a única forma de conceder a ação.
# A ação é uma só, sem curinga, e só lê preço público.
#trivy:ignore:AVD-AWS-0057
resource "aws_iam_role_policy" "prices_get_products" {
  name = "get-products"
  role = aws_iam_role.prices.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "PriceListGetProducts"
      Effect   = "Allow"
      Action   = "pricing:GetProducts"
      Resource = "*"
    }]
  })
}
