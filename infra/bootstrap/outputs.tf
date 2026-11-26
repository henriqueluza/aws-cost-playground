# Cada chave é o nome de uma variável de repositório do GitHub lida pelo `terraform.yml`
# (`AWS_PRICES_ROLE_ARN` é lida pelo workflow de preços).
output "github_variables" {
  description = "Variáveis de repositório do GitHub (não são segredos) que o autor cadastra depois do apply"
  value = {
    AWS_PLAN_ROLE_ARN          = aws_iam_role.plan.arn
    AWS_PRICES_ROLE_ARN        = aws_iam_role.prices.arn
    TF_STATE_BUCKET_STAGING    = aws_s3_bucket.state["staging"].bucket
    TF_STATE_BUCKET_PRODUCTION = aws_s3_bucket.state["production"].bucket
  }
}

# Chave externa: nome do GitHub Environment. Chave interna: nome da variável desse Environment.
output "github_environment_variables" {
  description = "Variáveis de cada GitHub Environment (não são segredos) que o autor cadastra depois do apply"
  value       = { for env, role in aws_iam_role.apply : env => { AWS_APPLY_ROLE_ARN = role.arn } }
}
