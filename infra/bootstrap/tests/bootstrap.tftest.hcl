# Só provider simulado: não usa credenciais nem chama a AWS. `command = apply` roda contra
# o simulado, para os ARNs existirem e as políticas poderem ser lidas como JSON.
mock_provider "aws" {}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

run "buckets_de_estado" {
  command = apply

  assert {
    condition = { for env, b in aws_s3_bucket.state : env => b.bucket } == {
      staging    = "acp-stg-tfstate-123456789012"
      production = "acp-prod-tfstate-123456789012"
    }
    error_message = "Um bucket de estado por ambiente, com o ID da conta lido da credencial."
  }

  assert {
    condition     = alltrue([for v in aws_s3_bucket_versioning.state : v.versioning_configuration[0].status == "Enabled"])
    error_message = "O versionamento deve estar ligado nos dois buckets."
  }

  assert {
    condition = alltrue([
      for e in aws_s3_bucket_server_side_encryption_configuration.state :
      one(one(e.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    ])
    error_message = "A criptografia em repouso deve ser SSE-S3 (sem chave do KMS, que cria custo)."
  }

  assert {
    condition = alltrue([
      for p in aws_s3_bucket_public_access_block.state :
      p.block_public_acls && p.block_public_policy && p.ignore_public_acls && p.restrict_public_buckets
    ])
    error_message = "As quatro travas de acesso público devem estar ligadas."
  }

  assert {
    condition = alltrue([
      for env, p in aws_s3_bucket_policy.state : jsondecode(p.policy).Statement == [{
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.state[env].arn, "${aws_s3_bucket.state[env].arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }]
    ])
    error_message = "A política do bucket deve negar todo acesso sem TLS, no bucket e nos objetos."
  }
}

run "trust_do_papel_plan" {
  command = apply

  assert {
    condition     = aws_iam_openid_connect_provider.github.url == "https://token.actions.githubusercontent.com" && aws_iam_openid_connect_provider.github.client_id_list == toset(["sts.amazonaws.com"])
    error_message = "O provedor OIDC é o do GitHub Actions, com audiência do STS."
  }

  assert {
    condition = jsondecode(aws_iam_role.plan.assume_role_policy).Statement == [{
      Sid       = "GitHubPullRequest"
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:henriqueluza/aws-cost-playground:pull_request"
        }
      }
    }]
    error_message = "O trust do papel plan aceita só o evento pull_request deste repositório, por igualdade exata."
  }
}

run "papel_plan_somente_leitura" {
  command = apply

  assert {
    condition     = aws_iam_role_policy_attachment.plan_read_only.policy_arn == "arn:aws:iam::aws:policy/ReadOnlyAccess"
    error_message = "A única política gerenciada do papel plan é a ReadOnlyAccess."
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.plan_deny_data.policy).Statement : s.Effect == "Deny"])
    error_message = "A política inline do papel plan só nega: nenhuma permissão além da leitura."
  }

  assert {
    condition = length(setsubtract(
      ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "cognito-idp:ListUsers", "logs:GetLogEvents", "ssm:GetParameter", "secretsmanager:GetSecretValue"],
      jsondecode(aws_iam_role_policy.plan_deny_data.policy).Statement[0].Action
    )) == 0 && jsondecode(aws_iam_role_policy.plan_deny_data.policy).Statement[0].Resource == "*"
    error_message = "O papel plan não lê itens, usuários, logs nem segredos."
  }

  assert {
    condition     = toset(jsondecode(aws_iam_role_policy.plan_deny_data.policy).Statement[1].NotResource) == toset([for b in aws_s3_bucket.state : "${b.arn}/*"])
    error_message = "O papel plan só lê objetos dos buckets de estado."
  }

  assert {
    condition = output.github_variables == {
      AWS_PLAN_ROLE_ARN          = aws_iam_role.plan.arn
      TF_STATE_BUCKET_STAGING    = "acp-stg-tfstate-123456789012"
      TF_STATE_BUCKET_PRODUCTION = "acp-prod-tfstate-123456789012"
    }
    error_message = "As saídas têm os nomes das variáveis que o terraform.yml lê."
  }
}
