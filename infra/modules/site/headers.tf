locals {
  content_security_policy = join("; ", [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'", # sem data:, o build do web/ barra URI data:
    "font-src 'self'",
    "connect-src ${join(" ", concat(["'self'"], var.connect_src_origins))}",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ])
}

resource "aws_cloudfront_response_headers_policy" "this" {
  for_each = {
    default = "no-cache"
    assets  = "public, max-age=31536000, immutable"
  }

  name = "${var.name_prefix}-site-${each.key}"

  security_headers_config {
    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    # O callback do OIDC leva `code` na URL: nada de Referer.
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = true
    }
  }

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = each.value
      override = true
    }
  }
}
