# Buckets de artefatos das funções e a política inline `artifacts` dos papéis apply (#209).
# Só provider simulado: sem credenciais nem AWS.
mock_provider "aws" {}

# O domínio só importa para a política de `by_id.tf`; aqui vale qualquer nome válido.
variables {
  zone_name = "example.com"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

run "buckets_de_artefatos" {
  command = apply

  assert {
    condition = { for env, b in aws_s3_bucket.artifacts : env => b.bucket } == {
      staging    = "acp-artifacts-stg-123456789012"
      production = "acp-artifacts-prod-123456789012"
    }
    error_message = "Um bucket de artefatos por ambiente, com o ID da conta lido da credencial."
  }

  assert {
    condition = alltrue(flatten([
      for b in aws_s3_bucket.artifacts : [
        for prefix in ["stg", "prod"] : !startswith(b.bucket, "acp-${prefix}-") && !can(regex("^arn:aws:s3:::acp-${prefix}-.*$", "arn:aws:s3:::${b.bucket}"))
      ]
    ])) && length(aws_s3_bucket.artifacts) == 2
    error_message = "O nome do bucket de artefatos não casa com acp-<prefixo>-*, o prefixo dos recursos do ambiente e do bucket de estado."
  }

  assert {
    condition     = length(aws_s3_bucket_versioning.artifacts) == 2 && alltrue([for v in aws_s3_bucket_versioning.artifacts : v.versioning_configuration[0].status == "Enabled"])
    error_message = "O versionamento deve estar ligado nos dois buckets."
  }

  assert {
    condition = length(aws_s3_bucket_server_side_encryption_configuration.artifacts) == 2 && alltrue([
      for e in aws_s3_bucket_server_side_encryption_configuration.artifacts :
      one(one(e.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    ])
    error_message = "A criptografia em repouso deve ser SSE-S3 (sem chave do KMS, que cria custo)."
  }

  assert {
    condition = length(aws_s3_bucket_public_access_block.artifacts) == 2 && alltrue([
      for p in aws_s3_bucket_public_access_block.artifacts :
      p.block_public_acls && p.block_public_policy && p.ignore_public_acls && p.restrict_public_buckets
    ])
    error_message = "As quatro travas de acesso público devem estar ligadas."
  }

  assert {
    condition = length(aws_s3_bucket_policy.artifacts) == 2 && alltrue([
      for env, p in aws_s3_bucket_policy.artifacts : jsondecode(p.policy).Statement == [{
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.artifacts[env].arn, "${aws_s3_bucket.artifacts[env].arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }]
    ])
    error_message = "A política do bucket deve negar todo acesso sem TLS, no bucket e nos objetos."
  }
}

run "politica_do_papel_apply" {
  command = apply

  assert {
    condition = alltrue([
      for env, pair in { staging = ["stg", "prod"], production = ["prod", "stg"] } : jsondecode(aws_iam_role_policy.apply_artifacts[env].policy).Statement == [
        { Sid = "FunctionPackages", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "arn:aws:s3:::acp-artifacts-${pair[0]}-123456789012/functions/*" },
        {
          Sid       = "DenyArtifactsBucketConfig"
          Effect    = "Deny"
          NotAction = ["s3:GetObject", "s3:PutObject"]
          Resource  = ["arn:aws:s3:::acp-artifacts-${pair[0]}-123456789012", "arn:aws:s3:::acp-artifacts-${pair[0]}-123456789012/*"]
        },
        {
          Sid      = "DenyOtherEnvironmentArtifacts"
          Effect   = "Deny"
          Action   = "s3:*"
          Resource = ["arn:aws:s3:::acp-artifacts-${pair[1]}-123456789012", "arn:aws:s3:::acp-artifacts-${pair[1]}-123456789012/*"]
        },
      ]
    ])
    error_message = "O papel apply só lê e grava functions/* do bucket de artefatos do próprio ambiente; o resto do bucket e o bucket do outro ambiente ficam negados."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      aws_iam_role_policy.apply_artifacts[env].name == "artifacts" && aws_iam_role_policy.apply_artifacts[env].role == "acp-ci-apply-${env}"
    ]) && length(aws_iam_role_policy.apply_artifacts) == 2
    error_message = "A política se chama artifacts e está presa ao papel apply do próprio ambiente."
  }

  # O nome do bucket na política é montado por nome: tem de ser o do bucket criado e o da saída.
  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      local.artifacts_bucket_arn[env] == "arn:aws:s3:::${aws_s3_bucket.artifacts[env].bucket}"
      && output.github_environment_variables[env].TF_VAR_PACKAGE_BUCKET == aws_s3_bucket.artifacts[env].bucket
    ])
    error_message = "A política, o bucket e a saída TF_VAR_PACKAGE_BUCKET falam do mesmo bucket, o do próprio ambiente."
  }
}

