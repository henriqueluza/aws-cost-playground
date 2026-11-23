locals {
  domain_names = {
    site = var.site_domain
    api  = "api.${var.site_domain}"
    auth = "auth.${var.site_domain}"
  }
}

# A zona é do autor: o módulo só a lê, nunca a cria nem a apaga.
data "aws_route53_zone" "this" {
  name         = var.zone_name
  private_zone = false
}

# Um certificado por nome, sem SANs. us-east-1 é exigido pelo CloudFront e pelo Cognito.
resource "aws_acm_certificate" "this" {
  for_each = local.domain_names

  region            = "us-east-1"
  domain_name       = each.value
  validation_method = "DNS"

  # Na troca, o novo nasce antes: o antigo segue em uso no CloudFront, na API ou no Cognito.
  lifecycle {
    create_before_destroy = true
  }
}

# Sem allow_overwrite: registro manual com o mesmo nome faz o apply falhar.
resource "aws_route53_record" "validation" {
  for_each = aws_acm_certificate.this

  zone_id = data.aws_route53_zone.this.zone_id
  name    = one(each.value.domain_validation_options).resource_record_name
  type    = one(each.value.domain_validation_options).resource_record_type
  records = [one(each.value.domain_validation_options).resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "this" {
  for_each = aws_acm_certificate.this

  region                  = "us-east-1"
  certificate_arn         = each.value.arn
  validation_record_fqdns = [aws_route53_record.validation[each.key].fqdn]
}
