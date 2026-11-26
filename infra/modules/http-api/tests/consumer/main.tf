# Só de teste: o dns entrega o nome e o certificado da API e recebe de volta o alvo em api_alias (ciclo = plan falha).
terraform {
  required_version = "~> 1.16.0"
}

module "dns" {
  source = "../../../dns"

  zone_name   = "example.com"
  site_domain = "staging.example.com"
  api_alias   = module.http_api.domain_alias
}

module "http_api" {
  source = "../.."

  name_prefix          = "acp-stg"
  domain_name          = module.dns.domain_names.api
  acm_certificate_arn  = module.dns.certificate_arns["api"]
  function_names       = { "api" = "acp-stg-api", "llm-proxy" = "acp-stg-llm-proxy" }
  function_invoke_arns = { "api" = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:111111111111:function:acp-stg-api/invocations", "llm-proxy" = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:111111111111:function:acp-stg-llm-proxy/invocations" }
  jwt_issuer           = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE"
  jwt_audience         = ["exampleclientid"]
  cors_allowed_origins = ["https://staging.example.com"]
  default_throttle     = { rate_limit = 10, burst_limit = 20 }
  routes               = { "GET /designs" = {} }
}
