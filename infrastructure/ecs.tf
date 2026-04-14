# ecs.tf - Fulfills the "Containerization and Observability Strategy"

resource "aws_ecs_cluster" "edu_cms_cluster" {
  name = "edu-cms-cluster-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "api_task" {
  family                   = "edu-cms-api-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${var.ecr_repository_url}:latest" # Bound by CI/CD pipeline SHA in reality
      essential = true
      
      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      # Log Aggregation via FluentBit/FireLens
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/edu-cms-api-${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      # Secrets injected at runtime from Secrets Manager
      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:edu-cms/${var.environment}/database/url"
        },
        {
          name      = "REDIS_URL"
          valueFrom = "arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:edu-cms/${var.environment}/redis/url"
        }
      ]
      
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        }
      ]
    }
  ])
}
