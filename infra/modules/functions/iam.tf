# Um papel por função, com nome estável: a ação de corte do Budgets aponta para o papel do llm-proxy pelo nome.
# Só políticas inline não exclusivas: o `apply` não remove a política de negação que o Budgets anexa.
resource "aws_iam_role" "this" {
  for_each = local.functions

  name = "${local.prefix}-${each.key}"

  # Sem o limite, o papel de CI nega criar o papel e gravar as políticas inline dele. O limite não
  # concede nada: a permissão efetiva é a interseção dele com as políticas inline abaixo.
  permissions_boundary = local.permissions_boundary_arn

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })

  lifecycle {
    # Identidade: recriar o papel soltaria a política de corte que o Budgets anexa a ele.
    prevent_destroy = true
  }
}

# Cada função escreve só no próprio log group, que o Terraform já criou (sem logs:CreateLogGroup).
resource "aws_iam_role_policy" "logs" {
  for_each = local.functions

  name = "logs"
  role = aws_iam_role.this[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.this[each.key].arn}:*"
    }]
  })
}

# api: designs e exclusão de conta. Só partições USER#<sub>; não alcança a quota global nem o parâmetro da chave.
resource "aws_iam_role_policy" "api" {
  name = "access"
  role = aws_iam_role.this["api"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Designs"
        Effect    = "Allow"
        Action    = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem"]
        Resource  = var.table_arn
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["USER#*"] } }
      },
      {
        Sid      = "ExclusaoDeConta"
        Effect   = "Allow"
        Action   = "cognito-idp:AdminDeleteUser"
        Resource = var.user_pool_arn
      },
    ]
  })
}

# llm-proxy: contadores de quota (leitura e incremento atômico) e leitura da chave. Único papel que lê o parâmetro.
resource "aws_iam_role_policy" "llm_proxy" {
  name = "access"
  role = aws_iam_role.this["llm-proxy"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Quota", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = var.table_arn },
      { Sid = "ChaveDaClaudeApi", Effect = "Allow", Action = "ssm:GetParameter", Resource = local.api_key_parameter_arn },
    ]
  })
}
