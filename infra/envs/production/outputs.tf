# Saídas que o deploy e os runbooks do autor usam. Arquivo igual em staging e production.

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

output "site_url" {
  description = "Origem do site (https://<host>, sem barra final), para o smoke test do deploy."
  value       = local.site_origin
}

output "site_config" {
  description = "Conteúdo do /config.json do site: terraform output -json site_config > config.json."
  value = {
    apiBaseUrl       = "https://${module.dns.domain_names.api}"
    cognitoAuthority = module.auth.issuer
    cognitoClientId  = module.auth.client_id
    # Mesma variável que fecha o cadastro no pool: o site só oferece "Criar conta" se o pool aceita.
    selfSignupEnabled = var.self_signup_enabled
  }
}

output "api_id" {
  description = "Id da API: o <API_ID> dos runbooks de guardrails e de alarmes."
  value       = module.http_api.api_id
}

output "function_role_names" {
  description = "Papel de cada função. O do llm-proxy é o alvo da ação de corte do Budgets, criada à mão."
  value       = module.functions.role_names
}

output "llm_api_key_parameter_name" {
  description = "Nome do parâmetro do SSM com a chave da Claude API. O autor cria à mão; o Terraform só sabe o nome."
  value       = module.functions.api_key_parameter_name
}

output "alarm_topic_arn" {
  description = "Tópico SNS dos alarmes, para conferir a confirmação da assinatura por e-mail."
  value       = module.alarms.topic_arn
}
