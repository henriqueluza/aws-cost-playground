data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  # Erro e throttle de cada Lambda, mais o 5xx da HTTP API. Só métricas padrão: cabem no nível gratuito.
  alarms = merge(
    {
      for pair in setproduct(["api", "llm-proxy"], ["Errors", "Throttles"]) : "${pair[0]}-${lower(pair[1])}" => {
        namespace   = "AWS/Lambda"
        metric_name = pair[1]
        dimensions  = { FunctionName = var.function_names[pair[0]] }
      }
    },
    {
      "http-api-5xx" = {
        namespace   = "AWS/ApiGateway"
        metric_name = "5xx"
        dimensions  = { ApiId = var.api_id }
      }
    },
  )
}

# Sem SSE: uma CMK custa US$ 1/mês fixo (o ADR proíbe custo fixo além da zona do Route 53) e a chave
# gerenciada alias/aws/sns não pode ser usada pelo CloudWatch, então a entrega dos alarmes falharia.
#trivy:ignore:AVD-AWS-0095
resource "aws_sns_topic" "this" {
  name = "${var.name_prefix}-alarms"
}

# Substitui a política padrão: só o CloudWatch desta conta publica, só alarmes do prefixo e só por TLS.
resource "aws_sns_topic_policy" "this" {
  arn = aws_sns_topic.this.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudWatchPublica"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.this.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
          ArnLike      = { "aws:SourceArn" = "arn:aws:cloudwatch:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:alarm:${var.name_prefix}-*" }
        }
      },
      {
        Sid       = "SoTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.this.arn
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
}

# O endereço vem de TF_VAR_alarm_email; a AWS só entrega depois que o link de confirmação é clicado.
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.this.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Só alarm_actions: com limiar 0 o alarme volta a OK logo depois, e ok_actions dobraria os e-mails.
resource "aws_cloudwatch_metric_alarm" "this" {
  for_each = local.alarms

  alarm_name          = "${var.name_prefix}-${each.key}"
  alarm_description   = "${each.value.metric_name} > 0 em 5 min. Runbook: docs/runbooks/alarmes.md"
  namespace           = each.value.namespace
  metric_name         = each.value.metric_name
  dimensions          = each.value.dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.this.arn]
}
