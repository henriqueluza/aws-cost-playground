# Saídas que o deploy usa. Arquivo igual em staging e production.

output "site_bucket_name" {
  description = "Bucket do site: destino do bundle e do /config.json."
  value       = module.site.bucket_name
}

output "site_distribution_id" {
  description = "Distribuição do CloudFront, para a invalidação de /index.html e /config.json."
  value       = module.site.distribution_id
}

output "function_names" {
  description = "Nome de cada função (api, llm-proxy), para publicar o código."
  value       = module.functions.function_names
}

output "site_config" {
  description = "Conteúdo do /config.json do site: terraform output -json site_config > config.json."
  value = {
    apiBaseUrl       = "https://${module.dns.domain_names.api}"
    cognitoAuthority = module.auth.issuer
    cognitoClientId  = module.auth.client_id
  }
}
