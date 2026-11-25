# Papel `plan`: o único que roda código vindo de um PR (job `plan` do `terraform.yml`).
# Por isso é somente leitura, e a leitura de dado (itens, usuários, logs, segredos e
# objetos fora do estado) é negada de forma explícita.
resource "aws_iam_role" "plan" {
  name                 = "acp-ci-plan"
  description          = "terraform plan em pull request (somente leitura)"
  max_session_duration = 3600

  # `StringEquals` nas duas condições: sem curinga, nenhum outro repositório, branch,
  # environment ou evento casa com o `sub`.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "GitHubPullRequest"
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_host}:aud" = "sts.amazonaws.com"
          "${local.oidc_host}:sub" = "repo:${local.github_repository}:pull_request"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "plan_deny_data" {
  name = "deny-data-read"
  role = aws_iam_role.plan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyDataRead"
        Effect = "Deny"
        Action = [
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminListDevices",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminListUserAuthEvents",
          "cognito-idp:ListUsers",
          "cognito-idp:ListUsersInGroup",
          "dynamodb:BatchGetItem",
          "dynamodb:GetItem",
          "dynamodb:GetRecords",
          "dynamodb:PartiQLSelect",
          "dynamodb:Query",
          "dynamodb:Scan",
          "logs:FilterLogEvents",
          "logs:GetLogEvents",
          "logs:GetLogObject",
          "logs:GetLogRecord",
          "logs:GetQueryResults",
          "logs:StartLiveTail",
          "logs:StartQuery",
          "logs:Unmask",
          "secretsmanager:BatchGetSecretValue",
          "secretsmanager:GetSecretValue",
          "ssm:GetParameter",
          "ssm:GetParameterHistory",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ]
        Resource = "*"
      },
      {
        Sid         = "DenyObjectReadOutsideState"
        Effect      = "Deny"
        Action      = ["s3:GetObject", "s3:GetObjectVersion"]
        NotResource = [for bucket in aws_s3_bucket.state : "${bucket.arn}/*"]
      },
    ]
  })
}
