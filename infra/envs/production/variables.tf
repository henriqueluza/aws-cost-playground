# Variáveis do ambiente. Arquivo igual em staging e production: o que muda entre os dois
# fica em `terraform.tfvars` (versionado, sem segredo) ou entra por `TF_VAR_*` do
# GitHub Environment (domínio, e-mail de alarme e pacote das funções). Nenhuma tem default.

variable "environment" {
  description = "Ambiente: staging ou production. Define o prefixo dos nomes (acp-stg, acp-prod) e o domínio do site."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment: só staging ou production."
  }
}

variable "self_signup_enabled" {
  description = "Abre o cadastro pelo login gerenciado do Cognito e o botão \"Criar conta\" do site. False nos dois ambientes (#383)."
  type        = bool
}

variable "point_in_time_recovery_enabled" {
  description = "Liga o PITR da tabela. Staging false; production true."
  type        = bool
}

variable "llm_enabled" {
  description = "Valor de LLM_ENABLED do llm-proxy. Ligar gasta dinheiro: só com o parâmetro da chave criado."
  type        = bool
}

variable "default_throttle" {
  description = "Limite de taxa das rotas sem limite próprio (runbook de guardrails, passo 2)."
  type        = object({ rate_limit = number, burst_limit = number })
}

variable "estimates_throttle" {
  description = "Limite de taxa de POST /estimates, a rota que chama a LLM (runbook de guardrails, passo 2)."
  type        = object({ rate_limit = number, burst_limit = number })
}

variable "zone_name" {
  description = "Domínio do produto: zona pública do Route 53, do autor. Vem de TF_VAR_zone_name (GitHub Environment)."
  type        = string
}

variable "alarm_email" {
  description = "E-mail que recebe os alarmes. Vem de TF_VAR_alarm_email (GitHub Environment); nunca fica no repositório."
  type        = string
  sensitive   = true
}

variable "package_bucket" {
  description = "Bucket de artefatos com o zip das funções. Vem de TF_VAR_package_bucket (GitHub Environment)."
  type        = string
}

variable "package_key" {
  description = "Chave do zip das funções no bucket, por SHA do commit. Vem de TF_VAR_package_key, montada pelo pipeline."
  type        = string
}
