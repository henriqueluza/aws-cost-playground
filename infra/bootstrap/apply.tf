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

  # CONTRATO (WP1): um statement `GitHubEnvironment`, `StringEquals` em `aud`, `sub` e `ref`.
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [] })
}

# CONTRATO (WP1): só `Allow`, sem curinga: `ListStateBucket`, `ReadWriteState`, `LockState`.
resource "aws_iam_role_policy" "apply_state" {
  for_each = local.environments

  name   = "state"
  role   = aws_iam_role.apply[each.key].name
  policy = jsonencode({ Version = "2012-10-17", Statement = [] })
}

# CONTRATO (WP1): só `Deny`, na ordem `DenyDataDeletion`, `DenyCiIdentity`,
# `DenyIamOutsideEnvironment`, `DenyRoleWithoutBoundary`, `DenyBoundaryRemoval`,
# `DenyStateBucketConfig`, `DenyOtherEnvironmentState`.
resource "aws_iam_role_policy" "apply_deny" {
  for_each = local.environments

  name   = "deny-guardrails"
  role   = aws_iam_role.apply[each.key].name
  policy = jsonencode({ Version = "2012-10-17", Statement = [] })
}
