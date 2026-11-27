# Buckets de artefatos: o deploy grava o zip das Lambdas em `functions/<sha>.zip` antes do
# Terraform do ambiente, e o Lambda o lê com a permissão de quem chama `CreateFunction` e
# `UpdateFunctionCode`. Um por ambiente: o papel de staging não troca o pacote de produção.
# Sem regra de expiração aqui: lifecycle é configuração de custo manual do autor (runbook de
# guardrails, passo 7).
locals {
  # O nome não casa com `acp-<prefixo>-*`: um `Allow` por prefixo do ambiente não o alcança, e
  # as negações do bucket de estado (`DenyStateBucketConfig`) não se confundem com ele.
  artifacts_bucket_arn = {
    for env, prefix in local.environments : env => "arn:aws:s3:::acp-artifacts-${prefix}-${data.aws_caller_identity.current.account_id}"
  }
}

resource "aws_s3_bucket" "artifacts" {
  for_each = local.environments

  bucket = "acp-artifacts-${each.value}-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  for_each = aws_s3_bucket.artifacts

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (AES-256), sem custo, como no bucket de estado: chave própria do KMS é custo fixo.
#trivy:ignore:AVD-AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  for_each = aws_s3_bucket.artifacts

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  for_each = aws_s3_bucket.artifacts

  bucket = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "artifacts" {
  for_each = aws_s3_bucket.artifacts

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
  depends_on = [aws_s3_bucket_public_access_block.artifacts]
}

# Política inline própria, para não disputar espaço com as travas de identidade. O deploy usa
# `put-object --if-none-match` (`s3:PutObject`) e `head-object` (`s3:GetObject`); o Lambda lê o
# zip com `GetObject`. Sem listar, sem apagar e sem versão: nada disso é chamado.
resource "aws_iam_role_policy" "apply_artifacts" {
  for_each = local.environments

  name = "artifacts"
  role = aws_iam_role.apply[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "FunctionPackages"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${local.artifacts_bucket_arn[each.key]}/functions/*"
      },
      {
        # No bucket de artefatos só passam as duas ações do deploy: configuração, política,
        # versionamento, exclusão de objeto e de versão ficam negados, também a um `Allow` futuro.
        Sid       = "DenyArtifactsBucketConfig"
        Effect    = "Deny"
        NotAction = ["s3:GetObject", "s3:PutObject"]
        Resource  = [local.artifacts_bucket_arn[each.key], "${local.artifacts_bucket_arn[each.key]}/*"]
      },
      {
        # O papel de um ambiente não lê nem grava o pacote do outro.
        Sid      = "DenyOtherEnvironmentArtifacts"
        Effect   = "Deny"
        Action   = "s3:*"
        Resource = flatten([for env, arn in local.artifacts_bucket_arn : [arn, "${arn}/*"] if env != each.key])
      },
    ]
  })
}
