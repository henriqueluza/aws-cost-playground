output "topic_arn" {
  description = "ARN do tópico SNS dos alarmes, para conferir a confirmação da assinatura por e-mail."
  value       = aws_sns_topic.this.arn
}

output "alarm_names" {
  description = "Nome de cada alarme, por chave (`api-errors`, `api-throttles`, `llm-proxy-errors`, `llm-proxy-throttles`, `http-api-5xx`)."
  value       = { for k, a in aws_cloudwatch_metric_alarm.this : k => a.alarm_name }
}
