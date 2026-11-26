# Valores de staging. Sem segredo: domínio, e-mail de alarme e pacote das funções entram
# por TF_VAR_* do GitHub Environment `staging`.
environment                    = "staging"
self_signup_enabled            = false
point_in_time_recovery_enabled = false
llm_enabled                    = false
default_throttle               = { rate_limit = 10, burst_limit = 20 }
estimates_throttle             = { rate_limit = 1, burst_limit = 5 }
