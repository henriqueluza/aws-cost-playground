# Só provider simulado: não usa credenciais nem chama a AWS. `apply` aqui é simulado e serve
# para as políticas (que dependem de ARNs calculados) ficarem legíveis nos asserts.
mock_provider "aws" {
  # O provider valida o formato do ARN do papel na função.
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/simulado"
    }
  }
}

variables {
  environment       = "staging"
  table_arn         = "arn:aws:dynamodb:us-east-1:123456789012:table/acp-stg-main"
  user_pool_arn     = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_EXEMPLO"
  package_bucket    = "acp-stg-artifacts"
  package_key       = "functions/0000000.zip"
  api_handler       = "app.main.handler"
  llm_proxy_handler = "app.main.proxy_handler"
}

run "papeis_de_menor_privilegio" {
  command = apply

  assert {
    condition = jsondecode(aws_iam_role_policy.api.policy).Statement == [
      {
        Sid       = "Designs"
        Effect    = "Allow"
        Action    = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem"]
        Resource  = var.table_arn
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["USER#*"] } }
      },
      {
        Sid      = "ExclusaoDeConta"
        Effect   = "Allow"
        Action   = "cognito-idp:AdminDeleteUser"
        Resource = var.user_pool_arn
      },
    ]
    error_message = "A api só pode ter as ações de DynamoDB dos designs na tabela do ambiente e AdminDeleteUser no pool do ambiente."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.api.policy, "ssm:") && aws_iam_role_policy.api.role == aws_iam_role.this["api"].id
    error_message = "A api não lê o parâmetro da chave."
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.llm_proxy.policy).Statement == [
      {
        Sid      = "Quota"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = var.table_arn
        Condition = {
          "ForAllValues:StringLike"   = { "dynamodb:LeadingKeys" = ["USER#*", "GLOBAL"] }
          "Null"                      = { "dynamodb:LeadingKeys" = "false" }
          "ForAllValues:StringEquals" = { "dynamodb:Attributes" = ["PK", "SK", "count", "ttl"] }
          "StringEqualsIfExists"      = { "dynamodb:Select" = "SPECIFIC_ATTRIBUTES", "dynamodb:ReturnValues" = "NONE" }
        }
      },
      { Sid = "ChaveDaClaudeApi", Effect = "Allow", Action = "ssm:GetParameter", Resource = "arn:aws:ssm:us-east-1:123456789012:parameter/acp/staging/anthropic-api-key" },
    ]
    error_message = "O llm-proxy só pode ter as ações de quota na tabela, limitadas às partições e às colunas dos contadores, e ssm:GetParameter no parâmetro da chave."
  }

  # Sem ação que troque o item inteiro ou liste a partição: a condição de colunas só vale com GetItem e UpdateItem.
  assert {
    condition = alltrue([
      for a in ["PutItem", "DeleteItem", "Query", "Scan", "Batch", "PartiQL"] : !strcontains(aws_iam_role_policy.llm_proxy.policy, a)
    ])
    error_message = "O llm-proxy não pode trocar item inteiro, apagar, listar nem usar lote: essas ações furam a condição de colunas."
  }

  assert {
    condition     = aws_iam_role_policy.llm_proxy.role == aws_iam_role.this["llm-proxy"].id && aws_iam_role.this["llm-proxy"].name == "acp-stg-llm-proxy"
    error_message = "O papel do llm-proxy tem nome estável: a ação do Budgets aponta para ele."
  }
  assert {
    condition = alltrue([
      for k, p in aws_iam_role_policy.logs : jsondecode(p.policy).Statement == [{
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.this[k].arn}:*"
      }]
    ])
    error_message = "Cada função escreve só no próprio log group, sem logs:CreateLogGroup."
  }
}

# O papel de CI (infra/bootstrap/apply.tf, `DenyRoleWithoutBoundary`) compara o ARN por igualdade:
# sufixo é o nome completo do ambiente, não o prefixo (`stg`/`prod`).
run "limite_de_permissoes_em_staging" {
  command = plan

  assert {
    condition     = alltrue([for r in aws_iam_role.this : r.permissions_boundary == "arn:aws:iam::123456789012:policy/acp-ci-boundary-staging"])
    error_message = "Os dois papéis levam o limite acp-ci-boundary-staging da conta do ambiente."
  }

  assert {
    condition     = length(aws_iam_role.this) == 2
    error_message = "O módulo cria exatamente os papéis api e llm-proxy."
  }
}

run "limite_de_permissoes_em_producao" {
  command = plan

  variables {
    environment = "production"
    table_arn   = "arn:aws:dynamodb:us-east-1:210987654321:table/acp-prod-main"
  }

  assert {
    condition     = alltrue([for r in aws_iam_role.this : r.permissions_boundary == "arn:aws:iam::210987654321:policy/acp-ci-boundary-production"])
    error_message = "Os dois papéis levam o limite acp-ci-boundary-production, com a conta do ARN da tabela."
  }
}

