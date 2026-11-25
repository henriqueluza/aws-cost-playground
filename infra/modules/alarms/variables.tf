variable "name_prefix" {
  description = "Prefixo do ambiente (`acp-stg` ou `acp-prod`); nomeia o tópico e os alarmes."
  type        = string

  validation {
    condition     = can(regex("^acp-(stg|prod)$", var.name_prefix))
    error_message = "name_prefix: acp-stg ou acp-prod."
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
