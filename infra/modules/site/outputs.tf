output "bucket_name" {
  description = "Nome do bucket do site (destino do deploy do bundle e do `/config.json`)."
  value       = aws_s3_bucket.this.id
}

output "distribution_id" {
  description = "Id da distribuição (para a invalidação de cache no deploy)."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_domain_name" {
  description = "Domínio `*.cloudfront.net`, alvo do registro de alias no módulo `dns`."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_hosted_zone_id" {
  description = "Zona hospedada do CloudFront, usada no registro de alias do Route 53."
  value       = aws_cloudfront_distribution.this.hosted_zone_id
}
