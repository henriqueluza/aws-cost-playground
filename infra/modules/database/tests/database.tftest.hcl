# Só provider simulado: não usa credenciais nem chama a AWS.
mock_provider "aws" {}

variables {
  name = "acp-stg-main"
}

run "tabela_unica_on_demand" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.this.billing_mode == "PAY_PER_REQUEST"
    error_message = "A tabela deve ser on-demand."
  }

  assert {
    condition     = aws_dynamodb_table.this.hash_key == "PK" && aws_dynamodb_table.this.range_key == "SK"
    error_message = "As chaves devem ser PK e SK."
  }

  assert {
    condition     = { for a in aws_dynamodb_table.this.attribute : a.name => a.type } == { PK = "S", SK = "S" }
    error_message = "Só PK e SK são declarados, ambos string."
  }

  assert {
    condition     = length(aws_dynamodb_table.this.global_secondary_index) == 0 && length(aws_dynamodb_table.this.local_secondary_index) == 0
    error_message = "Não pode haver índice secundário."
  }

  assert {
    condition     = aws_dynamodb_table.this.ttl[0].attribute_name == "ttl" && aws_dynamodb_table.this.ttl[0].enabled
    error_message = "O TTL deve estar ligado no atributo ttl."
  }

  assert {
    condition     = aws_dynamodb_table.this.deletion_protection_enabled
    error_message = "A proteção contra exclusão deve estar ligada."
  }

  assert {
    condition     = aws_dynamodb_table.this.point_in_time_recovery[0].enabled
    error_message = "O PITR deve vir ligado por padrão."
  }
}

run "pitr_desligado_por_variavel" {
  command = plan

  variables {
    point_in_time_recovery_enabled = false
  }

  assert {
    condition     = !aws_dynamodb_table.this.point_in_time_recovery[0].enabled
    error_message = "O PITR deve seguir a variável."
  }
}

run "nome_fora_do_padrao_e_recusado" {
  command = plan

  variables {
    name = "Tabela_Qualquer"
  }

  expect_failures = [var.name]
}
