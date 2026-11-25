# Buckets de estado dos ambientes. O backend de `infra/envs/*` usa lock nativo do S3
# (`use_lockfile`), então não há tabela de lock. As versões antigas são a proteção do
# estado: não há regra de expiração.
data "aws_caller_identity" "current" {}

locals {
  # Ambiente => prefixo de nomes do ADR (`acp-stg-*`, `acp-prod-*`).
  environments = {
    staging    = "stg"
    production = "prod"
  }
}

resource "aws_s3_bucket" "state" {
  for_each = local.environments

  # Nome de bucket é global: o sufixo é o ID da conta, lido da credencial, nunca fixo no código.
  bucket = "acp-${each.value}-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  for_each = aws_s3_bucket.state

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (AES-256), sem custo. Uma chave própria do KMS custa US$ 1/mês por chave, custo
# fixo que o projeto proíbe; por isso o achado de "chave gerenciada pelo cliente" é ignorado.
#trivy:ignore:AVD-AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  for_each = aws_s3_bucket.state

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  for_each = aws_s3_bucket.state

  bucket = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "state" {
  for_each = aws_s3_bucket.state

  bucket = each.value.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [each.value.arn, "${each.value.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  # A política sai depois do bloqueio de acesso público, para as duas chamadas não colidirem.
  depends_on = [aws_s3_bucket_public_access_block.state]
}
