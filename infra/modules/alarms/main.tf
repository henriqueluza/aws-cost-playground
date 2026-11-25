data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

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
