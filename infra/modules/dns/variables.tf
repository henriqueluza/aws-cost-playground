variable "zone_name" {
  description = "Zona pública do Route 53 criada pelo autor (ex.: example.com). O módulo só a lê."
  type        = string
  nullable    = false
}

variable "site_domain" {
  description = "Nome do site: zone_name em production, staging.<zone_name> em staging. API e login viram api.<site_domain> e auth.<site_domain>."
  type        = string
  nullable    = false

  validation {
    condition     = var.site_domain == var.zone_name || endswith(var.site_domain, ".${var.zone_name}")
    error_message = "site_domain deve ser zone_name ou um subdomínio dele."
  }
}
