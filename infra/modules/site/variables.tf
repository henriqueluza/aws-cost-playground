variable "name_prefix" {
  description = "Prefixo do ambiente (`acp-stg` ou `acp-prod`); nomeia o OAC e as políticas do CloudFront."
  type        = string

  validation {
    condition     = can(regex("^acp-(stg|prod)$", var.name_prefix))
    error_message = "name_prefix: acp-stg ou acp-prod."
  }
}

variable "bucket_name" {
  description = "Nome do bucket do site. É global na AWS, então quem chama garante que é único."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name: 3 a 63 caracteres, só minúsculas, números e hífen, sem hífen nas pontas."
  }
}

variable "aliases" {
  description = "Domínios servidos pela distribuição (ex.: `[\"staging.exemplo.com\"]`); precisam estar no certificado."
  type        = list(string)

  validation {
    condition = length(var.aliases) > 0 && alltrue([
      for a in var.aliases : can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", a))
    ])
    error_message = "aliases: ao menos um domínio, em minúsculas, sem esquema, porta nem curinga."
  }
}

variable "acm_certificate_arn" {
  description = "ARN do certificado ACM em us-east-1 que cobre os `aliases` (vem do módulo `dns`)."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[0-9a-f-]+$", var.acm_certificate_arn))
    error_message = "acm_certificate_arn: certificado ACM em us-east-1, a única região que o CloudFront aceita."
  }
}

variable "connect_src_origins" {
  description = "Origens que o site chama, liberadas no `connect-src` da CSP: API, `auth.<domínio>` e `cognito-idp.us-east-1.amazonaws.com`."
  type        = list(string)

  validation {
    condition = alltrue([
      for o in var.connect_src_origins : can(regex("^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", o))
    ])
    error_message = "connect_src_origins: só `https://<host>`, sem caminho, porta, curinga, espaço nem barra final."
  }
}
