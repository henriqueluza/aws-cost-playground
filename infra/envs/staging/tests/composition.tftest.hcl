# Plano da raiz inteira com provider simulado: sem credenciais e sem tocar a AWS.
# Prova que os sete módulos compõem sem ciclo (site, dns, auth e http-api se alimentam
# nos dois sentidos) e que as validações de cada módulo aceitam os valores da raiz.
# Lê o terraform.tfvars do ambiente; o resto são valores fictícios.
# Rodar: terraform -chdir=infra/envs/staging init -backend=false && terraform -chdir=infra/envs/staging test

mock_provider "aws" {}

override_data {
  target          = module.dns.data.aws_route53_zone.this
  override_during = plan
  values          = { zone_id = "Z0000000000000000000", name = "exemplo.com" }
}

override_data {
  target          = module.alarms.data.aws_caller_identity.current
  override_during = plan
  values          = { account_id = "111111111111" }
}

override_data {
  target          = module.alarms.data.aws_region.current
  override_during = plan
  values          = { region = "us-east-1" }
}

variables {
  zone_name      = "exemplo.com"
  alarm_email    = "alarmes@exemplo.com"
  package_bucket = "acp-artefatos-exemplo"
  package_key    = "functions/0000000.zip"
}

run "compoe_sem_ciclo_com_nomes_de_staging" {
  command = plan

  assert {
    condition     = module.database.table_name == "acp-stg-main"
    error_message = "A tabela de staging deve se chamar acp-stg-main."
  }

  assert {
    condition     = output.function_names == { api = "acp-stg-api", "llm-proxy" = "acp-stg-llm-proxy" }
    error_message = "As funções de staging devem seguir acp-stg-*."
  }

  assert {
    condition     = output.site_config.apiBaseUrl == "https://api.staging.exemplo.com"
    error_message = "O /config.json de staging deve apontar para api.staging.<domínio>."
  }
}
