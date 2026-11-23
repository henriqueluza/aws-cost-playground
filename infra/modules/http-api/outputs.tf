output "api_id" {
  description = "Id da API: dimensão `ApiId` dos alarmes e `<API_ID>` do runbook de guardrails."
  value       = aws_apigatewayv2_api.this.id
}

output "access_log_group_name" {
  description = "Nome do log group do log de acesso, para conferir a retenção (runbook de guardrails, passo 6)."
  value       = aws_cloudwatch_log_group.access.name
}
