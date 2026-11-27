# Escrita dos papéis apply nos serviços cujo ARN carrega o nome do recurso. Só `Allow`: as
# negações de `apply.tf` vencem qualquer linha daqui. A lista é o que o provider hashicorp/aws
# 6.73 chama para criar, ler, atualizar e etiquetar os recursos dos módulos, mais o que o deploy
# usa. Nenhuma exclusão: plano com `delete` ou `replace` é decisão do autor, fora do CI.
locals {
  # "arn:aws:<serviço>:us-east-1:<conta>" dos serviços regionais desta política.
  regional_arn = {
    for service in ["cloudwatch", "dynamodb", "logs", "sns"] :
    service => "arn:aws:${service}:${local.region}:${data.aws_caller_identity.current.account_id}"
  }

  # O módulo `functions` dá ao papel o mesmo nome da função. Só os dois papéis exatos: o apply
  # não cria nem entrega a uma função outro papel `acp-<prefixo>-*`.
  function_role_arn = {
    for env, prefix in local.environments : env => [for name in ["api", "llm-proxy"] : "${local.iam_arn}:role/acp-${prefix}-${name}"]
  }

  # Nome definido em `infra/envs/<ambiente>/main.tf`. Exato de propósito: `acp-<prefixo>-*`
  # casaria com o bucket de estado, que também começa assim.
  site_bucket_arn = { for env, prefix in local.environments : env => "arn:aws:s3:::acp-${prefix}-site-aws-cost-playground" }

  # ARN montado por nome, como `local.apply_boundary_arn`: o `.arn` do provider simulado é
  # aleatório e o anexo recusa o que não for ARN. O teste compara com o nome e o caminho.
  apply_named_arn = { for env in keys(local.environments) : env => "${local.iam_arn}:policy/acp-ci-apply-named-${env}" }
}

