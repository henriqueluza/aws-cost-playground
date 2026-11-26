variable "environment" {
  description = "Ambiente: staging ou production. Define o prefixo dos nomes (acp-stg, acp-prod) e o caminho do parâmetro."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "O ambiente deve ser staging ou production."
  }
}

variable "table_arn" {
  description = "ARN da tabela DynamoDB do ambiente (saída table_arn do módulo database). O nome da tabela sai dele."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:dynamodb:[a-z0-9-]+:[0-9]{12}:table/[A-Za-z0-9_.-]+$", var.table_arn))
    error_message = "Informe o ARN completo de uma tabela, sem curinga."
  }
}

variable "user_pool_arn" {
  description = "ARN do User Pool do Cognito do ambiente. O id do pool sai dele."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:cognito-idp:[a-z0-9-]+:[0-9]{12}:userpool/[A-Za-z0-9_-]+$", var.user_pool_arn))
    error_message = "Informe o ARN completo de um User Pool, sem curinga."
  }
}

variable "package_bucket" {
  description = "Bucket de artefatos onde o CI guarda o zip das funções."
  type        = string
}

variable "package_key" {
  description = "Chave do zip no bucket de artefatos, por SHA do commit. As duas funções usam o mesmo pacote."
  type        = string
}

variable "api_handler" {
  description = "Handler da função api dentro do pacote (ex.: app.main.handler)."
  type        = string
}

variable "llm_proxy_handler" {
  description = "Handler da função llm-proxy dentro do pacote."
  type        = string
}

variable "log_retention_days" {
  description = "Retenção dos log groups das funções, em dias. O ADR e o runbook de custo pedem 7."
  type        = number
  default     = 7

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30], var.log_retention_days)
    error_message = "Use 1, 3, 5, 7, 14 ou 30 dias: log sem expiração ou de retenção longa não é aceito."
  }
}

variable "llm_enabled" {
  description = "Interruptor LLM_ENABLED do llm-proxy. Com false, o proxy responde 503 sem chamar a Claude API."
  type        = bool
  default     = false
}
