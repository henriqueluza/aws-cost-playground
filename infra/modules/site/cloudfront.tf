resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "${var.name_prefix}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_cache_policy" "short" {
  name        = "${var.name_prefix}-site-short"
  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

data "aws_cloudfront_cache_policy" "assets" {
  name = "Managed-CachingOptimized"
}

# WAF tem custo fixo; risco aceito pelo autor no ADR (Gate 1).
#trivy:ignore:AVD-AWS-0011
resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  default_root_object = "index.html"
  aliases             = var.aliases
  price_class         = "PriceClass_100"
  comment             = "${var.name_prefix} site"

  origin {
    origin_id                = "s3-site"
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }
  default_cache_behavior {
    target_origin_id           = "s3-site"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.short.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["default"].id
  }
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "s3-site"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.assets.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this["assets"].id
  }

  # Fallback da SPA: o bucket privado devolve 403 para chave inexistente.
  dynamic "custom_error_response" {
    for_each = [403, 404]
    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
