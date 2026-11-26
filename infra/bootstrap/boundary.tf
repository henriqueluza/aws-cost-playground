# Limite de permissões dos papéis que o apply cria (as Lambdas). É o teto do que qualquer
# papel `acp-<prefixo>-*` consegue fazer, seja qual for a política inline que um deploy
# lhe der. O apply não altera esta política: ela casa com `policy/acp-ci-*` (`DenyCiIdentity`).
locals {
  # A mesma região do provider (`versions.tf`) e dos ambientes: o ADR fixa us-east-1.
  region = "us-east-1"

  # Mesmos nomes do módulo `functions`. A chave `lambda:SourceFunctionArn` só aceita o ARN
  # sem versão nem alias.
  function_arn = {
    for env, prefix in local.environments : env => {
      for name in ["api", "llm-proxy"] :
      name => "arn:aws:lambda:${local.region}:${data.aws_caller_identity.current.account_id}:function:acp-${prefix}-${name}"
    }
  }
}

# Curinga só onde é inevitável: o sufixo `:*` dos log streams, o prefixo de nomes do
# ambiente e o ID do user pool, que a AWS gera (o escopo ali é a tag). Nenhuma ação tem curinga.
#trivy:ignore:AVD-AWS-0057
resource "aws_iam_policy" "apply_boundary" {
  for_each = local.environments

  # Caminho explícito: `local.apply_boundary_arn` monta o ARN sem caminho, e o teste trava os dois.
  name        = "acp-ci-boundary-${each.key}"
  path        = "/"
  description = "Limite de permissoes dos papeis criados pelo apply de ${each.key}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "FunctionLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/acp-${each.value}-*:*"
      },
      {
        # `iam:CreateRole` aceita qualquer trust. Os `Allow` de dado só valem quando a chamada
        # sai do código de uma das duas funções: um papel criado com trust para fora da conta,
        # ou entregue a uma função nova, não lê item, usuário nem a chave.
        Sid       = "TableItems"
        Effect    = "Allow"
        Action    = ["dynamodb:BatchWriteItem", "dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"]
        Resource  = "arn:aws:dynamodb:${local.region}:${data.aws_caller_identity.current.account_id}:table/acp-${each.value}-*"
        Condition = { ArnEquals = { "lambda:SourceFunctionArn" = [local.function_arn[each.key]["api"], local.function_arn[each.key]["llm-proxy"]] } }
      },
      {
        # O ARN do user pool leva um ID gerado; o ambiente vem da tag, que o apply não pode
        # trocar (regra de tags na #169).
        Sid      = "DeleteOwnAccount"
        Effect   = "Allow"
        Action   = "cognito-idp:AdminDeleteUser"
        Resource = "arn:aws:cognito-idp:${local.region}:${data.aws_caller_identity.current.account_id}:userpool/*"
        Condition = {
          ArnEquals    = { "lambda:SourceFunctionArn" = local.function_arn[each.key]["api"] }
          StringEquals = { "aws:ResourceTag/environment" = each.key }
        }
      },
      {
        # Parâmetro criado à mão pelo autor. Sem `kms:Decrypt`: a chave gerenciada `aws/ssm`
        # já autoriza quem pode ler o parâmetro.
        Sid       = "ClaudeApiKey"
        Effect    = "Allow"
        Action    = "ssm:GetParameter"
        Resource  = "arn:aws:ssm:${local.region}:${data.aws_caller_identity.current.account_id}:parameter/acp/${each.key}/anthropic-api-key"
        Condition = { ArnEquals = { "lambda:SourceFunctionArn" = local.function_arn[each.key]["llm-proxy"] } }
      },
      {
        # As mesmas exclusões negadas ao papel apply. Negação explícita vale também contra
        # uma política de recurso que cite o papel.
        Sid    = "DenyDataDeletion"
        Effect = "Deny"
        Action = [
          "cognito-idp:DeleteUserPool", "dynamodb:DeleteTable", "dynamodb:PutResourcePolicy",
          "route53:DeleteHostedZone", "s3:DeleteBucket",
        ]
        Resource = "*"
      },
      {
        # Uma função nunca mexe em IAM nem troca de papel: o trust de outro papel da conta
        # poderia citá-la e dispensar o `Allow`.
        Sid      = "DenyIdentity"
        Effect   = "Deny"
        Action   = ["iam:*", "sts:AssumeRole"]
        Resource = "*"
      },
    ]
  })

  lifecycle {
    prevent_destroy = true
  }
}
