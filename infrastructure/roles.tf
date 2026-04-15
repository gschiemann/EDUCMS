# roles.tf - IAM Least Privilege Execution Roles

resource "aws_iam_role" "ecs_execution_role" {
  name = "edu-cms-execution-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_role_policy" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow ECS to grab secrets from Secrets Manager securely
resource "aws_iam_policy" "secrets_manager_access" {
  name        = "edu-cms-secrets-access-${var.environment}"
  description = "Allow ECS tasks to grab secrets from specific AWS Secrets Manager paths"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:edu-cms/${var.environment}/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_secrets_attachment" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = aws_iam_policy.secrets_manager_access.arn
}

resource "aws_iam_role" "ecs_task_role" {
  name = "edu-cms-task-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Allow Task to write to S3 Audit Bucket directly if necessary
resource "aws_iam_policy" "audit_s3_write" {
  name        = "edu-cms-audit-write-${var.environment}"
  description = "Grant task runtime direct capability to archive audits to WORM storage"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.edu_cms_audit_logs.arn}/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_audit_attachment" {
  role       = aws_iam_role.ecs_task_role.name
  policy_arn = aws_iam_policy.audit_s3_write.arn
}