# Curinga só onde o nome não é fixo no bootstrap: o prefixo `acp-<prefixo>-*` de tabela, log
# group, tópico e alarme, os objetos do bucket do site e `logs:DescribeLogGroups`, que a AWS
# não deixa restringir por recurso. Nenhuma ação tem curinga e nenhum prefixo alcança S3 ou IAM.
# `ApiAccessLogDelivery` também vale em `*`, por risco aceito pelo autor (#338).
#trivy:ignore:AVD-AWS-0057
resource "aws_iam_policy" "apply_named" {
  for_each = local.environments

  # Caminho explícito: `local.apply_named_arn` monta o ARN sem caminho, e o teste trava os dois.
  name        = "acp-ci-apply-named-${each.key}"
  path        = "/"
  description = "Escrita do apply de ${each.key} nos recursos com nome do ambiente"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Configuração da tabela, nunca os itens (`deny-data`). `DeleteTable` segue negada.
        Sid    = "Table"
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive",
          "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:UpdateContinuousBackups",
          "dynamodb:UpdateTable", "dynamodb:UpdateTimeToLive",
        ]
        Resource = "${local.regional_arn["dynamodb"]}:table/acp-${each.value}-*"
      },
      {
        # Só as duas funções de nome fixo: o apply não cria uma terceira com papel do ambiente.
        # `GetFunctionConfiguration` também serve ao deploy (`wait function-updated-v2`). Sem
        # concorrência reservada, que é configuração de custo manual do autor.
        Sid    = "Functions"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:GetFunction", "lambda:GetFunctionCodeSigningConfig", "lambda:GetFunctionConfiguration",
          "lambda:GetPolicy", "lambda:ListTags", "lambda:ListVersionsByFunction", "lambda:TagResource", "lambda:UntagResource",
          "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
        ]
        Resource = values(local.function_arn[each.key])
      },
      {
        # Só o API Gateway entra na política de recurso da função: sem `*` nem outra conta.
        Sid       = "FunctionInvokePermission"
        Effect    = "Allow"
        Action    = "lambda:AddPermission"
        Resource  = values(local.function_arn[each.key])
        Condition = { StringEquals = { "lambda:Principal" = "apigateway.amazonaws.com" } }
      },
      {
        # O limite de permissões é exigido pela negação `DenyRoleWithoutBoundary`. Política
        # gerenciada e trust de papel existente continuam negados (`DenyRoleBypass`).
        Sid    = "FunctionRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies",
          "iam:PutRolePolicy", "iam:TagRole", "iam:UntagRole",
        ]
        Resource = local.function_role_arn[each.key]
      },
      {
        Sid       = "PassFunctionRoles"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = local.function_role_arn[each.key]
        Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } }
      },
      {
        # Criar e configurar o grupo, nunca ler eventos (`deny-data`). O prefixo casa com as
        # duas formas do ARN de log group, com e sem `:*` no fim.
        Sid    = "LogGroups"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:ListTagsForResource", "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource"]
        Resource = [
          "${local.regional_arn["logs"]}:log-group:/aws/lambda/acp-${each.value}-*",
          "${local.regional_arn["logs"]}:log-group:/aws/vendedlogs/apigateway/acp-${each.value}-*",
        ]
      },
      {
        # A ação não aceita recurso. Lista nome e retenção dos grupos da conta, sem eventos.
        Sid      = "LogGroupList"
        Effect   = "Allow"
        Action   = "logs:DescribeLogGroups"
        Resource = "*"
      },
      {
        # Entrega do log de acesso do stage do HTTP API: o API Gateway a cria com a permissão de
        # quem chama. As sete ações não aceitam recurso nem chave de condição, então valem na
        # conta toda, inclusive nas entregas do outro ambiente: risco aceito pelo autor (#338).
        # Não lê evento (`deny-data`); a política de recurso do Logs só dá escrita a serviço da AWS.
        Sid    = "ApiAccessLogDelivery"
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery", "logs:DeleteLogDelivery", "logs:DescribeResourcePolicies", "logs:GetLogDelivery",
          "logs:ListLogDeliveries", "logs:PutResourcePolicy", "logs:UpdateLogDelivery",
        ]
        Resource = "*"
      },
      {
        Sid    = "AlarmTopic"
        Effect = "Allow"
        Action = [
          "sns:CreateTopic", "sns:GetSubscriptionAttributes", "sns:GetTopicAttributes", "sns:ListTagsForResource",
          "sns:SetTopicAttributes", "sns:TagResource", "sns:UntagResource",
        ]
        Resource = "${local.regional_arn["sns"]}:acp-${each.value}-*"
      },
      {
        # O módulo `alarms` só assina e-mail: sem HTTP, fila ou função como destino.
        Sid       = "AlarmSubscription"
        Effect    = "Allow"
        Action    = "sns:Subscribe"
        Resource  = "${local.regional_arn["sns"]}:acp-${each.value}-*"
        Condition = { StringEquals = { "sns:Protocol" = "email" } }
      },
      {
        Sid      = "Alarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource", "cloudwatch:PutMetricAlarm", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
        Resource = "${local.regional_arn["cloudwatch"]}:alarm:acp-${each.value}-*"
      },
      {
        # A leitura do `aws_s3_bucket` consulta toda a configuração do bucket e não tolera
        # `AccessDenied`, por isso os `Get*` de recursos que o módulo `site` nem declara. As
        # tags têm duas APIs: o provider tenta a nova e cai para `*BucketTagging`.
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
        Resource = local.site_bucket_arn[each.key]
      },
      {
        # Publicação do site pelo deploy. Sem ler nem apagar objeto.
        Sid      = "SiteObjects"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${local.site_bucket_arn[each.key]}/*"
      },
    ]
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Anexo feito pelo bootstrap, com a credencial do autor: o papel apply nega a si mesmo
# `iam:AttachRolePolicy` e `iam:DetachRolePolicy` (`DenyRoleBypass` e `DenyCiIdentity`).
resource "aws_iam_role_policy_attachment" "apply_named" {
  for_each = local.environments

  role       = aws_iam_role.apply[each.key].name
  policy_arn = local.apply_named_arn[each.key]

  # O ARN vem do nome, sem referência ao recurso: a ordem precisa ser dita.
  depends_on = [aws_iam_policy.apply_named]
}
