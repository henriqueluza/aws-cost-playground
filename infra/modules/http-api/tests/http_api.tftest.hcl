mock_provider "aws" {}
override_resource {
  target          = aws_apigatewayv2_api.this
  override_during = plan
  values          = { execution_arn = "arn:aws:execute-api:us-east-1:111111111111:api123" }
}
override_resource {
  target          = aws_apigatewayv2_authorizer.jwt
  override_during = plan
  values          = { id = "auth123" }
}
override_resource {
  target          = aws_apigatewayv2_integration.this["api"]
  override_during = plan
  values          = { id = "int-api" }
}
override_resource {
  target          = aws_apigatewayv2_integration.this["llm-proxy"]
  override_during = plan
  values          = { id = "int-llm" }
}
variables {
  name_prefix          = "acp-stg"
  function_names       = { "api" = "acp-stg-api", "llm-proxy" = "acp-stg-llm-proxy" }
  function_invoke_arns = { "api" = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:111111111111:function:acp-stg-api/invocations", "llm-proxy" = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:111111111111:function:acp-stg-llm-proxy/invocations" }
  jwt_issuer           = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE"
  jwt_audience         = ["exampleclientid"]
  cors_allowed_origins = ["https://staging.exemplo.com"]
  default_throttle     = { rate_limit = 10, burst_limit = 20 }
  routes = {
    "POST /estimates"       = { throttle = { rate_limit = 1, burst_limit = 5 } }
    "GET /estimates/{id}"   = {}
    "GET /quota"            = {}
    "GET /designs"          = {}
    "DELETE /designs/{id}"  = {}
    "GET /estimates-export" = {}
  }
}
run "toda_rota_exige_jwt" {
  command = plan
  assert {
    condition     = length(aws_apigatewayv2_route.this) == length(var.routes) && alltrue([for r in aws_apigatewayv2_route.this : r.authorization_type == "JWT" && r.authorizer_id == "auth123"])
    error_message = "Toda rota declarada deve existir e usar o authorizer JWT."
  }
  assert {
    condition     = aws_apigatewayv2_authorizer.jwt.authorizer_type == "JWT" && aws_apigatewayv2_authorizer.jwt.identity_sources == toset(["$request.header.Authorization"]) && aws_apigatewayv2_authorizer.jwt.jwt_configuration[0].issuer == var.jwt_issuer && aws_apigatewayv2_authorizer.jwt.jwt_configuration[0].audience == toset(var.jwt_audience)
    error_message = "O authorizer deve validar emissor e audiência do Cognito a partir do cabeçalho Authorization."
  }
}
run "estimates_e_quota_vao_para_o_llm_proxy" {
  command = plan
  assert {
    condition     = { for k, r in aws_apigatewayv2_route.this : k => r.target } == { "POST /estimates" = "integrations/int-llm", "GET /estimates/{id}" = "integrations/int-llm", "GET /quota" = "integrations/int-llm", "GET /designs" = "integrations/int-api", "DELETE /designs/{id}" = "integrations/int-api", "GET /estimates-export" = "integrations/int-api" }
    error_message = "/estimates e /quota (e o que houver abaixo) vão para o llm-proxy; as demais rotas, para a api."
  }
  assert {
    condition     = alltrue([for k in ["api", "llm-proxy"] : aws_apigatewayv2_integration.this[k].integration_uri == var.function_invoke_arns[k] && aws_apigatewayv2_integration.this[k].payload_format_version == "2.0" && aws_apigatewayv2_integration.this[k].timeout_milliseconds == 30000 && aws_lambda_permission.this[k].function_name == var.function_names[k] && aws_lambda_permission.this[k].principal == "apigateway.amazonaws.com" && aws_lambda_permission.this[k].source_arn == "arn:aws:execute-api:us-east-1:111111111111:api123/*/*"])
    error_message = "Cada integração invoca a sua função (payload 2.0, 30 s), com permissão restrita a esta API."
  }
}
run "cors_com_origens_explicitas" {
  command = plan
  assert {
    condition     = aws_apigatewayv2_api.this.cors_configuration[0].allow_origins == toset(var.cors_allowed_origins) && aws_apigatewayv2_api.this.cors_configuration[0].allow_methods == toset(["GET", "POST", "DELETE"]) && aws_apigatewayv2_api.this.cors_configuration[0].allow_headers == toset(["authorization", "content-type"]) && !aws_apigatewayv2_api.this.cors_configuration[0].allow_credentials
    error_message = "CORS: só as origens da variável, os métodos das rotas e os cabeçalhos authorization e content-type, sem credenciais."
  }
}
run "limite_de_taxa_por_rota" {
  command = plan
  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit == 10 && aws_apigatewayv2_stage.default.default_route_settings[0].throttling_burst_limit == 20 && { for s in aws_apigatewayv2_stage.default.route_settings : s.route_key => [s.throttling_rate_limit, s.throttling_burst_limit] } == { "POST /estimates" = [1, 5] }
    error_message = "O limite padrão vem de default_throttle e só as rotas com throttle entram em route_settings."
  }
  assert {
    condition     = alltrue([for s in aws_apigatewayv2_stage.default.route_settings : contains([for r in aws_apigatewayv2_route.this : r.route_key], s.route_key)])
    error_message = "Toda chave de route_settings deve ser o route key exato de uma rota declarada."
  }
}
run "log_de_acesso_sem_cabecalhos" {
  command = plan
  assert {
    condition     = !can(regex("(?i)header|authorization|\\$request|email|sourceIp|userAgent", aws_apigatewayv2_stage.default.access_log_settings[0].format)) && can(jsondecode(aws_apigatewayv2_stage.default.access_log_settings[0].format).routeKey)
    error_message = "O log de acesso é JSON e não leva cabeçalho, e-mail, IP nem user-agent."
  }
  assert {
    condition     = toset(keys(jsondecode(aws_apigatewayv2_stage.default.access_log_settings[0].format))) == toset(["requestId", "requestTime", "routeKey", "status", "protocol", "responseLength", "responseLatency", "integrationLatency", "integrationError", "authorizerError", "errorMessage", "sub"]) && alltrue([for v in values(jsondecode(aws_apigatewayv2_stage.default.access_log_settings[0].format)) : startswith(v, "$context.")]) && jsondecode(aws_apigatewayv2_stage.default.access_log_settings[0].format).sub == "$context.authorizer.claims.sub"
    error_message = "O log de acesso tem só os 12 campos combinados, todos de $context, e sub vem do claim sub."
  }
  assert {
    condition     = aws_cloudwatch_log_group.access.retention_in_days == 7 && output.access_log_group_name == "/aws/vendedlogs/apigateway/acp-stg-http-api"
    error_message = "O log group nasce com retenção de 7 dias e o nome sai em output."
  }
}
run "rota_default_e_rejeitada" {
  command = plan
  variables { routes = { "$default" = {} } }
  expect_failures = [var.routes]
}
run "emissor_ou_audiencia_invalidos_sao_rejeitados" {
  command = plan
  variables {
    jwt_issuer   = "https://accounts.exemplo.com/us-east-1_EXAMPLE"
    jwt_audience = []
  }
  expect_failures = [var.jwt_issuer, var.jwt_audience]
}
run "prefixo_retencao_ou_throttle_padrao_invalidos_sao_rejeitados" {
  command = plan
  variables {
    name_prefix        = "acp-dev"
    log_retention_days = 365
    default_throttle   = { rate_limit = 0, burst_limit = 0 }
  }
  expect_failures = [var.name_prefix, var.log_retention_days, var.default_throttle]
}
run "rota_any_e_rejeitada" {
  command = plan
  variables { routes = { "ANY /designs" = {} } }
  expect_failures = [var.routes]
}
run "rota_options_e_rejeitada" {
  command = plan
  variables { routes = { "OPTIONS /designs" = {} } }
  expect_failures = [var.routes]
}
run "throttle_por_rota_zerado_e_rejeitado" {
  command = plan
  variables { routes = { "GET /designs" = { throttle = { rate_limit = 0, burst_limit = 5 } } } }
  expect_failures = [var.routes]
}
run "origem_curinga_e_rejeitada" {
  command = plan
  variables { cors_allowed_origins = ["*"] }
  expect_failures = [var.cors_allowed_origins]
}
run "origem_com_porta_ou_caminho_e_rejeitada" {
  command = plan
  variables { cors_allowed_origins = ["https://staging.exemplo.com:8443/app"] }
  expect_failures = [var.cors_allowed_origins]
}
run "retencao_do_log_vem_da_variavel" {
  command = plan
  variables { log_retention_days = 14 }
  assert {
    condition     = aws_cloudwatch_log_group.access.retention_in_days == 14
    error_message = "A retenção do log de acesso vem de log_retention_days."
  }
}
