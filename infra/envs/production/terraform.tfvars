# Valores de production. Sem segredo: domínio, e-mail de alarme e pacote das funções entram
# por TF_VAR_* do GitHub Environment `production`.
environment = "production"
# Cadastro aberto fica fechado até o autor decidir a #139 (cota e enumeração do remetente
# padrão do Cognito). Decidido abrir, basta trocar esta linha para true, por PR.
self_signup_enabled            = false
point_in_time_recovery_enabled = true
llm_enabled                    = false
default_throttle               = { rate_limit = 10, burst_limit = 20 }
estimates_throttle             = { rate_limit = 1, burst_limit = 5 }
