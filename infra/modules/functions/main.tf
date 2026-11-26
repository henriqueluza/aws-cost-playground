locals {
  prefix     = var.environment == "production" ? "acp-prod" : "acp-stg"
  table_name = element(split("/", var.table_arn), 1)

  # Parâmetro da chave da Claude API. Fica FORA do Terraform: o autor o cria e o mantém à mão
  # (docs/runbooks/rotacao-de-segredos.md). Assim nenhum papel de CI precisa ler a chave.
  # Região e conta saem do ARN da tabela, que é do mesmo ambiente.
  api_key_parameter_name = "/acp/${var.environment}/anthropic-api-key"
  api_key_parameter_arn  = "arn:aws:ssm:${element(split(":", var.table_arn), 3)}:${element(split(":", var.table_arn), 4)}:parameter${local.api_key_parameter_name}"

  # Limite de permissões que os papéis de CI `acp-ci-apply-<env>` exigem em todo papel que criam
  # (`local.apply_boundary_arn` em infra/bootstrap/apply.tf). A política nasce no bootstrap, fora
  # deste módulo; aqui só o ARN, com o nome completo do ambiente e a conta do ARN da tabela.
  permissions_boundary_arn = "arn:aws:iam::${element(split(":", var.table_arn), 4)}:policy/acp-ci-boundary-${var.environment}"

  # Configuração das funções. Nenhum segredo aqui: o proxy recebe só o NOME do parâmetro e lê o valor em execução.
  functions = {
    "api" = {
      handler = var.api_handler
      timeout = 10
      environment = {
        TABLE_NAME   = local.table_name
        USER_POOL_ID = element(split("/", var.user_pool_arn), 1)
      }
    }
    "llm-proxy" = {
      handler = var.llm_proxy_handler
      timeout = 29
      environment = {
        TABLE_NAME                  = local.table_name
        LLM_ENABLED                 = tostring(var.llm_enabled)
        ANTHROPIC_API_KEY_PARAMETER = local.api_key_parameter_name
      }
    }
  }
}

resource "aws_cloudwatch_log_group" "this" {
  for_each = local.functions

  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  for_each = local.functions

  function_name = "${local.prefix}-${each.key}"
  role          = aws_iam_role.this[each.key].arn
  runtime       = "python3.13"
  architectures = ["arm64"]
  handler       = each.value.handler
  timeout       = each.value.timeout
  memory_size   = 256
  s3_bucket     = var.package_bucket
  s3_key        = var.package_key

  environment {
    variables = each.value.environment
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.this[each.key].name
  }

  lifecycle {
    # A concorrência reservada é configuração de custo manual do autor (runbook de guardrails).
    ignore_changes = [reserved_concurrent_executions]
  }

  depends_on = [aws_iam_role_policy.logs]
}
