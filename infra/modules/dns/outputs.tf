output "zone_id" {
  description = "Id da zona lida."
  value       = data.aws_route53_zone.this.zone_id
}

output "domain_names" {
  description = "Nomes do ambiente por chave: site, api e auth."
  value       = local.domain_names
}

output "certificate_arns" {
  description = "ARN de cada certificado já emitido, por chave (site, api, auth)."
  value       = { for key, validation in aws_acm_certificate_validation.this : key => validation.certificate_arn }
}

output "auth_domain" {
  description = "Nome do login, liberado só depois do registro A do site: a AWS exige o domínio pai resolvendo antes de criar o domínio do Cognito."
  value       = local.domain_names.auth
  depends_on  = [aws_route53_record.site]
}
