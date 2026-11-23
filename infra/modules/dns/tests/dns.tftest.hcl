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
}

run "dominio_fora_da_zona" {
  command = plan

  variables {
    site_domain = "staging.outro.com"
  }

  expect_failures = [var.site_domain]
}
