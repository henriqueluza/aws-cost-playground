# Papéis apply-staging e apply-production. Só provider simulado: sem credenciais nem AWS.
# Cada igualdade abaixo é uma trava: afrouxar o contrato (curinga, StringLike, Sid removido) quebra o assert.
mock_provider "aws" {}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

# Não ponha o mapa inteiro de aws_iam_role.apply na condição (`for r in ...`, índice dinâmico): o
# Terraform 1.16.0 dá panic (`value has marks`) ao imprimir assert que falha. Leia `apply["<env>"].<attr>`.
run "trust_dos_papeis_apply" {
  command = apply

  assert {
    condition     = [aws_iam_role.apply["staging"].name, aws_iam_role.apply["production"].name] == ["acp-ci-apply-staging", "acp-ci-apply-production"]
    error_message = "Cada ambiente tem o seu papel apply, chamado acp-ci-apply-<ambiente>."
  }

  assert {
    condition     = aws_iam_role.apply["staging"].max_session_duration == 3600 && aws_iam_role.apply["production"].max_session_duration == 3600
    error_message = "A sessão do papel apply dura no máximo uma hora."
  }

  assert {
    condition = [
      jsondecode(aws_iam_role.apply["staging"].assume_role_policy).Statement,
      jsondecode(aws_iam_role.apply["production"].assume_role_policy).Statement,
      ] == [for env in ["staging", "production"] : [{
        Sid       = "GitHubEnvironment"
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:ref" = "refs/heads/main"
            "token.actions.githubusercontent.com:sub" = "repo:henriqueluza/aws-cost-playground:environment:${env}"
          }
        }
    }]]
    error_message = "O trust do apply aceita só a branch main e o environment do próprio ambiente deste repositório, por igualdade exata."
  }
}

run "estado_do_proprio_ambiente" {
  command = apply

  assert {
    condition = alltrue([
      for env, p in { staging = "stg", production = "prod" } : jsondecode(aws_iam_role_policy.apply_state[env].policy).Statement == [
        { Sid = "ListStateBucket", Effect = "Allow", Action = "s3:ListBucket", Resource = "arn:aws:s3:::acp-${p}-tfstate-123456789012" },
        { Sid = "ReadWriteState", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "arn:aws:s3:::acp-${p}-tfstate-123456789012/acp-${p}/terraform.tfstate" },
        { Sid = "LockState", Effect = "Allow", Action = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"], Resource = "arn:aws:s3:::acp-${p}-tfstate-123456789012/acp-${p}/terraform.tfstate.tflock" },
      ]
    ])
    error_message = "O apply lê e grava só o arquivo de estado e o de lock do próprio ambiente, sem tocar em outro objeto nem em outro bucket."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      aws_iam_role_policy.apply_state[env].name == "state" && aws_iam_role_policy.apply_state[env].role == "acp-ci-apply-${env}"
    ])
    error_message = "A política de estado se chama state e está presa ao papel apply do próprio ambiente."
  }
}

