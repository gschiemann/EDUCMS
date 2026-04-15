# storage.tf - Fulfills Object Storage & CDN Architecture Specification

resource "aws_s3_bucket" "edu_cms_assets" {
  bucket = "edu-cms-media-assets-${var.environment}"
  
  # Protect against accidental deletion of critical media
  lifecycle {
    prevent_destroy = true
  }
}

# Object Lock for Audit Logs to satisfy compliance
resource "aws_s3_bucket" "edu_cms_audit_logs" {
  bucket = "edu-cms-audit-logs-${var.environment}"

  object_lock_enabled = true
}

resource "aws_s3_bucket_object_lock_configuration" "audit_lock" {
  bucket = aws_s3_bucket.edu_cms_audit_logs.id

  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = 7 # Mandated legal retention period
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "asset_encryption" {
  bucket = aws_s3_bucket.edu_cms_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "block_public_access" {
  bucket = aws_s3_bucket.edu_cms_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Cloudfront Origin Access Control mapping
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "edu-cms-oac-${var.environment}"
  description                       = "OAC for EDU CMS CDN"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
