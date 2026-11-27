# Só provider simulado: não usa credenciais nem chama a AWS.
# O `prevent_destroy` não aparece no terraform test: é conferido por leitura do main.tf.
mock_provider "aws" {
  mock_resource "aws_cognito_user_pool" {
    override_during = plan
    defaults = {
      endpoint = "cognito-idp.us-east-1.amazonaws.com/us-east-1_EXEMPLO"
    }
  }
}

variables {
  name_prefix         = "acp-stg"
  domain_name         = "auth.staging.exemplo.com"
  acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/0a1b2c3d-0000-4000-8000-000000000000"
  callback_urls       = ["https://staging.exemplo.com/auth/callback"]
  logout_urls         = ["https://staging.exemplo.com/"]
}

# C1: cliente público, só fluxo de código, sem senha direta.
run "c1_cliente_publico_so_codigo" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_client.web.generate_secret == false && aws_cognito_user_pool_client.web.allowed_oauth_flows_user_pool_client
    error_message = "O cliente deve ser público (sem segredo) e usar o fluxo OAuth."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.allowed_oauth_flows == toset(["code"]) && aws_cognito_user_pool_client.web.explicit_auth_flows == toset(["ALLOW_REFRESH_TOKEN_AUTH"])
    error_message = "Só fluxo code (sem implicit) e só refresh (sem senha direta, SRP nem CUSTOM)."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.allowed_oauth_scopes == toset(["openid", "email"]) && aws_cognito_user_pool_client.web.supported_identity_providers == toset(["COGNITO"])
    error_message = "Escopos openid e email e provedor COGNITO apenas."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.callback_urls == toset(var.callback_urls) && aws_cognito_user_pool_client.web.logout_urls == toset(var.logout_urls)
    error_message = "Callback e logout devem ser iguais às variáveis."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.prevent_user_existence_errors == "ENABLED" && aws_cognito_user_pool_client.web.read_attributes == toset(["email", "email_verified"]) && aws_cognito_user_pool_client.web.write_attributes == toset(["email"])
    error_message = "Erros de existência escondidos; leitura email e email_verified; escrita só email."
  }
}

# C2: cadastro fechado por padrão, e-mail verificado, senha e MFA.
run "c2_cadastro_fechado_por_padrao" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "Por padrão só o administrador cria contas."
  }
  assert {
    condition     = aws_cognito_user_pool.this.auto_verified_attributes == toset(["email"]) && aws_cognito_user_pool.this.username_attributes == toset(["email"]) && aws_cognito_user_pool.this.user_attribute_update_settings[0].attributes_require_verification_before_update == toset(["email"])
    error_message = "O login é o e-mail, verificado, e trocá-lo exige verificação antes."
  }
  assert {
    condition     = length(aws_cognito_user_pool.this.account_recovery_setting[0].recovery_mechanism) == 1 && one(aws_cognito_user_pool.this.account_recovery_setting[0].recovery_mechanism).name == "verified_email" && one(aws_cognito_user_pool.this.account_recovery_setting[0].recovery_mechanism).priority == 1
    error_message = "A recuperação é só por e-mail verificado."
  }
  assert {
    condition     = aws_cognito_user_pool.this.password_policy[0].minimum_length >= 15 && !aws_cognito_user_pool.this.password_policy[0].require_lowercase && !aws_cognito_user_pool.this.password_policy[0].require_uppercase && !aws_cognito_user_pool.this.password_policy[0].require_numbers && !aws_cognito_user_pool.this.password_policy[0].require_symbols
    error_message = "Senha de 15+ caracteres e sem regra de composição."
  }
  assert {
    condition     = aws_cognito_user_pool.this.mfa_configuration == "OFF" && aws_cognito_user_pool.this.sign_in_policy[0].allowed_first_auth_factors == toset(["PASSWORD"]) && aws_cognito_user_pool.this.username_configuration[0].case_sensitive == false
    error_message = "MFA desligado, só senha como primeiro fator e e-mail sem diferenciar maiúsculas."
  }
}

# #383: os dois ambientes passam `false` explicitamente; o pool sai só com criação pelo administrador.
run "c2_cadastro_fechado_quando_desligado" {
  command = plan
  variables { self_signup_enabled = false }
  assert {
    condition     = aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "Com self_signup_enabled = false só o administrador cria contas."
  }
}

run "c2_cadastro_aberto_quando_ligado" {
  command = plan
  variables { self_signup_enabled = true }
  assert {
    condition     = aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only == false
    error_message = "Com self_signup_enabled o cadastro fica aberto."
  }
}

