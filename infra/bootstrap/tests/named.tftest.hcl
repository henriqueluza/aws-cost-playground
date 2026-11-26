# Política acp-ci-apply-named-<env>: escrita dos papéis apply nos recursos com nome do ambiente.
# Só provider simulado: sem credenciais nem AWS. A igualdade da lista inteira trava qualquer
# afrouxamento; os asserts de forma dizem o que está errado quando ela quebra.
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

run "identidade_e_anexo" {
  command = apply

  # O `.arn` do provider simulado é aleatório: o ARN é conferido pelo nome e pelo caminho.
  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      aws_iam_policy.apply_named[env].name == "acp-ci-apply-named-${env}" && aws_iam_policy.apply_named[env].path == "/"
      && local.apply_named_arn[env] == "arn:aws:iam::123456789012:policy/acp-ci-apply-named-${env}"
      && aws_iam_role_policy_attachment.apply_named[env].role == "acp-ci-apply-${env}"
      && aws_iam_role_policy_attachment.apply_named[env].policy_arn == "arn:aws:iam::123456789012:policy/acp-ci-apply-named-${env}"
    ])
    error_message = "A política se chama acp-ci-apply-named-<ambiente>, no caminho /, e está anexada só ao papel apply do próprio ambiente (nunca ao limite)."
  }

  assert {
    condition     = length(aws_iam_role_policy_attachment.apply_named) == 2
    error_message = "Há um anexo por ambiente, nem mais nem menos."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      startswith(aws_iam_policy.apply_named[env].name, "acp-ci-") && one([
        for s in jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement :
        s.Effect == "Deny" && s.Action == "iam:*" && contains(s.Resource, "arn:aws:iam::123456789012:policy/acp-ci-*") if s.Sid == "DenyCiIdentity"
      ])
    ])
    error_message = "O papel apply não altera nem apaga a própria política: o nome dela casa com policy/acp-ci-*, negado em DenyCiIdentity."
  }
}

