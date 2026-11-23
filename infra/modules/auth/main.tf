# User Pool do ADR-0001. Tier ESSENTIALS (inclui o login gerenciado); o PLUS, mais caro, não é usado.
resource "aws_cognito_user_pool" "this" {
  name                = "${var.name_prefix}-users"
  user_pool_tier      = "ESSENTIALS"
  deletion_protection = "ACTIVE"
  mfa_configuration   = "OFF"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # Sem cadastro aberto, só o administrador cria contas.
  admin_create_user_config {
    allow_admin_create_user_only = !var.self_signup_enabled
  }

  # ASVS 5.0 6.2.1 e 6.2.5: vale o comprimento, sem regra de composição.
  password_policy {
    minimum_length                   = 15
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  # SES está fora de escopo: o e-mail sai pelo remetente padrão do Cognito.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Destruir o pool apagaria as identidades dos usuários.
  lifecycle {
    prevent_destroy = true
  }
}

# Cliente público (SPA): código de autorização com PKCE, sem segredo.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]

  # Explícito: sem a lista, o Cognito liga SRP e CUSTOM. Senha direta (USER_PASSWORD_AUTH) nunca entra.
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  # O e-mail é o único dado pessoal; sem restringir, um SignUp direto gravaria nome, telefone etc.
  read_attributes  = ["email", "email_verified"]
  write_attributes = ["email"]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 15
  id_token_validity      = 15
  refresh_token_validity = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# Domínio próprio (certificado no us-east-1) e login gerenciado v2.
resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.domain_name
  certificate_arn       = var.acm_certificate_arn
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 2
}

# Sem um estilo, o login gerenciado não atende um cliente criado por API.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.this.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
  depends_on                  = [aws_cognito_user_pool_domain.this]
}
