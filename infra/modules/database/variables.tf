variable "name" {
  description = "Nome da tabela, no padrão <projeto>-<ambiente>-<componente> (ex.: acp-stg-main)."
  type        = string

  validation {
    condition     = can(regex("^acp-(stg|prod)-[a-z0-9-]{1,40}$", var.name))
    error_message = "O nome deve seguir o padrão acp-stg-<componente> ou acp-prod-<componente>, em minúsculas."
  }
}

variable "point_in_time_recovery_enabled" {
  description = "Liga a recuperação point-in-time (PITR). Ligado em produção; staging desliga de forma explícita."
  type        = bool
  default     = true
}
