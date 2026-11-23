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
