# Sempre criado (sem count): a API só atende por este domínio, porque o endpoint execute-api fica desligado.
# Sem prevent_destroy: não guarda dado nem identidade e se recria do código; o plan-guard já barra delete e replace.
resource "aws_apigatewayv2_domain_name" "this" {
  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = var.acm_certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

# Sem api_mapping_key: o domínio inteiro aponta para o stage $default.
resource "aws_apigatewayv2_api_mapping" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  domain_name = aws_apigatewayv2_domain_name.this.domain_name
  stage       = aws_apigatewayv2_stage.default.name
}
