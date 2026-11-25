# Só de teste: o Cognito lê auth_domain e devolve o alvo em auth_alias (ciclo = plan falha). Site literal.
terraform {
  required_version = "~> 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
  }
}

module "dns" {
  source = "../.."

  zone_name   = "example.com"
  site_domain = "staging.example.com"

  site_alias = { name = "d111111abcdef8.cloudfront.net", zone_id = "Z2FDTNDATAQYW2" }
  auth_alias = {
    name    = aws_cognito_user_pool_domain.this.cloudfront_distribution
    zone_id = aws_cognito_user_pool_domain.this.cloudfront_distribution_zone_id
  }
}

resource "aws_cognito_user_pool" "this" {
  name = "consumer"
}

resource "aws_cognito_user_pool_domain" "this" {
  domain          = module.dns.auth_domain
  certificate_arn = module.dns.certificate_arns["auth"]
  user_pool_id    = aws_cognito_user_pool.this.id
}
