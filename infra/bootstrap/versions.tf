# Raiz aplicada à mão pelo autor, uma única vez, com estado local (veja o README).
# Agentes escrevem este código por Issue autorizada, mas nunca o aplicam.
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
      environment = "shared"
      owner       = "henriqueluza"
      managed-by  = "terraform"
    }
  }
}