run "lista_inteira_de_statements" {
  command = apply

  assert {
    condition = alltrue([for env, p in { staging = "stg", production = "prod" } : jsondecode(aws_iam_policy.apply_named[env].policy).Statement == [
      {
        Sid    = "Table"
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive",
          "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:UpdateContinuousBackups",
          "dynamodb:UpdateTable", "dynamodb:UpdateTimeToLive",
        ]
        Resource = "arn:aws:dynamodb:us-east-1:123456789012:table/acp-${p}-*"
      },
      {
        Sid    = "Functions"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:GetFunction", "lambda:GetFunctionCodeSigningConfig", "lambda:GetFunctionConfiguration",
          "lambda:GetPolicy", "lambda:ListTags", "lambda:ListVersionsByFunction", "lambda:TagResource", "lambda:UntagResource",
          "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
        ]
        Resource = ["arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-api", "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-llm-proxy"]
      },
      {
        Sid       = "FunctionInvokePermission"
        Effect    = "Allow"
        Action    = "lambda:AddPermission"
        Resource  = ["arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-api", "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-llm-proxy"]
        Condition = { StringEquals = { "lambda:Principal" = "apigateway.amazonaws.com" } }
      },
      {
        Sid    = "FunctionRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies",
          "iam:PutRolePolicy", "iam:TagRole", "iam:UntagRole",
        ]
        Resource = ["arn:aws:iam::123456789012:role/acp-${p}-api", "arn:aws:iam::123456789012:role/acp-${p}-llm-proxy"]
      },
      {
        Sid       = "PassFunctionRoles"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = ["arn:aws:iam::123456789012:role/acp-${p}-api", "arn:aws:iam::123456789012:role/acp-${p}-llm-proxy"]
        Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } }
      },
      {
        Sid      = "LogGroups"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:ListTagsForResource", "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource"]
        Resource = ["arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/acp-${p}-*", "arn:aws:logs:us-east-1:123456789012:log-group:/aws/vendedlogs/apigateway/acp-${p}-*"]
      },
      { Sid = "LogGroupList", Effect = "Allow", Action = "logs:DescribeLogGroups", Resource = "*" },
      {
        Sid    = "AlarmTopic"
        Effect = "Allow"
        Action = [
          "sns:CreateTopic", "sns:GetSubscriptionAttributes", "sns:GetTopicAttributes", "sns:ListTagsForResource",
          "sns:SetTopicAttributes", "sns:TagResource", "sns:UntagResource",
        ]
        Resource = "arn:aws:sns:us-east-1:123456789012:acp-${p}-*"
      },
      {
        Sid       = "AlarmSubscription"
        Effect    = "Allow"
        Action    = "sns:Subscribe"
        Resource  = "arn:aws:sns:us-east-1:123456789012:acp-${p}-*"
        Condition = { StringEquals = { "sns:Protocol" = "email" } }
      },
      {
        Sid      = "Alarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource", "cloudwatch:PutMetricAlarm", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
        Resource = "arn:aws:cloudwatch:us-east-1:123456789012:alarm:acp-${p}-*"
      },
      {
        Sid    = "SiteBucket"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:GetAccelerateConfiguration", "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketLogging",
          "s3:GetBucketObjectLockConfiguration", "s3:GetBucketOwnershipControls", "s3:GetBucketPolicy", "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketRequestPayment", "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetBucketWebsite",
          "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:ListBucket",
          "s3:ListTagsForResource", "s3:PutBucketOwnershipControls", "s3:PutBucketPolicy", "s3:PutBucketPublicAccessBlock",
          "s3:PutBucketTagging", "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration", "s3:TagResource", "s3:UntagResource",
        ]
        Resource = "arn:aws:s3:::acp-${p}-site-aws-cost-playground"
      },
      { Sid = "SiteObjects", Effect = "Allow", Action = "s3:PutObject", Resource = "arn:aws:s3:::acp-${p}-site-aws-cost-playground/*" },
    ]])
    error_message = "A política dá exatamente estes 12 Allow: tabela, duas funções, dois papéis, log groups, alarmes, tópico e o bucket do site do próprio ambiente. Ação, recurso ou condição a mais ou a menos quebra o assert."
  }

  assert {
    condition     = length(aws_iam_policy.apply_named["staging"].policy) <= 6144 && length(aws_iam_policy.apply_named["production"].policy) <= 6144
    error_message = "Uma política gerenciada não pode passar de 6144 caracteres, o limite da AWS."
  }
}

run "forma_da_politica" {
  command = apply

  # Redundante com a igualdade de propósito: diz o que está errado quando ela quebra.
  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
          s.Effect == "Allow",
          !can(s.NotAction) && !can(s.NotResource),
          !strcontains(jsonencode(s.Action), "*"),
          alltrue([for action in flatten([s.Action]) : can(regex("^(dynamodb|lambda|iam|logs|sns|cloudwatch|s3):", action))]),
          s.Resource == "*" ? (s.Sid == "LogGroupList" && s.Action == "logs:DescribeLogGroups") : true,
          s.Sid != "LogGroupList" || s.Resource == "*",
        ]
      ]
    ]))
    error_message = "Todo statement é Allow, sem NotAction, NotResource nem curinga em ação, só dynamodb, lambda, iam, logs, sns, cloudwatch e s3, e Resource \"*\" só em logs:DescribeLogGroups."
  }

  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
          for r in flatten([s.Resource]) : [
            for probe in concat(
              [for q in [p == "stg" ? "prod" : "stg"] : [
                "arn:aws:dynamodb:us-east-1:123456789012:table/acp-${q}-main",
                "arn:aws:lambda:us-east-1:123456789012:function:acp-${q}-api", "arn:aws:lambda:us-east-1:123456789012:function:acp-${q}-llm-proxy",
                "arn:aws:iam::123456789012:role/acp-${q}-api", "arn:aws:iam::123456789012:role/acp-${q}-llm-proxy",
                "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/acp-${q}-api",
                "arn:aws:logs:us-east-1:123456789012:log-group:/aws/vendedlogs/apigateway/acp-${q}-http-api",
                "arn:aws:sns:us-east-1:123456789012:acp-${q}-alarms", "arn:aws:cloudwatch:us-east-1:123456789012:alarm:acp-${q}-api-errors",
                "arn:aws:s3:::acp-${q}-site-aws-cost-playground", "arn:aws:s3:::acp-${q}-site-aws-cost-playground/index.html",
              ]][0],
              ["arn:aws:s3:::acp-stg-tfstate-123456789012", "arn:aws:s3:::acp-prod-tfstate-123456789012", "arn:aws:s3:::acp-${p}-tfstate-123456789012/acp-${p}/terraform.tfstate"],
            ) : !can(regex("^${replace(r, "*", ".*")}$", probe))
          ] if r != "*"
        ]
      ]
    ]))
    error_message = "Nenhum recurso alcança o outro ambiente nem os buckets de estado: tabela, funções, papéis, log groups, tópico, alarme e bucket do site do outro ambiente, e o estado, ficam de fora."
  }

  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
          for r in flatten([s.Resource]) : (r == "*" ? s.Sid == "LogGroupList" : strcontains(r, "acp-${p}-"))
        ]
      ]
    ]))
    error_message = "Todo recurso, fora logs:DescribeLogGroups, leva o prefixo acp-<prefixo>- do próprio ambiente."
  }

  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
          for r in flatten([s.Resource]) : contains(["arn:aws:s3:::acp-${p}-site-aws-cost-playground", "arn:aws:s3:::acp-${p}-site-aws-cost-playground/*"], r)
        ] if anytrue([for action in flatten([s.Action]) : startswith(action, "s3:")])
      ]
    ]))
    error_message = "S3 só no bucket do site do próprio ambiente, pelo nome exato (o prefixo acp-<prefixo>-* alcançaria o bucket de estado) ou pelos objetos dele."
  }
}

