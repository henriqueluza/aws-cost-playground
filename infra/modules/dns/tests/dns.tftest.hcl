# Só provider simulado: não usa credenciais nem chama a AWS.
mock_provider "aws" {
  mock_data "aws_route53_zone" {
    defaults = { zone_id = "Z0000000EXAMPLE" }
  }
}

variables {
  zone_name   = "example.com"
  site_domain = "staging.example.com"
}

run "certificados_dns_em_us_east_1" {
  command = plan

  assert {
    condition     = { for k, c in aws_acm_certificate.this : k => c.domain_name } == { site = "staging.example.com", api = "api.staging.example.com", auth = "auth.staging.example.com" }
    error_message = "Esperado um certificado para cada nome do ambiente."
  }

  assert {
    condition     = alltrue([for c in aws_acm_certificate.this : c.validation_method == "DNS" && c.region == "us-east-1"])
    error_message = "Os certificados devem usar validação DNS em us-east-1."
  }

  assert {
    condition     = alltrue([for v in aws_acm_certificate_validation.this : v.region == "us-east-1"]) && length(aws_acm_certificate_validation.this) == 3
    error_message = "Cada certificado deve esperar a validação em us-east-1."
  }

  assert {
    condition     = length(aws_route53_record.validation) == 3 && alltrue([for r in aws_route53_record.validation : r.zone_id == "Z0000000EXAMPLE"])
    error_message = "Os registros de validação devem ficar na zona lida."
  }

  assert {
    condition     = output.zone_id == "Z0000000EXAMPLE" && data.aws_route53_zone.this.name == "example.com" && !data.aws_route53_zone.this.private_zone
    error_message = "A zona pública deve ser lida como data source, pelo nome."
  }
}

run "producao_no_apex" {
  command = plan

  variables {
    site_domain = "example.com"
  }

  assert {
    condition     = output.domain_names == { site = "example.com", api = "api.example.com", auth = "auth.example.com" }
    error_message = "Em production, os nomes partem do apex da zona."
  }

  assert {
    condition     = length(aws_route53_record.site) + length(aws_route53_record.api) + length(aws_route53_record.auth) == 0
    error_message = "Sem alvo informado, não deve haver registro alias."
  }
}

run "aliases_para_os_tres_alvos" {
  command = plan

  variables {
    site_alias = { name = "site.cf.example", zone_id = "ZSITE" }
    api_alias  = { name = "api.gw.example", zone_id = "ZAPI" }
    auth_alias = { name = "auth.cf.example", zone_id = "ZAUTH" }
  }

  assert {
    condition = alltrue([for r in [
      { rec = aws_route53_record.site, name = "staging.example.com", target = "site.cf.example", zone = "ZSITE" },
      { rec = aws_route53_record.api, name = "api.staging.example.com", target = "api.gw.example", zone = "ZAPI" },
      { rec = aws_route53_record.auth, name = "auth.staging.example.com", target = "auth.cf.example", zone = "ZAUTH" },
      ] : length(r.rec) == 1 && r.rec[0].type == "A" && r.rec[0].name == r.name && r.rec[0].zone_id == "Z0000000EXAMPLE" &&
    one(r.rec[0].alias).name == r.target && one(r.rec[0].alias).zone_id == r.zone && !one(r.rec[0].alias).evaluate_target_health]) && output.auth_domain == "auth.staging.example.com"
    error_message = "Cada alias deve ser um registro A na zona lida, com o nome e o alvo do seu serviço; auth_domain é o nome do login."
  }
}

run "so_o_alvo_informado_ganha_registro" {
  command = plan

  variables {
    api_alias = { name = "api.gw.example", zone_id = "ZAPI" }
  }

  assert {
    condition     = length(aws_route53_record.api) == 1 && length(aws_route53_record.site) == 0 && length(aws_route53_record.auth) == 0
    error_message = "Só o alias com alvo informado deve ser criado."
  }
}

# O Cognito consome auth_domain e devolve o alvo em auth_alias: o plan só passa sem ciclo.
run "consumidor_com_cognito_sem_ciclo" {
  command = plan

  module {
    source = "./tests/consumer"
  }
}

run "dominio_fora_da_zona" {
  command = plan

  variables {
    site_domain = "staging.outro.com"
  }

  expect_failures = [var.site_domain]
}
