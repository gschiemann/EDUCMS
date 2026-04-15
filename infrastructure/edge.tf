# edge.tf - Fulfills Edge TLS, HSTS, WAF and CDN Requirements

resource "aws_lb" "api_alb" {
  name               = "edu-cms-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = aws_subnet.public[*].id

  drop_invalid_header_fields = true # Security Baseline Requirement
}

resource "aws_lb_listener" "https_listener" {
  load_balancer_arn = aws_lb.api_alb.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06" # Force completely dropped TLS 1.1 Support
  certificate_arn   = data.aws_acm_certificate.domain_cert.arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Access Denied"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "api_routing" {
  listener_arn = aws_lb_listener.https_listener.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ecs_api_tg.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# Attach WAF to block OWASP Top 10 immediately at the edge
resource "aws_wafv2_web_acl" "edge_waf" {
  name        = "edu-cms-waf-${var.environment}"
  description = "EDU CMS Edge Protection"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "waf_global_metric"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb_association" {
  resource_arn = aws_lb.api_alb.arn
  web_acl_arn  = aws_wafv2_web_acl.edge_waf.arn
}

# Implementation for strict HSTS enforcement via CloudFront Response Headers
resource "aws_cloudfront_response_headers_policy" "strict_security" {
  name    = "edu-cms-strict-security-${var.environment}"
  comment = "Enforce HSTS and standard edge headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      override                   = true
      preload                    = true
    }
    
    content_security_policy {
      content_security_policy = "default-src 'self'"
      override                = true
    }
  }
}