run "nomes_fixos_e_condicoes" {
  command = apply

  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for pass in [one([for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : s if contains(flatten([s.Action]), "iam:PassRole")])] : [
          pass.Action == "iam:PassRole",
          pass.Resource == ["arn:aws:iam::123456789012:role/acp-${p}-api", "arn:aws:iam::123456789012:role/acp-${p}-llm-proxy"],
          pass.Condition == { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } },
        ]
      ]
    ]))
    error_message = "iam:PassRole aparece uma vez, sozinha, só nos dois papéis exatos e só para lambda.amazonaws.com."
  }

  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for perm in [one([for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : s if contains(flatten([s.Action]), "lambda:AddPermission")])] : [
          perm.Action == "lambda:AddPermission",
          perm.Resource == ["arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-api", "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-llm-proxy"],
          perm.Condition == { StringEquals = { "lambda:Principal" = "apigateway.amazonaws.com" } },
        ]
      ]
    ]))
    error_message = "lambda:AddPermission é sozinha, só nas duas funções exatas e só para apigateway.amazonaws.com, com StringEquals."
  }

  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
          anytrue([for a in flatten([s.Action]) : startswith(a, "lambda:")]) ? s.Resource == ["arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-api", "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-llm-proxy"] : true,
          anytrue([for a in flatten([s.Action]) : startswith(a, "iam:")]) ? s.Resource == ["arn:aws:iam::123456789012:role/acp-${p}-api", "arn:aws:iam::123456789012:role/acp-${p}-llm-proxy"] : true,
        ]
      ]
    ]))
    error_message = "Toda ação lambda: vale só nas duas funções exatas e toda ação iam: só nos dois papéis exatos, sem prefixo nem curinga."
  }
}

