# rds.tf - Fulfills the "Database Backup Strategy" defined in BACKUP_AND_RECOVERY.md

resource "aws_db_instance" "edu_cms_postgres" {
  identifier        = "edu-cms-db-${var.environment}"
  engine            = "postgres"
  engine_version    = "15.3"
  instance_class    = var.environment == "prod" ? "db.m6g.large" : "db.t4g.micro"
  allocated_storage = 100
  storage_type      = "gp3"

  db_name  = "school_cms"
  username = "cms_admin"
  
  # Secret injection - integrated with AWS Secrets Manager (No hardcoded secrets)
  password = data.aws_secretsmanager_secret_version.db_password.secret_string

  # Highly Available / DR Design
  multi_az               = var.environment == "prod" ? true : false
  
  # Backup & PITR Execution (30 day retention as spec'd)
  backup_retention_period = var.environment == "prod" ? 30 : 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Sun:04:00-Sun:05:00"
  copy_tags_to_snapshot   = true

  # Security
  storage_encrypted      = true
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  publicly_accessible    = false
  deletion_protection    = var.environment == "prod" ? true : false

  skip_final_snapshot       = var.environment == "dev" ? true : false
  final_snapshot_identifier = "edu-cms-db-final-${var.environment}"
}

# Fetch secrets manager db credentials safely
data "aws_secretsmanager_secret" "db_secret" {
  name = "edu-cms/${var.environment}/database/password"
}

data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = data.aws_secretsmanager_secret.db_secret.id
}