# Contrato com a política de limite do bootstrap (#166): a permissão efetiva é a interseção do
# limite com as políticas inline, e uma ação fora do limite é negada em execução sem erro no plano.
# Este teste trava, por igualdade, tudo o que o módulo concede. Se ele falhar por ação nova, ajuste
# primeiro o limite em infra/bootstrap/ e só depois esta lista.
run "politicas_inline_cabem_no_limite" {
  command = apply

  assert {
    condition = toset(flatten([
      for p in concat(values(aws_iam_role_policy.logs), [aws_iam_role_policy.api, aws_iam_role_policy.llm_proxy]) :
      [for s in jsondecode(p.policy).Statement : s.Action]
      ])) == toset([
      "logs:CreateLogStream", "logs:PutLogEvents",
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem",
      "cognito-idp:AdminDeleteUser",
      "ssm:GetParameter",
    ])
    error_message = "Ação nova nas políticas inline: o limite acp-ci-boundary-<env> do bootstrap precisa permiti-la antes."
  }

  assert {
    condition = alltrue(flatten([
      for p in concat(values(aws_iam_role_policy.logs), [aws_iam_role_policy.api, aws_iam_role_policy.llm_proxy]) :
      [for s in jsondecode(p.policy).Statement : s.Effect == "Allow" && !strcontains(jsonencode(s.Action), "*")]
    ]))
    error_message = "As políticas inline só têm Allow de ações enumeradas, sem curinga."
  }

  assert {
    condition = alltrue(flatten([
      for p in [aws_iam_role_policy.api, aws_iam_role_policy.llm_proxy] : [
        for s in jsondecode(p.policy).Statement : (
          startswith(s.Resource, "arn:aws:dynamodb:us-east-1:123456789012:table/acp-stg-")
          || s.Resource == var.user_pool_arn
          || s.Resource == "arn:aws:ssm:us-east-1:123456789012:parameter/acp/staging/anthropic-api-key"
        )
      ]
    ]))
    error_message = "Os recursos de dado ficam nos que o limite cobre: tabela acp-stg-*, o pool do ambiente e o parâmetro exato da chave."
  }

  assert {
    condition     = alltrue([for g in aws_cloudwatch_log_group.this : startswith(g.name, "/aws/lambda/acp-stg-")])
    error_message = "Os log groups ficam em /aws/lambda/acp-stg-*, o prefixo que o limite cobre."
  }
}

run "parametro_da_chave_fica_fora_do_terraform" {
  command = plan

  assert {
    condition     = output.api_key_parameter_name == "/acp/staging/anthropic-api-key"
    error_message = "O módulo só conhece o nome do parâmetro: quem cria e grava a chave é o autor, à mão."
  }
}

run "funcoes_logs_e_ambiente" {
  command = plan

  assert {
    condition     = aws_lambda_function.this["api"].timeout == 10 && aws_lambda_function.this["llm-proxy"].timeout == 29
    error_message = "Timeout de 10 s na api e 29 s no llm-proxy."
  }

  assert {
    condition = alltrue([
      for k, f in aws_lambda_function.this :
      f.function_name == "acp-stg-${k}" && f.s3_key == var.package_key && f.logging_config[0].log_format == "JSON"
      && aws_cloudwatch_log_group.this[k].name == "/aws/lambda/acp-stg-${k}" && aws_cloudwatch_log_group.this[k].retention_in_days == 7
    ])
    error_message = "As duas funções saem do mesmo pacote, com log group próprio, em JSON, com 7 dias por padrão."
  }

  assert {
    condition = alltrue([
      for f in aws_lambda_function.this : f.runtime == "python3.14" && f.architectures == tolist(["arm64"])
    ])
    error_message = "As duas funções rodam em python3.14 (o Python de api/.python-version) e arm64, o alvo do zip."
  }

  assert {
    condition     = aws_lambda_function.this["api"].environment[0].variables == tomap({ TABLE_NAME = "acp-stg-main", USER_POOL_ID = "us-east-1_EXEMPLO" })
    error_message = "A api recebe só o nome da tabela e o id do pool."
  }

  assert {
    condition = aws_lambda_function.this["llm-proxy"].environment[0].variables == tomap({
      TABLE_NAME                  = "acp-stg-main"
      LLM_ENABLED                 = "false"
      ANTHROPIC_API_KEY_PARAMETER = "/acp/staging/anthropic-api-key"
    })
    error_message = "O llm-proxy recebe o nome do parâmetro, nunca a chave, e LLM_ENABLED desligado por padrão."
  }
}

run "producao_retencao_e_interruptor_por_variavel" {
  command = plan

  variables {
    environment        = "production"
    log_retention_days = 14
    llm_enabled        = true
  }

  assert {
    condition     = aws_lambda_function.this["llm-proxy"].function_name == "acp-prod-llm-proxy" && output.api_key_parameter_name == "/acp/production/anthropic-api-key"
    error_message = "Produção usa o prefixo acp-prod e o próprio caminho de parâmetro."
  }

  assert {
    condition     = aws_cloudwatch_log_group.this["api"].retention_in_days == 14 && aws_lambda_function.this["llm-proxy"].environment[0].variables.LLM_ENABLED == "true"
    error_message = "Retenção e LLM_ENABLED seguem as variáveis."
  }
}

run "entradas_invalidas_sao_recusadas" {
  command = plan

  variables {
    environment        = "dev"
    table_arn          = "arn:aws:dynamodb:us-east-1:123456789012:table/*"
    user_pool_arn      = "*"
    log_retention_days = 0
  }

  expect_failures = [var.environment, var.table_arn, var.user_pool_arn, var.log_retention_days]
}
