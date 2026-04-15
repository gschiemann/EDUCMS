terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # backend "s3" {
  #   bucket = "edu-cms-terraform-state"
  #   key    = "infrastructure/prod/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "EDU-CMS"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment (dev, staging, prod)"
  default     = "dev"
}

variable "aws_region" {
  type        = string
  description = "AWS Region deploying to"
  default     = "us-east-1"
}

variable "account_id" {
  type = string
}

variable "ecr_repository_url" {
  type = string
}

