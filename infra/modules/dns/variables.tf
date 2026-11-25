variable "zone_name" {
  description = "Zona pública do Route 53 criada pelo autor (ex.: example.com). O módulo só a lê."
  type        = string
  nullable    = false
}

variable "site_domain" {
  description = "Nome do site: zone_name em production, staging.<zone_name> em staging. API e login viram api.<site_domain> e auth.<site_domain>."
  type        = string
  nullable    = false

  validation {
    condition     = var.site_domain == var.zone_name || endswith(var.site_domain, ".${var.zone_name}")
    error_message = "site_domain deve ser zone_name ou um subdomínio dele."
  }
}

# Uma variável por alvo, não um map: mesmo motivo dos três blocos em main.tf (ciclo com o Cognito).
variable "site_alias" {
  description = "Alvo do site: domain_name e hosted_zone_id do aws_cloudfront_distribution. null = sem registro."
  type        = object({ name = string, zone_id = string })
  default     = null
}

variable "api_alias" {
  description = "Alvo da API: target_domain_name e hosted_zone_id de aws_apigatewayv2_domain_name. null = sem registro."
  type        = object({ name = string, zone_id = string })
  default     = null
}

variable "auth_alias" {
  description = "Alvo do login: cloudfront_distribution e cloudfront_distribution_zone_id de aws_cognito_user_pool_domain. null = sem registro."
  type        = object({ name = string, zone_id = string })
  default     = null
}
