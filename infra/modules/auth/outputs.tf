output "user_pool_id" {
  description = "Id do User Pool, para o `/config.json` do site e para as funções."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "ARN do User Pool, para a política IAM de `AdminDeleteUser` da função `api`."
  value       = aws_cognito_user_pool.this.arn
}

output "client_id" {
  description = "Id do cliente público do site: `audience` do JWT authorizer e `client_id` do `/config.json`."
  value       = aws_cognito_user_pool_client.web.id
}

output "issuer" {
  description = "Emissor dos tokens (`iss`), para o JWT authorizer do API Gateway."
  value       = "https://${aws_cognito_user_pool.this.endpoint}"
}

output "domain_name" {
  description = "Domínio do login gerenciado, já criado no Cognito, para o `/config.json`."
  value       = aws_cognito_user_pool_domain.this.domain
}

output "domain_cloudfront_distribution" {
  description = "Nome DNS da distribuição CloudFront do domínio: alvo do registro alias no módulo `dns`."
  value       = aws_cognito_user_pool_domain.this.cloudfront_distribution
}

output "domain_cloudfront_zone_id" {
  description = "Zona hospedada da distribuição CloudFront do domínio, para o registro alias no módulo `dns`."
  value       = aws_cognito_user_pool_domain.this.cloudfront_distribution_zone_id
}
