variable "name_prefix" {
  description = "Prefixo do ambiente (`acp-stg` ou `acp-prod`); nomeia a API, o authorizer e o log group."
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

variable "function_invoke_arns" {
  description = "ARN de invocação de cada função: saída `function_invoke_arns` do módulo `functions`."
  type        = object({ api = string, llm-proxy = string })
}

variable "jwt_issuer" {
  description = "Emissor dos tokens (saída `issuer` do módulo `auth`)."
  type        = string

  validation {
    condition     = can(regex("^https://cognito-idp\\.us-east-1\\.amazonaws\\.com/us-east-1_[A-Za-z0-9]+$", var.jwt_issuer))
    error_message = "jwt_issuer: User Pool do Cognito em us-east-1, sem barra final."
  }
}

variable "jwt_audience" {
  description = "Ids dos clientes do Cognito aceitos (saída `client_id` do módulo `auth`)."
  type        = list(string)

  validation {
    condition     = length(var.jwt_audience) > 0 && alltrue([for a in var.jwt_audience : can(regex("^[A-Za-z0-9_+]{1,128}$", a))])
    error_message = "jwt_audience: ao menos um client id do Cognito."
  }
}

variable "cors_allowed_origins" {
  description = "Origens do site liberadas no CORS (ex.: `[\"https://staging.exemplo.com\"]`)."
  type        = list(string)

  validation {
    condition = length(var.cors_allowed_origins) > 0 && alltrue([
      for o in var.cors_allowed_origins : can(regex("^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", o))
    ])
    error_message = "cors_allowed_origins: ao menos uma origem `https://<host>`, sem `*`, caminho, porta nem barra final."
  }
}

variable "routes" {
  description = "Rotas da API. A chave é o route key exato (`POST /estimates`); `throttle` troca o limite só daquela rota. `/estimates` e `/quota` vão para o `llm-proxy`, o resto para a `api`."
  type = map(object({
    throttle = optional(object({ rate_limit = number, burst_limit = number }))
  }))

  validation {
    condition = length(var.routes) > 0 && alltrue([
      for key in keys(var.routes) : can(regex("^(GET|POST|PUT|PATCH|DELETE) (/([a-z0-9-]+|\\{[A-Za-z0-9_]+\\}))+$", key))
    ])
    error_message = "routes: chave `MÉTODO /caminho` com GET, POST, PUT, PATCH ou DELETE. `$default`, ANY, OPTIONS e `{proxy+}` não são aceitos."
  }

  validation {
    condition = alltrue([
      for t in [for r in values(var.routes) : r.throttle if r.throttle != null] :
      t.rate_limit > 0 && t.burst_limit >= 1 && floor(t.burst_limit) == t.burst_limit
    ])
    error_message = "routes: throttle com rate_limit > 0 e burst_limit inteiro, no mínimo 1."
  }
}

variable "default_throttle" {
  description = "Limite de taxa das rotas sem `throttle` próprio. Sem default: é escolha do autor por ambiente (runbook de guardrails, passo 2)."
  type        = object({ rate_limit = number, burst_limit = number })

  validation {
    condition     = var.default_throttle.rate_limit > 0 && var.default_throttle.burst_limit >= 1 && floor(var.default_throttle.burst_limit) == var.default_throttle.burst_limit
    error_message = "default_throttle: rate_limit > 0 e burst_limit inteiro, no mínimo 1. Zero bloquearia a API inteira."
  }
}

variable "log_retention_days" {
  description = "Retenção do log de acesso, em dias. O ADR e o runbook de custo pedem 7."
  type        = number
  default     = 7

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30], var.log_retention_days)
    error_message = "Use 1, 3, 5, 7, 14 ou 30 dias: log sem expiração ou de retenção longa não é aceito."
  }
}
