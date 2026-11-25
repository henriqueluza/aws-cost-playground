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
        Action    = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem"]
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
      { Sid = "Quota", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = var.table_arn },
      { Sid = "ChaveDaClaudeApi", Effect = "Allow", Action = "ssm:GetParameter", Resource = "arn:aws:ssm:us-east-1:123456789012:parameter/acp/staging/anthropic-api-key" },
    ]
    error_message = "O llm-proxy só pode ter as ações de quota na tabela e ssm:GetParameter no parâmetro da chave."
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