run "acao_negada_e_dado" {
  command = apply

  # Nada do que o papel já tem negado (Deny sem condição em qualquer recurso) pode voltar por um Allow.
  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for denied in flatten([
          for s in concat(jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement, jsondecode(aws_iam_role_policy.apply_deny_data[env].policy).Statement) :
          flatten([s.Action]) if s.Effect == "Deny" && can(s.Action) && try(s.Resource == "*", false) && !can(s.Condition)
          ]) : [
          for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
            for action in flatten([s.Action]) : !can(regex("^${replace(denied, "*", ".*")}$", action))
          ]
        ]
      ]
    ]))
    error_message = "Nenhuma ação da política casa com um Deny sem condição de deny-guardrails ou deny-data: a negação vence, e um Allow dela seria letra morta que esconde a intenção."
  }

  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
          for banned in [
            "iam:DeleteRolePolicy", "iam:PutRolePermissionsBoundary", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:UpdateAssumeRolePolicy",
            "lambda:CreateFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig",
          ] : !contains(flatten([s.Action]), banned)
        ]
      ]
    ]))
    error_message = "Política gerenciada, trust, limite e URL de função não entram: iam:DeleteRolePolicy, PutRolePermissionsBoundary, AttachRolePolicy, DetachRolePolicy, UpdateAssumeRolePolicy e as ações de URL da função ficam de fora."
  }

  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement : [
          for action in flatten([s.Action]) : [
            alltrue([for pattern in ["s3:GetObject.*", "s3:DeleteObject.*", "sns:Publish", "logs:PutLogEvents", "logs:CreateLogStream", "lambda:Invoke.*"] : !can(regex("^${pattern}$", action))]),
            alltrue([for prefix in ["cognito-idp:", "ssm:", "secretsmanager:"] : !startswith(action, prefix)]),
            alltrue([for word in ["Delete", "Remove", "Detach", "Unsubscribe"] : !strcontains(action, word)]),
          ]
        ]
      ]
    ]))
    error_message = "A política não lê nem apaga objeto, não publica em tópico, não escreve evento de log, não invoca função, não toca Cognito, SSM nem Secrets Manager e não tem ação de exclusão (Delete, Remove, Detach, Unsubscribe)."
  }
}

run "contrato_com_os_modulos" {
  command = apply

  # Cada ação que os módulos usam, no recurso real, tem de caber num Allow. Ação fora falha só em execução.
  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for need in concat(
          [for action in ["dynamodb:CreateTable", "dynamodb:UpdateTable"] : { action = action, resource = "arn:aws:dynamodb:us-east-1:123456789012:table/acp-${p}-main" }],
          flatten([for fn in ["api", "llm-proxy"] : [for action in ["lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:GetFunctionConfiguration"] : { action = action, resource = "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-${fn}" }]]),
          flatten([for fn in ["api", "llm-proxy"] : [for action in ["iam:CreateRole", "iam:PutRolePolicy"] : { action = action, resource = "arn:aws:iam::123456789012:role/acp-${p}-${fn}" }]]),
          flatten([for group in ["/aws/lambda/acp-${p}-api", "/aws/lambda/acp-${p}-llm-proxy", "/aws/vendedlogs/apigateway/acp-${p}-http-api"] : [
            for action in ["logs:CreateLogGroup", "logs:PutRetentionPolicy"] : [for suffix in ["", ":*"] : { action = action, resource = "arn:aws:logs:us-east-1:123456789012:log-group:${group}${suffix}" }]
          ]]),
          [for action in ["sns:CreateTopic", "sns:Subscribe"] : { action = action, resource = "arn:aws:sns:us-east-1:123456789012:acp-${p}-alarms" }],
          [for name in ["api-errors", "api-throttles", "llm-proxy-errors", "llm-proxy-throttles", "http-api-5xx"] : { action = "cloudwatch:PutMetricAlarm", resource = "arn:aws:cloudwatch:us-east-1:123456789012:alarm:acp-${p}-${name}" }],
          [
            { action = "s3:CreateBucket", resource = "arn:aws:s3:::acp-${p}-site-aws-cost-playground" },
            { action = "s3:PutBucketPolicy", resource = "arn:aws:s3:::acp-${p}-site-aws-cost-playground" },
            { action = "s3:PutObject", resource = "arn:aws:s3:::acp-${p}-site-aws-cost-playground/index.html" },
          ],
        ) :
        anytrue([
          for s in jsondecode(aws_iam_policy.apply_named[env].policy).Statement :
          s.Effect == "Allow" && contains(flatten([s.Action]), need.action)
          && anytrue([for r in flatten([s.Resource]) : can(regex("^${replace(r, "*", ".*")}$", need.resource))])
        ])
      ]
    ]))
    error_message = "A política tem de permitir tudo o que os módulos functions, alarms, site e a tabela chamam, no recurso real do ambiente: criar tabela, função, papel, log group, tópico, alarme e bucket, e publicar o index.html."
  }
}
