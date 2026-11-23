mock_provider "aws" {
  mock_data "aws_route53_zone" {
    defaults = { zone_id = "Z0000000EXAMPLE" }
  }
}

variables {
  zone_name   = "example.com"
  site_domain = "staging.example.com"
}

run "staging_com_aliases" {
  command = plan
  variables {
    site_alias = { name = "site.cf.example", zone_id = "ZSITE" }
    api_alias  = { name = "api.gw.example", zone_id = "ZAPI" }
    auth_alias = { name = "auth.cf.example", zone_id = "ZAUTH" }
  }
  assert {
    condition = alltrue([for k, n in { site = "staging.example.com", api = "api.staging.example.com", auth = "auth.staging.example.com" } :
    aws_acm_certificate.this[k].domain_name == n && aws_acm_certificate.this[k].validation_method == "DNS" && aws_acm_certificate.this[k].region == "us-east-1"])
    error_message = "Certificado com nome, método ou região errados."
  }
  assert {
    condition     = length(aws_route53_record.validation) == 3 && alltrue([for r in aws_route53_record.validation : r.zone_id == "Z0000000EXAMPLE"])
    error_message = "Esperados 3 registros de validação na zona lida."
  }
  assert {
    condition = alltrue([for r in [
      { rec = aws_route53_record.site, name = "staging.example.com", target = "site.cf.example", zone = "ZSITE" },
      { rec = aws_route53_record.api, name = "api.staging.example.com", target = "api.gw.example", zone = "ZAPI" },
      { rec = aws_route53_record.auth, name = "auth.staging.example.com", target = "auth.cf.example", zone = "ZAUTH" },
      ] : length(r.rec) == 1 && r.rec[0].type == "A" && r.rec[0].name == r.name && r.rec[0].zone_id == "Z0000000EXAMPLE" &&
    one(r.rec[0].alias).name == r.target && one(r.rec[0].alias).zone_id == r.zone])
    error_message = "Registro A com nome, zona ou alvo de alias errado."
  }
}

run "production_apex_sem_alias" {
  command = plan
  variables {
    site_domain = "example.com"
  }
  assert {
    condition     = output.domain_names == { site = "example.com", api = "api.example.com", auth = "auth.example.com" }
    error_message = "Nomes do apex errados."
  }
  assert {
    condition     = length(aws_route53_record.site) + length(aws_route53_record.api) + length(aws_route53_record.auth) == 0
    error_message = "Sem alias não deve haver registro A."
  }
}

run "dominio_fora_da_zona" {
  command = plan
  variables {
    site_domain = "staging.outro.com"
  }
  expect_failures = [var.site_domain]
}