run "nenhum_allow_alcanca_o_outro_ambiente" {
  command = apply

  # Todo Allow do papel (inline e gerenciadas), contra sondas dos dois buckets de artefatos.
  assert {
    condition = alltrue(flatten([
      for env, pair in { staging = ["stg", "prod"], production = ["prod", "stg"] } : [
        for s in concat(
          jsondecode(aws_iam_role_policy.apply_artifacts[env].policy).Statement, jsondecode(aws_iam_role_policy.apply_state[env].policy).Statement,
          jsondecode(aws_iam_policy.apply_named[env].policy).Statement, jsondecode(aws_iam_policy.apply_id[env].policy).Statement,
          ) : [
          for r in flatten([s.Resource]) : [
            r != "*" || alltrue([for action in flatten([s.Action]) : !startswith(action, "s3:") && action != "*"]),
            alltrue([
              for probe in ["arn:aws:s3:::acp-artifacts-${pair[1]}-123456789012", "arn:aws:s3:::acp-artifacts-${pair[1]}-123456789012/functions/x.zip", "arn:aws:s3:::acp-artifacts-${pair[1]}-123456789012/x"] :
              r == "*" || !can(regex("^${replace(r, "*", ".*")}$", probe))
            ]),
            alltrue([
              for probe in ["arn:aws:s3:::acp-artifacts-${pair[0]}-123456789012", "arn:aws:s3:::acp-artifacts-${pair[0]}-123456789012/x.zip", "arn:aws:s3:::acp-artifacts-${pair[0]}-123456789012/functionsx/y.zip"] :
              r == "*" || !can(regex("^${replace(r, "*", ".*")}$", probe))
            ]),
          ]
        ] if s.Effect == "Allow"
      ]
    ]))
    error_message = "Nenhum Allow do papel alcança o bucket de artefatos do outro ambiente, nem o próprio bucket fora de functions/*; e nenhum Allow de S3 vale em \"*\"."
  }

  # O que o deploy e o Lambda chamam cabe no Allow; o que não chamam não cabe.
  assert {
    condition = alltrue(flatten([
      for env, pair in { staging = ["stg", "prod"], production = ["prod", "stg"] } : [
        for allow in [one([for s in jsondecode(aws_iam_role_policy.apply_artifacts[env].policy).Statement : s if s.Effect == "Allow"])] : [
          can(regex("^${replace(allow.Resource, "*", ".*")}$", "arn:aws:s3:::acp-artifacts-${pair[0]}-123456789012/functions/0123456789abcdef0123456789abcdef01234567.zip")),
          toset(allow.Action) == toset(["s3:GetObject", "s3:PutObject"]),
          !can(allow.Condition) && !can(allow.NotAction) && !can(allow.NotResource),
        ]
      ]
    ]))
    error_message = "O único Allow da política cobre functions/<sha>.zip do próprio bucket com s3:PutObject e s3:GetObject, e nada mais (sem listar, apagar nem ler versão)."
  }

  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement :
        alltrue([for r in flatten([s.Resource]) : !strcontains(r, "acp-artifacts-")]) if s.Sid == "DenyStateBucketConfig" || s.Sid == "DenyOtherEnvironmentState"
      ]
    ]))
    error_message = "As negações do bucket de estado não citam o bucket de artefatos: os dois não se confundem."
  }
}
