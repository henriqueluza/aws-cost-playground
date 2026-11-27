# Papel prices. Só provider simulado: sem credenciais nem AWS.
# Cada igualdade abaixo é uma trava: curinga, StringLike, condição ou ação a mais quebra o assert.
mock_provider "aws" {}

# O domínio só importa para a política de `by_id.tf`; aqui vale qualquer nome válido.
variables {
  zone_name = "example.com"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

run "trust_do_papel_prices" {
  command = apply

  assert {
    condition     = aws_iam_role.prices.name == "acp-ci-prices" && aws_iam_role.prices.max_session_duration == 3600
    error_message = "O papel se chama acp-ci-prices e a sessão dura no máximo uma hora."
  }

  assert {
    condition = jsondecode(aws_iam_role.prices.assume_role_policy).Statement == [{
      Sid       = "GitHubMainBranch"
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:henriqueluza@60079862/aws-cost-playground@1463554125:ref:refs/heads/main"
        }
      }
    }]
    error_message = "O trust do papel prices aceita só a branch main deste repositório, por igualdade exata: nada de pull_request, outro branch ou outro repositório."
  }
}

run "papel_prices_so_le_a_price_list" {
  command = apply

  assert {
    condition     = aws_iam_role_policy.prices_get_products.role == aws_iam_role.prices.id && aws_iam_role_policy.prices_get_products.name == "get-products"
    error_message = "A política inline get-products pertence ao papel prices."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.prices_get_products.policy).Statement == [{
      Sid      = "PriceListGetProducts"
      Effect   = "Allow"
      Action   = "pricing:GetProducts"
      Resource = "*"
    }]
    error_message = "A única permissão do papel prices é pricing:GetProducts (a ação não aceita ARN de recurso)."
  }

  assert {
    condition     = output.github_variables["AWS_PRICES_ROLE_ARN"] == aws_iam_role.prices.arn
    error_message = "A saída tem o nome da variável que o workflow de preços lê."
  }
}
