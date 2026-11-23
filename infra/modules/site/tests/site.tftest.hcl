mock_provider "aws" {}
override_resource {
  target          = aws_cloudfront_distribution.this
  override_during = plan
  values          = { arn = "arn:aws:cloudfront::111111111111:distribution/EXAMPLE" }
}
override_resource {
  target          = aws_s3_bucket.this
  override_during = plan
  values          = { arn = "arn:aws:s3:::acp-stg-site-test" }
}
variables {
  name_prefix         = "acp-stg"
  bucket_name         = "acp-stg-site-test"
  aliases             = ["staging.exemplo.com"]
  acm_certificate_arn = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  connect_src_origins = ["https://api.staging.exemplo.com", "https://auth.staging.exemplo.com", "https://cognito-idp.us-east-1.amazonaws.com"]
}

run "bucket_privado_com_oac_e_versionamento" {
  command = plan
  assert {
    condition     = aws_s3_bucket_public_access_block.this.block_public_acls && aws_s3_bucket_public_access_block.this.block_public_policy && aws_s3_bucket_public_access_block.this.ignore_public_acls && aws_s3_bucket_public_access_block.this.restrict_public_buckets
    error_message = "As quatro travas de acesso público do bucket devem estar ativas."
  }
  assert {
    condition     = aws_s3_bucket_versioning.this.versioning_configuration[0].status == "Enabled"
    error_message = "O versionamento do bucket deve estar habilitado."
  }
  assert {
    condition     = one([for r in aws_s3_bucket_server_side_encryption_configuration.this.rule : r.apply_server_side_encryption_by_default[0].sse_algorithm]) == "AES256"
    error_message = "O bucket deve usar criptografia AES256."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.this.signing_protocol == "sigv4" && aws_cloudfront_origin_access_control.this.signing_behavior == "always"
    error_message = "O OAC deve assinar sempre com sigv4."
  }
  assert {
    condition     = one([for s in jsondecode(aws_s3_bucket_policy.this.policy).Statement : s if s.Sid == "AllowCloudFrontRead"]).Condition.StringEquals["AWS:SourceArn"] == aws_cloudfront_distribution.this.arn
    error_message = "A leitura do bucket deve ser restrita à distribuição, pelo AWS:SourceArn."
  }
  assert {
    condition     = one([for s in jsondecode(aws_s3_bucket_policy.this.policy).Statement : s if s.Sid == "DenyInsecureTransport"]).Condition.Bool["aws:SecureTransport"] == "false"
    error_message = "O bucket deve negar tráfego sem TLS."
  }
}

run "https_tls_e_fallback_spa" {
  command = plan
  assert {
    condition     = (aws_cloudfront_distribution.this.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https" && aws_cloudfront_distribution.this.ordered_cache_behavior[0].viewer_protocol_policy == "redirect-to-https") && (aws_cloudfront_distribution.this.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021" && aws_cloudfront_distribution.this.viewer_certificate[0].ssl_support_method == "sni-only") && (alltrue([for e in aws_cloudfront_distribution.this.custom_error_response : e.response_code == 200 && e.response_page_path == "/index.html" && e.error_caching_min_ttl == 0]) && toset([for e in aws_cloudfront_distribution.this.custom_error_response : e.error_code]) == toset([403, 404]))
    error_message = "Os dois comportamentos devem redirecionar HTTP para HTTPS. O certificado deve exigir TLS 1.2 (2021) com SNI. 403 e 404 devem responder 200 com /index.html, sem cache do erro."
  }
}

run "cabecalhos_de_seguranca" {
  command = plan
  assert {
    condition     = alltrue([for k in ["default", "assets"] : strcontains(aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].content_security_policy[0].content_security_policy, "script-src 'self'") && strcontains(aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].content_security_policy[0].content_security_policy, "frame-ancestors 'none'") && strcontains(aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].content_security_policy[0].content_security_policy, "connect-src 'self' https://api.staging.exemplo.com")])
    error_message = "A CSP deve ter script-src 'self', frame-ancestors 'none' e as origens de connect-src."
  }
  assert {
    condition     = alltrue([for k in ["default", "assets"] : !strcontains(aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].content_security_policy[0].content_security_policy, "unsafe-inline")])
    error_message = "A CSP não pode conter unsafe-inline."
  }
  assert {
    condition     = alltrue([for k in ["default", "assets"] : aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].strict_transport_security[0].access_control_max_age_sec == 31536000 && aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].frame_options[0].frame_option == "DENY" && aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].referrer_policy[0].referrer_policy == "no-referrer" && aws_cloudfront_response_headers_policy.this[k].security_headers_config[0].content_type_options[0].override])
    error_message = "HSTS de 1 ano, X-Frame-Options DENY, no-referrer e nosniff devem estar ativos."
  }
}

run "cache_por_caminho" {
  command = plan
  assert {
    condition     = (one([for i in aws_cloudfront_response_headers_policy.this["default"].custom_headers_config[0].items : i.value if i.header == "Cache-Control"]) == "no-cache" && one([for i in aws_cloudfront_response_headers_policy.this["assets"].custom_headers_config[0].items : i.value if i.header == "Cache-Control"]) == "public, max-age=31536000, immutable") && (aws_cloudfront_cache_policy.short.min_ttl == 0 && aws_cloudfront_cache_policy.short.default_ttl == 60 && aws_cloudfront_cache_policy.short.max_ttl == 300 && aws_cloudfront_distribution.this.ordered_cache_behavior[0].path_pattern == "/assets/*")
    error_message = "O HTML deve ser no-cache e /assets/* imutável por um ano. A política curta deve ter TTL 0/60/300 e /assets/* deve ter comportamento próprio."
  }
}

run "aliases_vazio_e_rejeitado" {
  command = plan
  variables { aliases = [] }
  expect_failures = [var.aliases]
}
run "certificado_fora_de_us_east_1_e_rejeitado" {
  command = plan
  variables { acm_certificate_arn = "arn:aws:acm:sa-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000" }
  expect_failures = [var.acm_certificate_arn]
}

run "origem_com_caminho_ou_curinga_e_rejeitada" {
  command = plan
  variables { connect_src_origins = ["https://*.exemplo.com/api"] }
  expect_failures = [var.connect_src_origins]
}
