# Papéis `apply-<ambiente>`: os únicos que escrevem na conta pelo CI. O adversário é um PR
# malicioso mergeado por engano ou um agente que consiga rodar o job de deploy; por isso as
# travas ficam aqui, fora do alcance do código do PR, e o papel não consegue removê-las.
locals {
  iam_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}"

  # ARNs montados por nome: o formato é fixo e os testes os comparam como literais.
  state_bucket_arn = { for env, bucket in aws_s3_bucket.state : env => "arn:aws:s3:::${bucket.bucket}" }

  # Mesma chave do `backend.tf` de `infra/envs/<ambiente>`.
  state_object_arn = {
    for env, prefix in local.environments : env => "${local.state_bucket_arn[env]}/acp-${prefix}/terraform.tfstate"
  }

  # Limite de permissões dos papéis que o apply cria. A política nasce na continuação da
  # #124; até lá a negação `DenyRoleWithoutBoundary` impede criar qualquer papel.
  apply_boundary_arn = { for env in keys(local.environments) : env => "${local.iam_arn}:policy/acp-ci-boundary-${env}" }
}

resource "aws_iam_role" "apply" {
  for_each = local.environments

  name                 = "acp-ci-apply-${each.key}"
  description          = "terraform apply e deploy do ambiente ${each.key}"
  max_session_duration = 3600

  # O `sub` de environment não carrega o branch: qualquer job que declare o environment o
  # recebe. Por isso o `ref` também é fixado, e `StringEquals` não aceita curinga. A AWS
  # documenta `ref` como chave do provedor do GitHub, válida só na política de confiança.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "GitHubEnvironment"
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_host}:aud" = "sts.amazonaws.com"
          "${local.oidc_host}:ref" = "refs/heads/main"
          "${local.oidc_host}:sub" = "repo:${local.github_repository}:environment:${each.key}"
        }
      }
    }]
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Permissões que a documentação do backend S3 lista para `use_lockfile`. `DeleteObject` vale
# só para o `.tflock`: este `Allow` não deixa apagar o estado.
resource "aws_iam_role_policy" "apply_state" {
  for_each = local.environments

  name = "state"
  role = aws_iam_role.apply[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "ListStateBucket", Effect = "Allow", Action = "s3:ListBucket", Resource = local.state_bucket_arn[each.key] },
      { Sid = "ReadWriteState", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = local.state_object_arn[each.key] },
      { Sid = "LockState", Effect = "Allow", Action = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"], Resource = "${local.state_object_arn[each.key]}.tflock" },
    ]
  })
}

resource "aws_iam_role_policy" "apply_deny" {
  for_each = local.environments

  name = "deny-guardrails"
  role = aws_iam_role.apply[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Camada IAM das travas contra destruição do ADR: um plano destrutivo aprovado por
        # engano falha no apply. Uma política de recurso na tabela daria `DeleteTable` a
        # outra conta e contornaria a negação, por isso `PutResourcePolicy` também cai.
        Sid    = "DenyDataDeletion"
        Effect = "Deny"
        Action = [
          "cognito-idp:DeleteUserPool",
          "dynamodb:DeleteTable",
          "dynamodb:PutResourcePolicy",
          "route53:DeleteHostedZone",
          "s3:DeleteBucket",
        ]
        Resource = "*"
      },
      {
        # A chave da Claude API fica num parâmetro criado à mão, fora do Terraform (#126):
        # nenhum papel de CI lê, sobrescreve nem apaga parâmetro, então o serviço todo é negado.
        Sid      = "DenyParameterStore"
        Effect   = "Deny"
        Action   = "ssm:*"
        Resource = "*"
      },
      {
        # O papel não altera a si mesmo, os outros papéis de CI, o limite nem o provedor
        # OIDC. Redundante com a próxima de propósito: segue valendo se ela for afrouxada.
        Sid      = "DenyCiIdentity"
        Effect   = "Deny"
        Action   = "iam:*"
        Resource = ["${local.iam_arn}:role/acp-ci-*", "${local.iam_arn}:policy/acp-ci-*", "${local.iam_arn}:oidc-provider/${local.oidc_host}"]
      },
      {
        # Fora dos papéis do próprio ambiente nada de IAM passa: usuários, grupos, políticas
        # gerenciadas, papéis do outro ambiente, papéis vinculados a serviço e `PassRole`.
        Sid         = "DenyIamOutsideEnvironment"
        Effect      = "Deny"
        Action      = "iam:*"
        NotResource = "${local.iam_arn}:role/acp-${each.value}-*"
      },
      {
        # Sem o limite, um papel novo de Lambda não teria as negações e apagaria a tabela
        # por uma função. Com `StringNotEquals`, chave ausente também nega (falha fechada).
        Sid       = "DenyRoleWithoutBoundary"
        Effect    = "Deny"
        Action    = ["iam:CreateRole", "iam:DeleteRolePolicy", "iam:PutRolePermissionsBoundary", "iam:PutRolePolicy"]
        Resource  = "${local.iam_arn}:role/*"
        Condition = { StringNotEquals = { "iam:PermissionsBoundary" = local.apply_boundary_arn[each.key] } }
      },
      {
        # Atalhos que desfariam as travas num papel que já existe: tirar o limite, trocar o
        # trust (abriria o papel para fora da conta) e anexar ou desanexar política gerenciada.
        # As Lambdas só usam política inline, e desanexar desligaria o corte do Budgets no proxy.
        Sid      = "DenyRoleBypass"
        Effect   = "Deny"
        Action   = ["iam:AttachRolePolicy", "iam:DeleteRolePermissionsBoundary", "iam:DetachRolePolicy", "iam:UpdateAssumeRolePolicy"]
        Resource = "*"
      },
      {
        # No bucket do estado só passam as quatro ações do backend; o resto fica negado, inclusive
        # excluir versões e o que a AWS criar depois. O nome casa com `acp-<prefixo>-*`, então
        # um `Allow` futuro por prefixo não alcança a configuração do bucket.
        Sid       = "DenyStateBucketConfig"
        Effect    = "Deny"
        NotAction = ["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"]
        Resource  = [local.state_bucket_arn[each.key], "${local.state_bucket_arn[each.key]}/*"]
      },
      {
        # O papel de um ambiente não lê nem grava o estado do outro.
        Sid      = "DenyOtherEnvironmentState"
        Effect   = "Deny"
        Action   = "s3:*"
        Resource = flatten([for env, arn in local.state_bucket_arn : [arn, "${arn}/*"] if env != each.key])
      },
    ]
  })
}
