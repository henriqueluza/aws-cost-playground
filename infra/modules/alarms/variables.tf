variable "name_prefix" {
  description = "Prefixo do ambiente (`acp-stg` ou `acp-prod`); nomeia o tópico e os alarmes."
  type        = string

  validation {
    condition     = can(regex("^acp-(stg|prod)$", var.name_prefix))
    error_message = "name_prefix: acp-stg ou acp-prod."
  }
}

variable "function_names" {
  description = "Nome de cada função: saída `function_names` do módulo `functions`. As duas chaves são obrigatórias."
  type        = object({ api = string, llm-proxy = string })
}

variable "api_id" {
  description = "Id da HTTP API: saída `api_id` do módulo `http-api`."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{10}$", var.api_id))
    error_message = "api_id: id da HTTP API, 10 caracteres minúsculos ou dígitos."
  }
}

variable "alarm_email" {
  description = "E-mail que recebe os alarmes. Vem de `TF_VAR_alarm_email` no ambiente; nunca fica no repositório."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[a-zA-Z]{2,}$", var.alarm_email))
    error_message = "alarm_email: um endereço de e-mail."
  }
}
