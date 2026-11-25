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
  name_prefix    = "acp-stg"
  function_names = { "api" = "acp-stg-api", "llm-proxy" = "acp-stg-llm-proxy" }
  api_id         = "a1b2c3d4e5"
  alarm_email    = "alarmes@exemplo.com"
}
run "cinco_alarmes_com_chaves_e_dimensoes_exatas" {
  command = plan
  assert {
    condition     = toset(keys(aws_cloudwatch_metric_alarm.this)) == toset(["api-errors", "api-throttles", "llm-proxy-errors", "llm-proxy-throttles", "http-api-5xx"])
    error_message = "Devem existir exatamente os 5 alarmes: erro e throttle por Lambda e 5xx da API."
  }
  assert {
    condition = alltrue([
      for f in ["api", "llm-proxy"] : alltrue([
        for m in ["Errors", "Throttles"] :
        aws_cloudwatch_metric_alarm.this["${f}-${lower(m)}"].namespace == "AWS/Lambda" && aws_cloudwatch_metric_alarm.this["${f}-${lower(m)}"].metric_name == m && aws_cloudwatch_metric_alarm.this["${f}-${lower(m)}"].dimensions == tomap({ FunctionName = var.function_names[f] })
      ])
    ])
    error_message = "Alarmes de Lambda devem usar AWS/Lambda, Errors/Throttles e a dimensão FunctionName da função certa."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.this["http-api-5xx"].namespace == "AWS/ApiGateway" && aws_cloudwatch_metric_alarm.this["http-api-5xx"].metric_name == "5xx" && aws_cloudwatch_metric_alarm.this["http-api-5xx"].dimensions == tomap({ ApiId = var.api_id })
    error_message = "O alarme de 5xx deve usar AWS/ApiGateway, métrica 5xx e a dimensão ApiId."
  }
  assert {
    condition     = output.alarm_names == { for k in keys(aws_cloudwatch_metric_alarm.this) : k => "acp-stg-${k}" }
    error_message = "alarm_names deve trazer o nome de cada alarme, por chave, com o prefixo do ambiente."
  }
}
run "alarmes_so_com_metricas_padrao_do_nivel_gratuito" {
  command = plan
  assert {
    condition = alltrue([for k, a in aws_cloudwatch_metric_alarm.this :
      a.alarm_name == "acp-stg-${k}" && a.statistic == "Sum" && a.period == 300 && a.evaluation_periods == 1 && a.threshold == 0 &&
      a.comparison_operator == "GreaterThanThreshold" && a.treat_missing_data == "notBreaching" && endswith(a.alarm_description, "Runbook: docs/runbooks/alarmes.md")
    ])
    error_message = "Todo alarme deve ter nome com prefixo, Sum/300s/limite 0, dado ausente sem violação e descrição com o runbook."
  }
  assert {
    condition = alltrue([for a in aws_cloudwatch_metric_alarm.this :
      length(a.metric_query) == 0 && a.extended_statistic == null && length(coalesce(a.ok_actions, [])) == 0 && length(coalesce(a.insufficient_data_actions, [])) == 0 && a.alarm_actions == toset(["arn:aws:sns:us-east-1:111111111111:acp-stg-alarms"])
    ])
    error_message = "Alarmes não podem usar metric_query nem extended_statistic e só notificam o tópico em ALARM."
  }
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
run "aceita_o_prefixo_de_producao" {
  command = plan
  variables { name_prefix = "acp-prod" }
}
run "rejeita_api_id_invalido" {
  command = plan
  variables { api_id = "API-INVALIDA" }
  expect_failures = [var.api_id]
}
