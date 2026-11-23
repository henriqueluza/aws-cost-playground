# Estado remoto do ambiente `staging`, com lock nativo do S3 (sem tabela DynamoDB).
# O bucket nasce no `infra/bootstrap/`, aplicado à mão pelo autor; o nome entra no
# `init` por `-backend-config="bucket=..."` (variável do GitHub), nunca no código.
terraform {
  backend "s3" {
    key          = "acp-stg/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
