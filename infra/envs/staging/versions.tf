terraform {
  required_version = "~> 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      project     = "aws-cost-playground"
      environment = "staging"
      owner       = "henriqueluza"
      managed-by  = "terraform"
    }
  }
}
