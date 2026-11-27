# Valores de production. Sem segredo: domínio, e-mail de alarme e pacote das funções entram
# por TF_VAR_* do GitHub Environment `production`.
environment = "production"
# Cadastro fechado até depois da apresentação: decisão do autor de 26/11/2026 (#383), que substitui
# a da #139. Reabrir exige antes a opção a da #277 e a opção b da #284 (ADR, "Segurança").
self_signup_enabled            = false
point_in_time_recovery_enabled = true
llm_enabled                    = false
default_throttle               = { rate_limit = 10, burst_limit = 20 }
estimates_throttle             = { rate_limit = 1, burst_limit = 5 }
