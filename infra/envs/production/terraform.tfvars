# Valores de production. Sem segredo: domínio, e-mail de alarme e pacote das funções entram
# por TF_VAR_* do GitHub Environment `production`.
environment = "production"
# Cadastro aberto em produção: decisão do autor na #139 (risco aceito, registrado no ADR:
# cota de 50 e-mails/dia do remetente padrão do Cognito e enumeração de e-mails no cadastro).
self_signup_enabled            = true
point_in_time_recovery_enabled = true
llm_enabled                    = false
default_throttle               = { rate_limit = 10, burst_limit = 20 }
estimates_throttle             = { rate_limit = 1, burst_limit = 5 }
