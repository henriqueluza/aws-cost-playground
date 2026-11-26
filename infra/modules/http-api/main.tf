locals {
  targets = toset(["api", "llm-proxy"])

  # O destino sai do caminho, não de quem chama: /estimates e /quota (e o que houver abaixo) vão para o llm-proxy.
  route_target = {
    for key in keys(var.routes) : key => can(regex("^[A-Z]+ /(estimates|quota)(/|$)", key)) ? "llm-proxy" : "api"
  }
}

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-http-api"
  protocol_type = "HTTP"

  # A única porta é o domínio próprio: ninguém contorna o domínio pelo endpoint execute-api.
  disable_execute_api_endpoint = true

  # Sem rota OPTIONS: com métodos explícitos, o próprio API Gateway responde o preflight.
  cors_configuration {
    allow_origins     = var.cors_allowed_origins
    allow_methods     = distinct([for key in keys(var.routes) : split(" ", key)[0]])
    allow_headers     = ["authorization", "content-type"]
    allow_credentials = false
    max_age           = 600
  }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  name             = "${var.name_prefix}-cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.jwt_issuer
    audience = var.jwt_audience
  }
}

resource "aws_apigatewayv2_integration" "this" {
  for_each = local.targets

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = var.function_invoke_arns[each.key]
  payload_format_version = "2.0"
  # Teto do HTTP API. O limite de cada função (10 s e 29 s) é do módulo functions.
  timeout_milliseconds = 30000
}

resource "aws_lambda_permission" "this" {
  for_each = local.targets

  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.function_names[each.key]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

# Toda rota leva o authorizer JWT: não existe rota pública.
resource "aws_apigatewayv2_route" "this" {
  for_each = var.routes

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.this[local.route_target[each.key]].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}
