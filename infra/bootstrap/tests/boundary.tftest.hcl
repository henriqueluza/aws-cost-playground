# Limite de permissões dos papéis criados pelo apply e negação de dado dos papéis apply.
# Só provider simulado: sem credenciais nem AWS. Cada igualdade é uma trava: ação, recurso
# ou condição a mais ou a menos quebra o assert.
mock_provider "aws" {}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

run "limite_de_permissoes" {
  command = apply

  # O `.arn` do provider simulado é aleatório: o ARN é conferido pelo nome e pelo caminho.
  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      aws_iam_policy.apply_boundary[env].name == "acp-ci-boundary-${env}" && aws_iam_policy.apply_boundary[env].path == "/"
      && local.apply_boundary_arn[env] == "arn:aws:iam::123456789012:policy/${aws_iam_policy.apply_boundary[env].name}"
      && jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[4].Condition.StringNotEquals["iam:PermissionsBoundary"] == "arn:aws:iam::123456789012:policy/${aws_iam_policy.apply_boundary[env].name}"
    ])
    error_message = "O ARN da política de limite tem de ser o que a negação DenyRoleWithoutBoundary exige: policy/acp-ci-boundary-<ambiente>."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] : anytrue([
        for arn in jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[2].Resource :
        arn == "arn:aws:iam::123456789012:policy/acp-ci-*" && startswith(aws_iam_policy.apply_boundary[env].name, "acp-ci-")
      ]) && jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[2].Action == "iam:*"
    ])
    error_message = "O papel apply não altera nem apaga a política de limite: o nome dela casa com policy/acp-ci-*, negado em DenyCiIdentity."
  }

  assert {
    condition = alltrue([for env, p in { staging = "stg", production = "prod" } : jsondecode(aws_iam_policy.apply_boundary[env].policy).Statement == [
      {
        Sid      = "FunctionLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/acp-${p}-*:*"
      },
      {
        Sid       = "TableItems"
        Effect    = "Allow"
        Action    = ["dynamodb:BatchWriteItem", "dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"]
        Resource  = "arn:aws:dynamodb:us-east-1:123456789012:table/acp-${p}-*"
        Condition = { ArnEquals = { "lambda:SourceFunctionArn" = ["arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-api", "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-llm-proxy"] } }
      },
      {
        Sid      = "DeleteOwnAccount"
        Effect   = "Allow"
        Action   = "cognito-idp:AdminDeleteUser"
        Resource = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/*"
        Condition = {
          ArnEquals    = { "lambda:SourceFunctionArn" = "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-api" }
          StringEquals = { "aws:ResourceTag/environment" = env }
        }
      },
      {
        Sid       = "ClaudeApiKey"
        Effect    = "Allow"
        Action    = "ssm:GetParameter"
        Resource  = "arn:aws:ssm:us-east-1:123456789012:parameter/acp/${env}/anthropic-api-key"
        Condition = { ArnEquals = { "lambda:SourceFunctionArn" = "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-llm-proxy" } }
      },
      {
        Sid      = "DenyDataDeletion"
        Effect   = "Deny"
        Action   = ["cognito-idp:DeleteUserPool", "dynamodb:DeleteTable", "dynamodb:PutResourcePolicy", "route53:DeleteHostedZone", "s3:DeleteBucket"]
        Resource = "*"
      },
      {
        Sid      = "DenyIdentity"
        Effect   = "Deny"
        Action   = ["iam:*", "sts:AssumeRole"]
        Resource = "*"
      },
    ]])
    error_message = "O limite permite só logs, itens da tabela, AdminDeleteUser e a chave do próprio ambiente, com o dado preso às duas funções, e nega exclusão, IAM e sts:AssumeRole."
  }

  # Redundante com a igualdade acima de propósito: diz o que está errado quando ela quebra.
  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_policy.apply_boundary[env].policy).Statement : [
          !strcontains(jsonencode(s.Action), "*"),
          alltrue([for action in flatten([s.Action]) : can(regex("^(logs|dynamodb|cognito-idp|ssm):", action))]),
          s.Resource != "*",
          s.Sid == "FunctionLogs" || can(s.Condition.ArnEquals["lambda:SourceFunctionArn"]),
        ] if s.Effect == "Allow"
      ]
    ]))
    error_message = "Nenhum Allow do limite tem curinga em ação, Resource \"*\" nem serviço fora de logs, dynamodb, cognito-idp e ssm (nada de IAM, STS, KMS ou S3), e todo Allow de dado exige lambda:SourceFunctionArn."
  }

  # Contrato com o módulo `functions` (comentário da #166 e teste `politicas_inline_cabem_no_limite`
  # do módulo): cada ação que os papéis das funções recebem, no recurso real e chamada pela
  # função certa, tem de caber num Allow do limite. Ação fora do limite falha só em execução.
  assert {
    condition = alltrue(flatten([
      for env, p in { staging = "stg", production = "prod" } : [
        for need in concat(
          flatten([for fn in ["api", "llm-proxy"] : [for action in ["logs:CreateLogStream", "logs:PutLogEvents"] : { fn = fn, action = action, resource = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/acp-${p}-${fn}:*" }]]),
          [for action in ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem"] : { fn = "api", action = action, resource = "arn:aws:dynamodb:us-east-1:123456789012:table/acp-${p}-main" }],
          [for action in ["dynamodb:GetItem", "dynamodb:UpdateItem"] : { fn = "llm-proxy", action = action, resource = "arn:aws:dynamodb:us-east-1:123456789012:table/acp-${p}-main" }],
          [
            { fn = "api", action = "cognito-idp:AdminDeleteUser", resource = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_AbCdEf123" },
            { fn = "llm-proxy", action = "ssm:GetParameter", resource = "arn:aws:ssm:us-east-1:123456789012:parameter/acp/${env}/anthropic-api-key" },
          ],
        ) :
        anytrue([
          for s in jsondecode(aws_iam_policy.apply_boundary[env].policy).Statement :
          s.Effect == "Allow" && contains(flatten([s.Action]), need.action)
          && can(regex("^${replace(s.Resource, "*", ".*")}$", need.resource))
          && contains(flatten([try(s.Condition.ArnEquals["lambda:SourceFunctionArn"], "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-${need.fn}")]), "arn:aws:lambda:us-east-1:123456789012:function:acp-${p}-${need.fn}")
        ])
      ]
    ]))
    error_message = "O limite tem de permitir tudo o que o módulo functions concede: logs das duas funções, GetItem, PutItem, DeleteItem, Query e BatchWriteItem para a api, GetItem e UpdateItem para o llm-proxy, AdminDeleteUser para a api e ssm:GetParameter na chave para o llm-proxy."
  }

  assert {
    condition     = length(aws_iam_policy.apply_boundary["staging"].policy) <= 6144 && length(aws_iam_policy.apply_boundary["production"].policy) <= 6144
    error_message = "Uma política gerenciada não pode passar de 6144 caracteres, o limite da AWS."
  }
}

run "negacao_de_dado_do_papel_apply" {
  command = apply

  assert {
    condition = alltrue([for env in ["staging", "production"] : jsondecode(aws_iam_role_policy.apply_deny_data[env].policy).Statement == [
      {
        Sid    = "DenyTableItems"
        Effect = "Deny"
        Action = [
          "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem", "dynamodb:DeleteItem",
          "dynamodb:EnableKinesisStreamingDestination", "dynamodb:ExportTableToPointInTime", "dynamodb:GetItem",
          "dynamodb:GetRecords", "dynamodb:PartiQL*", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:UpdateItem",
        ]
        Resource = "*"
      },
      { Sid = "DenyUserData", Effect = "Deny", Action = ["cognito-idp:Admin*", "cognito-idp:ListUsers*"], Resource = "*" },
      { Sid = "DenySecrets", Effect = "Deny", Action = "secretsmanager:*", Resource = "*" },
      {
        Sid    = "DenyLogEvents"
        Effect = "Deny"
        Action = [
          "logs:CreateExportTask", "logs:FilterLogEvents", "logs:GetLogEvents", "logs:GetLogObject", "logs:GetLogRecord",
          "logs:GetQueryResults", "logs:PutAccountPolicy", "logs:PutSubscriptionFilter", "logs:StartLiveTail", "logs:StartQuery", "logs:Unmask",
        ]
        Resource = "*"
      },
      { Sid = "DenyFunctionInvoke", Effect = "Deny", Action = "lambda:Invoke*", Resource = "*" },
      { Sid = "DenyAssumeRole", Effect = "Deny", Action = "sts:AssumeRole", Resource = "*" },
    ]])
    error_message = "O papel apply não lê nem grava itens, usuários, segredos e eventos de log, não invoca função e não assume outro papel: só Deny, em qualquer recurso."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      aws_iam_role_policy.apply_deny_data[env].name == "deny-data" && aws_iam_role_policy.apply_deny_data[env].role == "acp-ci-apply-${env}"
    ])
    error_message = "A política de negação de dado se chama deny-data e está presa ao papel apply do próprio ambiente."
  }

  # Ações de controle que o apply usa para gerenciar a infraestrutura: nenhuma negação de
  # dado pode alcançá-las, nem por curinga.
  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.apply_deny_data["staging"].policy).Statement : [
        for denied in flatten([s.Action]) : [
          for control in [
            "dynamodb:CreateTable", "dynamodb:UpdateTable", "dynamodb:DescribeTable", "dynamodb:UpdateContinuousBackups", "dynamodb:TagResource",
            "cognito-idp:CreateUserPool", "cognito-idp:UpdateUserPool", "cognito-idp:DescribeUserPool", "cognito-idp:CreateUserPoolClient",
            "logs:CreateLogGroup", "logs:PutRetentionPolicy", "logs:DescribeLogGroups", "logs:PutMetricFilter",
            "lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:GetFunction", "lambda:AddPermission",
            "sts:GetCallerIdentity",
          ] : !can(regex("^${replace(denied, "*", ".*")}$", control))
        ]
      ]
    ]))
    error_message = "A negação de dado não pode impedir o apply de criar e alterar tabela, user pool, log group e função."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[1].Action == "ssm:*" && jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement[1].Effect == "Deny"
    ])
    error_message = "O valor dos parâmetros do SSM é negado em deny-guardrails (ssm:*); se sair de lá, tem de entrar na negação de dado."
  }
}
