# Tabela única do ADR-0001: on-demand, sem capacidade provisionada e sem índice secundário.
resource "aws_dynamodb_table" "this" {
  name         = var.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  deletion_protection_enabled = true

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery_enabled
  }

  # Criptografia em repouso: sem bloco `server_side_encryption`, vale a chave de propriedade da AWS
  # (AES-256, padrão do serviço, sem custo). O bloco trocaria para uma chave do KMS, cobrada por requisição.

  lifecycle {
    prevent_destroy = true
  }
}
