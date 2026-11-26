output "api_id" {
  description = "Id da API: dimensão `ApiId` dos alarmes e `<API_ID>` do runbook de guardrails."
  value       = aws_apigatewayv2_api.this.id
}

output "access_log_group_name" {
  description = "Nome do log group do log de acesso, para conferir a retenção (runbook de guardrails, passo 6)."
  value       = aws_cloudwatch_log_group.access.name
}

output "domain_alias" {
  description = "Alvo do registro de alias da API, no formato de `api_alias` do módulo `dns`. Depende só do domínio."
  value = {
    name    = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].target_domain_name
    zone_id = aws_apigatewayv2_domain_name.this.domain_name_configuration[0].hosted_zone_id
  }
}

output "route_keys" {
  description = "Chaves das rotas declaradas, todas atrás do authorizer JWT."
  value       = keys(aws_apigatewayv2_route.this)
}

output "cors_allow_methods" {
  description = "Métodos liberados no preflight do CORS, derivados das chaves de routes."
  value       = aws_apigatewayv2_api.this.cors_configuration[0].allow_methods
}