run "negacoes_do_papel_apply" {
  command = apply

  assert {
    condition = alltrue([for env in ["staging", "production"] : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[0] == {
      Sid      = "DenyDataDeletion"
      Effect   = "Deny"
      Action   = ["cognito-idp:DeleteUserPool", "dynamodb:DeleteTable", "dynamodb:PutResourcePolicy", "route53:DeleteHostedZone", "s3:DeleteBucket"]
      Resource = "*"
    }])
    error_message = "O papel apply não apaga tabela, user pool, bucket nem zona, e não cria política de recurso na tabela."
  }

  assert {
    condition = alltrue([for env in ["staging", "production"] : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[1] == {
      Sid      = "DenyParameterStore"
      Effect   = "Deny"
      Action   = "ssm:*"
      Resource = "*"
    }])
    error_message = "O papel apply não lê, não sobrescreve e não apaga parâmetro do SSM (a chave da Claude API fica fora do CI)."
  }

  assert {
    condition = alltrue([for env in ["staging", "production"] : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[2] == {
      Sid      = "DenyCiIdentity"
      Effect   = "Deny"
      Action   = "iam:*"
      Resource = ["arn:aws:iam::123456789012:role/acp-ci-*", "arn:aws:iam::123456789012:policy/acp-ci-*", "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"]
    }])
    error_message = "O papel apply não altera os papéis, as políticas nem o provedor OIDC da identidade de CI."
  }

  assert {
    condition = alltrue([for env, p in { staging = "stg", production = "prod" } : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[3] == {
      Sid         = "DenyIamOutsideEnvironment"
      Effect      = "Deny"
      Action      = "iam:*"
      NotResource = "arn:aws:iam::123456789012:role/acp-${p}-*"
    }])
    error_message = "O papel apply só mexe em IAM nos papéis acp-<ambiente>-*, nunca nos de outro ambiente nem em usuários ou políticas."
  }

  assert {
    condition = alltrue([for env in ["staging", "production"] : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[4] == {
      Sid       = "DenyRoleWithoutBoundary"
      Effect    = "Deny"
      Action    = ["iam:CreateRole", "iam:DeleteRolePolicy", "iam:PutRolePermissionsBoundary", "iam:PutRolePolicy"]
      Resource  = "arn:aws:iam::123456789012:role/*"
      Condition = { StringNotEquals = { "iam:PermissionsBoundary" = "arn:aws:iam::123456789012:policy/acp-ci-boundary-${env}" } }
    }])
    error_message = "O papel apply só cria ou altera papéis se for com o limite de permissões do próprio ambiente."
  }

  assert {
    condition = alltrue([for env in ["staging", "production"] : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[5] == {
      Sid      = "DenyRoleBypass"
      Effect   = "Deny"
      Action   = ["iam:AttachRolePolicy", "iam:DeleteRolePermissionsBoundary", "iam:DetachRolePolicy", "iam:UpdateAssumeRolePolicy"]
      Resource = "*"
    }])
    error_message = "O papel apply não tira o limite, não troca o trust e não anexa nem desanexa política gerenciada de nenhum papel."
  }

  assert {
    condition = alltrue([for env, p in { staging = "stg", production = "prod" } : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[6] == {
      Sid       = "DenyStateBucketConfig"
      Effect    = "Deny"
      NotAction = ["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"]
      Resource  = ["arn:aws:s3:::acp-${p}-tfstate-123456789012", "arn:aws:s3:::acp-${p}-tfstate-123456789012/*"]
    }])
    error_message = "O papel apply não altera a configuração, a política nem o versionamento do bucket de estado."
  }

  assert {
    condition = alltrue([for env, other in { staging = "prod", production = "stg" } : jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[7] == {
      Sid      = "DenyOtherEnvironmentState"
      Effect   = "Deny"
      Action   = "s3:*"
      Resource = ["arn:aws:s3:::acp-${other}-tfstate-123456789012", "arn:aws:s3:::acp-${other}-tfstate-123456789012/*"]
    }])
    error_message = "O papel apply de um ambiente não acessa o bucket de estado do outro ambiente."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] : alltrue([for s in jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement : s.Effect == "Deny"])
      && length(jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement) == 8
      && aws_iam_role_policy.apply_deny[env].name == "deny-guardrails"
      && aws_iam_role_policy.apply_deny[env].role == "acp-ci-apply-${env}"
    ])
    error_message = "A política deny-guardrails tem exatamente oito statements, todos Deny, presa ao papel apply do próprio ambiente."
  }
}

run "saidas_e_limites_da_aws" {
  command = apply

  assert {
    condition = output.github_environment_variables == {
      staging    = { AWS_APPLY_ROLE_ARN = aws_iam_role.apply["staging"].arn }
      production = { AWS_APPLY_ROLE_ARN = aws_iam_role.apply["production"].arn }
    }
    error_message = "Cada environment do GitHub recebe só o ARN do seu próprio papel apply."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      length(aws_iam_role_policy.apply_state[env].policy) + length(aws_iam_role_policy.apply_deny[env].policy) <= 10240
    ])
    error_message = "A soma das políticas inline de um papel não pode passar de 10240 caracteres, o limite da AWS."
  }

  assert {
    condition     = length(aws_iam_role.apply["staging"].assume_role_policy) <= 2048 && length(aws_iam_role.apply["production"].assume_role_policy) <= 2048
    error_message = "O trust do papel não pode passar de 2048 caracteres, o limite da AWS."
  }
}
