# Este arquivo é idêntico em staging e production; tudo que muda vem de var.environment e do tfvars.

locals {
  name_prefix = var.environment == "production" ? "acp-prod" : "acp-stg"
  site_domain = var.environment == "production" ? var.zone_name : "staging.${var.zone_name}"
  site_origin = "https://${module.dns.domain_names.site}"
}

module "dns" {
  source = "../../modules/dns"

  zone_name   = var.zone_name
  site_domain = local.site_domain
  site_alias = {
    name    = module.site.distribution_domain_name
    zone_id = module.site.distribution_hosted_zone_id
  }
  api_alias = module.http_api.domain_alias
  auth_alias = {
    name    = module.auth.domain_cloudfront_distribution
    zone_id = module.auth.domain_cloudfront_zone_id
  }
}

module "site" {
  source = "../../modules/site"

  name_prefix = local.name_prefix
  # Nome global no S3: se já estiver ocupado, o primeiro apply falha e o nome muda por PR antes dele.
  bucket_name         = "${local.name_prefix}-site-aws-cost-playground"
  aliases             = [module.dns.domain_names.site]
  acm_certificate_arn = module.dns.certificate_arns["site"]
  # API, login gerenciado e o endpoint do pool (descoberta OIDC do issuer, região única do ADR).
  connect_src_origins = [
    "https://${module.dns.domain_names.api}",
    "https://${module.dns.domain_names.auth}",
    "https://cognito-idp.us-east-1.amazonaws.com",
  ]
}

module "database" {
  source = "../../modules/database"

  name                           = "${local.name_prefix}-main"
  point_in_time_recovery_enabled = var.point_in_time_recovery_enabled
}

module "auth" {
  source = "../../modules/auth"

  name_prefix         = local.name_prefix
  domain_name         = module.dns.auth_domain
  acm_certificate_arn = module.dns.certificate_arns["auth"]
  callback_urls       = ["${local.site_origin}/auth/callback"]
  logout_urls         = ["${local.site_origin}/"]
  self_signup_enabled = var.self_signup_enabled
}

module "functions" {
  source = "../../modules/functions"

  environment    = var.environment
  table_arn      = module.database.table_arn
  user_pool_arn  = module.auth.user_pool_arn
  package_bucket = var.package_bucket
  package_key    = var.package_key
  # Único entrypoint existente: `handler` em api/app/main.py; as duas funções usam o mesmo pacote.
  api_handler       = "app.main.handler"
  llm_proxy_handler = "app.main.handler"
  llm_enabled       = var.llm_enabled
}

module "http_api" {
  source = "../../modules/http-api"

  name_prefix          = local.name_prefix
  function_names       = module.functions.function_names
  function_invoke_arns = module.functions.function_invoke_arns
  jwt_issuer           = module.auth.issuer
  jwt_audience         = [module.auth.client_id]
  cors_allowed_origins = [local.site_origin]
  domain_name          = module.dns.domain_names.api
  acm_certificate_arn  = module.dns.certificate_arns["api"]
  default_throttle     = var.default_throttle
  # Rotas de designs: vão para a função api, atrás do JWT. PATCH entra no CORS por aqui.
  routes = {
    "POST /estimates" = { throttle = var.estimates_throttle }
    "GET /quota"      = {}
    "DELETE /me"      = {}

    "GET /designs"                        = {}
    "POST /designs"                       = {}
    "GET /designs/{design_id}"            = {}
    "PATCH /designs/{design_id}"          = {}
    "DELETE /designs/{design_id}"         = {}
    "POST /designs/{design_id}/duplicate" = {}
  }
}

module "alarms" {
  source = "../../modules/alarms"

  name_prefix    = local.name_prefix
  function_names = module.functions.function_names
  api_id         = module.http_api.api_id
  alarm_email    = var.alarm_email
}
