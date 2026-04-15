# network.tf - Fulfills Network Segmentation and Base VPC Architecture

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# Public Subnets for ALB
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
}

# Private Subnets for Databases and Redis
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
}

data "aws_availability_zones" "available" {
  state = "available"
}

# Subnet group for Redis
resource "aws_elasticache_subnet_group" "redis_subnet_group" {
  name       = "edu-cms-redis-subnet-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}


# Security Groups
resource "aws_security_group" "alb_sg" {
  name        = "edu-cms-alb-sg-${var.environment}"
  description = "Allows inbound 443 strictly"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db_sg" {
  name        = "edu-cms-db-sg-${var.environment}"
  description = "RDS Security Group"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_sg.id]
  }
}

resource "aws_security_group" "redis_sg" {
  name        = "edu-cms-redis-sg-${var.environment}"
  description = "Redis Security Group"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_sg.id]
  }
}

resource "aws_security_group" "ecs_sg" {
  name        = "edu-cms-ecs-sg-${var.environment}"
  description = "ECS Task Security Group"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Target Group for ALB
resource "aws_lb_target_group" "ecs_api_tg" {
  name        = "edu-cms-tg-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Lookups
data "aws_acm_certificate" "domain_cert" {
  domain      = "schoolsigns.example.com"
  statuses    = ["ISSUED"]
  most_recent = true
}

# Redis Logs
resource "aws_cloudwatch_log_group" "redis_slow_log" {
  name              = "/redis/${var.environment}/slow-log"
  retention_in_days = 90
}
