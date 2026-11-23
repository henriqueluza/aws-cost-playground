locals {
  prefix     = var.environment == "production" ? "acp-prod" : "acp-stg"
  table_name = element(split("/", var.table_arn), 1)

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
        ANTHROPIC_API_KEY_PARAMETER = aws_ssm_parameter.anthropic_api_key.name
      }
    }
  }
}

# Chave da Claude API. O Terraform cria o parâmetro com um valor de espera; o autor grava o valor real
# pelo console (docs/runbooks/rotacao-de-segredos.md). `value_wo` é write-only: o valor não entra no
# plano nem no state, nem depois do refresh. Criptografia com a chave gerenciada aws/ssm, sem custo.
resource "aws_ssm_parameter" "anthropic_api_key" {
  name             = "/acp/${var.environment}/anthropic-api-key"
  description      = "Chave da Claude API do llm-proxy. Valor gravado à mão pelo autor."
  type             = "SecureString"
  value_wo         = "placeholder-o-autor-grava-o-valor-real"
  value_wo_version = 1

  lifecycle {
    prevent_destroy = true
    # Mudar a versão regravaria o valor de espera por cima da chave real.
    ignore_changes = [value_wo, value_wo_version]
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
