# redis.tf - Fulfills the "Redis Availability Strategy" 

resource "aws_elasticache_replication_group" "edu_cms_redis" {
  replication_group_id       = "edu-cms-redis-${var.environment}"
  description                = "Highly Available Redis for School CMS Realtime WebSockets"
  engine                     = "redis"
  engine_version             = "7.0"
  node_type                  = "cache.t4g.micro"
  port                       = 6379

  # HA/DR Configuration
  multi_az_enabled           = var.environment == "prod" ? true : false
  automatic_failover_enabled = var.environment == "prod" ? true : false
  num_cache_clusters         = var.environment == "prod" ? 2 : 1

  # Security & Compliance
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  
  subnet_group_name          = aws_elasticache_subnet_group.redis_subnet_group.name
  security_group_ids         = [aws_security_group.redis_sg.id]

  # Logging (Slow logs and Engine logs)
  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }
}
