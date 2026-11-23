locals {
  # Só variáveis de $context: sem cabeçalho (nem Authorization), corpo, e-mail, IP ou user-agent.
  # `sub` é o pseudônimo do usuário, já usado como chave no DynamoDB.
  access_log_format = jsonencode({
    requestId          = "$context.requestId"
    requestTime        = "$context.requestTime"
    routeKey           = "$context.routeKey"
    status             = "$context.status"
    protocol           = "$context.protocol"
    responseLength     = "$context.responseLength"
    responseLatency    = "$context.responseLatency"
    integrationLatency = "$context.integrationLatency"
    integrationError   = "$context.integrationErrorMessage"
    authorizerError    = "$context.authorizer.error"
    errorMessage       = "$context.error.message"
    sub                = "$context.authorizer.claims.sub"
  })
}

# Criado aqui para nascer com retenção. Sem CMK do KMS (custo fixo vetado pelo ADR) e sem prevent_destroy (log
# descartável, expira em dias). O prefixo vendedlogs evita estourar a resource policy do CloudWatch Logs.
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/vendedlogs/apigateway/${var.name_prefix}-http-api"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format          = local.access_log_format
  }

  default_route_settings {
    throttling_rate_limit  = var.default_throttle.rate_limit
    throttling_burst_limit = var.default_throttle.burst_limit
  }

  # A chave é a mesma do map de rotas: não há como o limite apontar para uma rota que não existe.
  dynamic "route_settings" {
    for_each = { for key, route in var.routes : key => route.throttle if route.throttle != null }

    content {
      route_key              = route_settings.key
      throttling_rate_limit  = route_settings.value.rate_limit
      throttling_burst_limit = route_settings.value.burst_limit
    }
  }

  # A API recusa route_settings de rota que ainda não existe; com auto_deploy, o deployment é do próprio stage.
  depends_on = [aws_apigatewayv2_route.this]
}
