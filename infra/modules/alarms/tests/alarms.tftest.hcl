mock_provider "aws" {}
override_resource {
  target          = aws_sns_topic.this
  override_during = plan
  values          = { arn = "arn:aws:sns:us-east-1:111111111111:acp-stg-alarms" }
}
override_data {
  target          = data.aws_caller_identity.current
  override_during = plan
  values          = { account_id = "111111111111" }
}
override_data {
  target          = data.aws_region.current
  override_during = plan
  values          = { region = "us-east-1" }
}
variables {
  name_prefix = "acp-stg"
  alarm_email = "alarmes@exemplo.com"
}
run "topico_com_assinatura_de_email_da_variavel" {
  command = plan
  assert {
    condition     = aws_sns_topic.this.name == "acp-stg-alarms" && aws_sns_topic.this.kms_master_key_id == null
    error_message = "O tópico deve se chamar <prefixo>-alarms e não usar KMS (CMK tem custo fixo; a chave da AWS bloqueia o CloudWatch)."
  }
  assert {
    condition     = aws_sns_topic_subscription.email.protocol == "email" && nonsensitive(aws_sns_topic_subscription.email.endpoint) == nonsensitive(var.alarm_email) && aws_sns_topic_subscription.email.topic_arn == aws_sns_topic.this.arn
    error_message = "A assinatura deve ser por e-mail, com o endpoint vindo da variável alarm_email."
  }
}
run "politica_do_topico_restringe_cloudwatch_e_exige_tls" {
  command = plan
  assert {
    condition = jsondecode(aws_sns_topic_policy.this.policy).Statement == [
      {
        Sid       = "CloudWatchPublica"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.this.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = "111111111111" }
          ArnLike      = { "aws:SourceArn" = "arn:aws:cloudwatch:us-east-1:111111111111:alarm:acp-stg-*" }
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
    error_message = "A política deve ter só duas regras: sns:Publish do CloudWatch limitado à conta, à região e ao prefixo, e negação sem TLS."
  }
}
run "rejeita_name_prefix_e_alarm_email_invalidos" {
  command = plan
  variables {
    name_prefix = "acp-dev"
    alarm_email = "nao-e-um-email"
  }
  expect_failures = [var.name_prefix, var.alarm_email]
}