# C3: tokens curtos e revogação.
run "c3_tokens_curtos_e_revogacao" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_client.web.access_token_validity == 15 && aws_cognito_user_pool_client.web.id_token_validity == 15 && aws_cognito_user_pool_client.web.refresh_token_validity == 1
    error_message = "Access e ID de 15 e refresh de 1."
  }
  assert {
    condition     = join(",", [for k in ["access_token", "id_token", "refresh_token"] : aws_cognito_user_pool_client.web.token_validity_units[0][k]]) == "minutes,minutes,days"
    error_message = "Unidades: minutos, minutos e dias."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.enable_token_revocation && length(aws_cognito_user_pool_client.web.refresh_token_rotation) == 0
    error_message = "Revogação ligada e sem rotação do refresh."
  }
}

# C4: proteção, tier e custo.
run "c4_protecao_tier_e_nomes" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool.this.deletion_protection == "ACTIVE" && aws_cognito_user_pool.this.user_pool_tier == "ESSENTIALS"
    error_message = "Proteção contra exclusão ativa e tier ESSENTIALS."
  }
  assert {
    condition     = length(aws_cognito_user_pool.this.user_pool_add_ons) == 0 && length(aws_cognito_user_pool.this.sms_configuration) == 0 && length(aws_cognito_user_pool.this.lambda_config) == 0
    error_message = "Sem add-ons, SMS nem gatilhos Lambda (custo e superfície)."
  }
  assert {
    condition     = aws_cognito_user_pool.this.email_configuration[0].email_sending_account == "COGNITO_DEFAULT" && aws_cognito_user_pool.this.name == "acp-stg-users" && aws_cognito_user_pool_client.web.name == "acp-stg-web"
    error_message = "E-mail pelo Cognito (sem SES) e nomes derivados do prefixo."
  }
}

run "dominio_branding_e_saidas" {
  command = plan
  assert {
    condition     = aws_cognito_user_pool_domain.this.managed_login_version == 2 && aws_cognito_user_pool_domain.this.domain == var.domain_name && aws_cognito_user_pool_domain.this.certificate_arn == var.acm_certificate_arn && aws_cognito_managed_login_branding.web.use_cognito_provided_values
    error_message = "Login gerenciado v2 no domínio próprio, com o certificado e o branding padrão do Cognito."
  }
  assert {
    condition     = output.issuer == "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXEMPLO" && output.domain_name == var.domain_name
    error_message = "O issuer deve ser https:// mais o endpoint do pool."
  }
}

# Validações de variável: cada variável inválida precisa falhar na sua própria validação.
run "rejeita_prefixo_dominio_e_certificado_invalidos" {
  command = plan
  variables {
    name_prefix         = "acp-dev"
    domain_name         = "login.exemplo.com"
    acm_certificate_arn = "arn:aws:acm:sa-east-1:123456789012:certificate/0a1b2c3d-0000-4000-8000-000000000000"
  }
  expect_failures = [var.name_prefix, var.domain_name, var.acm_certificate_arn]
}

run "rejeita_urls_http" {
  command = plan
  variables {
    callback_urls = ["http://staging.exemplo.com/auth/callback"]
    logout_urls   = ["http://staging.exemplo.com/"]
  }
  expect_failures = [var.callback_urls, var.logout_urls]
}

run "rejeita_urls_com_curinga" {
  command = plan
  variables {
    callback_urls = ["https://*.exemplo.com/cb"]
    logout_urls   = ["https://*.exemplo.com/"]
  }
  expect_failures = [var.callback_urls, var.logout_urls]
}

run "rejeita_urls_vazias" {
  command = plan
  variables {
    callback_urls = []
    logout_urls   = []
  }
  expect_failures = [var.callback_urls, var.logout_urls]
}

run "rejeita_localhost_em_lista_mista" {
  command = plan
  variables { callback_urls = ["https://staging.exemplo.com/auth/callback", "http://localhost:5173/auth/callback"] }
  expect_failures = [var.callback_urls]
}

# O padrão compartilhado pelas duas variáveis, caso a caso: cada URL ruim tem de ser recusada sozinha.
run "padrao_de_url_caso_a_caso" {
  command = plan
  assert {
    condition = !anytrue([for u in [
      "https://a.exemplo.com:8443/cb", "https://a.exemplo.com/cb?x=1", "https://a.exemplo.com/cb#x", "https://u:p@a.exemplo.com/cb",
      "https://localhost/cb", "https://A.exemplo.com/cb", "https://a.exemplo.com/../cb", "https://a.exemplo.com/a/..", "https://a.exemplo.com//b.com",
    ] : can(regex(local.https_url_pattern, u))])
    error_message = "O padrão aceitou porta, query, fragmento, credencial, host sem ponto, maiúscula no host, `..` ou `//`."
  }
  assert {
    condition     = alltrue([for u in ["https://a.exemplo.com", "https://a.exemplo.com/", "https://a.exemplo.com/auth/callback", "https://a.exemplo.com/a/b/", "https://a.b.exemplo.com/cb"] : can(regex(local.https_url_pattern, u))])
    error_message = "O padrão recusou uma URL legítima."
  }
}
