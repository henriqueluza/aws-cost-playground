locals {
  # Só `https://<host>[/caminho]`: recusa `http`, curinga, porta, query, fragmento e credencial.
  https_url_pattern = "^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}(/[A-Za-z0-9._~/-]*)?$"
}

variable "name_prefix" {
  description = "Prefixo do ambiente (`acp-stg` ou `acp-prod`); nomeia o pool (`<prefixo>-users`) e o cliente (`<prefixo>-web`)."
  type        = string

  validation {
    condition     = can(regex("^acp-(stg|prod)$", var.name_prefix))
    error_message = "name_prefix: acp-stg ou acp-prod."
  }
}

variable "domain_name" {
  description = "Domínio próprio do login gerenciado (`auth.<domínio>`). Precisa estar no certificado, e o domínio pai precisa ter registro A."
  type        = string

  validation {
    condition = length(var.domain_name) <= 63 && can(regex(
      "^auth\\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain_name
    ))
    error_message = "domain_name: `auth.<domínio>` em minúsculas, até 63 caracteres, sem esquema nem porta."
  }
}

variable "acm_certificate_arn" {
  description = "ARN do certificado ACM emitido em us-east-1 que cobre `domain_name` (vem do módulo `dns`)."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[0-9a-f-]+$", var.acm_certificate_arn))
    error_message = "acm_certificate_arn: certificado ACM em us-east-1, a única região que o domínio do Cognito aceita."
  }
}

variable "callback_urls" {
  description = "URLs de retorno do login, idênticas ao `redirect_uri` que o site envia (ex.: `https://<site>/auth/callback`)."
  type        = list(string)

  validation {
    condition     = length(var.callback_urls) > 0 && alltrue([for u in var.callback_urls : can(regex(local.https_url_pattern, u))])
    error_message = "callback_urls: ao menos uma URL `https://<host>/<caminho>`, sem curinga, porta, query nem fragmento."
  }
}

variable "logout_urls" {
  description = "URLs de retorno do logout, idênticas ao `logout_uri` que o site envia (ex.: `https://<site>/`)."
  type        = list(string)

  validation {
    condition     = length(var.logout_urls) > 0 && alltrue([for u in var.logout_urls : can(regex(local.https_url_pattern, u))])
    error_message = "logout_urls: ao menos uma URL `https://<host>/<caminho>`, sem curinga, porta, query nem fragmento."
  }
}

variable "self_signup_enabled" {
  description = "Abre o cadastro pelo login gerenciado. Desligado (padrão), só o administrador cria contas, como em staging."
  type        = bool
  default     = false
}
