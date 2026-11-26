# Plano da raiz inteira com provider simulado: sem credenciais e sem tocar a AWS.
# Espelha o teste de staging: os mesmos sete módulos compõem sem ciclo com os valores
# de production. Lê o terraform.tfvars do ambiente; o resto são valores fictícios.
# Rodar: terraform -chdir=infra/envs/production init -backend=false && terraform -chdir=infra/envs/production test

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

run "compoe_sem_ciclo_com_nomes_de_production" {
  command = plan

  assert {
    condition     = module.database.table_name == "acp-prod-main"
    error_message = "A tabela de production deve se chamar acp-prod-main."
  }

  assert {
    condition     = var.point_in_time_recovery_enabled
    error_message = "Production guarda dado real: o PITR da tabela fica ligado."
  }

  assert {
    condition     = output.function_names == { api = "acp-prod-api", "llm-proxy" = "acp-prod-llm-proxy" }
    error_message = "As funções de production devem seguir acp-prod-*."
  }

  assert {
    condition     = output.llm_api_key_parameter_name == "/acp/production/anthropic-api-key"
    error_message = "O parâmetro da chave é criado à mão; a raiz só expõe o nome."
  }

  assert {
    condition     = length(module.alarms.alarm_names) == 5 && alltrue([for n in values(module.alarms.alarm_names) : startswith(n, "acp-prod-")])
    error_message = "Cinco alarmes acp-prod-* por ambiente: os dois somam a franquia de 10 do CloudWatch."
  }

  assert {
    condition     = output.site_url == "https://exemplo.com"
    error_message = "O smoke test do deploy usa site_url: https://<host>, sem barra final."
  }

  assert {
    condition     = output.site_config.apiBaseUrl == "https://api.exemplo.com"
    error_message = "O /config.json de production deve apontar para api.<domínio>, sem subdomínio de ambiente."
  }
}

run "rotas_de_designs_atras_do_jwt_e_patch_no_cors" {
  command = plan

  assert {
    condition = toset(module.http_api.route_keys) == toset([
      "POST /estimates", "GET /quota", "DELETE /me",
      "GET /designs", "POST /designs", "GET /designs/{design_id}",
      "PATCH /designs/{design_id}", "DELETE /designs/{design_id}", "POST /designs/{design_id}/duplicate",
    ])
    error_message = "O gateway deve declarar as três rotas atuais e as seis de designs, com design_id."
  }

  assert {
    condition     = module.http_api.cors_allow_methods == toset(["GET", "POST", "PATCH", "DELETE"])
    error_message = "O CORS deve liberar GET, POST, PATCH e DELETE."
  }
}
