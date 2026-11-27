# Política acp-ci-apply-id-<env>: escrita dos papéis apply nos recursos com ARN por ID.
# Só provider simulado: sem credenciais nem AWS. A igualdade da lista inteira trava qualquer
# afrouxamento; os asserts de forma dizem o que está errado quando ela quebra.
mock_provider "aws" {}

variables {
  zone_name = "example.com"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

override_data {
  target = data.aws_route53_zone.product
  values = {
    zone_id = "Z0000000EXAMPLE"
  }
}

run "identidade_anexo_e_papel_de_servico" {
  command = apply

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      aws_iam_policy.apply_id[env].name == "acp-ci-apply-id-${env}" && aws_iam_policy.apply_id[env].path == "/"
      && aws_iam_role_policy_attachment.apply_id[env].role == "acp-ci-apply-${env}"
      && aws_iam_role_policy_attachment.apply_id[env].policy_arn == "arn:aws:iam::123456789012:policy/acp-ci-apply-id-${env}"
    ])
    error_message = "A política se chama acp-ci-apply-id-<ambiente>, no caminho /, e está anexada só ao papel apply do próprio ambiente."
  }

  assert {
    condition     = aws_iam_service_linked_role.apigateway.aws_service_name == "ops.apigateway.amazonaws.com"
    error_message = "O papel vinculado a serviço do API Gateway nasce no bootstrap, para o serviço ops.apigateway.amazonaws.com."
  }

  # `one` de lista vazia é `null`, que não é `true`: renomear o Sid reprova, com a mensagem abaixo.
  assert {
    condition = alltrue([
      for env in ["staging", "production"] : one([
        for s in jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement :
        s.Effect == "Deny" && s.Action == "iam:*" && !can(s.Condition) && s.NotResource == "arn:aws:iam::123456789012:role/acp-${env == "staging" ? "stg" : "prod"}-*"
        if s.Sid == "DenyIamOutsideEnvironment"
      ]) == true
    ])
    error_message = "A negação DenyIamOutsideEnvironment continua fechada: iam:CreateServiceLinkedRole não foi aberta para os papéis apply."
  }
}

run "lista_inteira_de_statements" {
  command = apply

  assert {
    condition = alltrue([for env in ["staging", "production"] : jsondecode(aws_iam_policy.apply_id[env].policy).Statement == [
      {
        Sid       = "CreateTagged"
        Effect    = "Allow"
        Action    = ["cloudfront:CreateDistribution", "cognito-idp:CreateUserPool"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestTag/environment" = env } }
      },
      {
        Sid      = "CertificateRequest"
        Effect   = "Allow"
        Action   = "acm:RequestCertificate"
        Resource = "*"
        Condition = {
          StringEquals              = { "aws:RequestTag/environment" = env }
          "ForAllValues:StringLike" = { "acm:DomainNames" = { staging = ["staging.example.com", "*.staging.example.com"], production = ["example.com", "api.example.com", "auth.example.com"] }[env] }
          Null                      = { "acm:DomainNames" = "false" }
        }
      },
      {
        Sid      = "TagOwn"
        Effect   = "Allow"
        Action   = ["acm:AddTagsToCertificate", "cloudfront:TagResource", "cognito-idp:TagResource"]
        Resource = ["arn:aws:acm:us-east-1:123456789012:certificate/*", "arn:aws:cloudfront::123456789012:distribution/*", "arn:aws:cognito-idp:us-east-1:123456789012:userpool/*"]
        Condition = {
          StringEquals         = { "aws:RequestTag/environment" = env }
          StringEqualsIfExists = { "aws:ResourceTag/environment" = env }
        }
      },
      {
        Sid       = "Distribution"
        Effect    = "Allow"
        Action    = ["cloudfront:CreateInvalidation", "cloudfront:GetDistribution", "cloudfront:GetInvalidation", "cloudfront:ListTagsForResource", "cloudfront:UpdateDistribution"]
        Resource  = "arn:aws:cloudfront::123456789012:distribution/*"
        Condition = { StringEquals = { "aws:ResourceTag/environment" = env } }
      },
      {
        Sid    = "EdgePolicies"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateCachePolicy", "cloudfront:CreateOriginAccessControl", "cloudfront:CreateResponseHeadersPolicy",
          "cloudfront:GetCachePolicy", "cloudfront:GetOriginAccessControl", "cloudfront:GetResponseHeadersPolicy", "cloudfront:ListCachePolicies",
        ]
        Resource = "*"
      },
      {
        Sid       = "Certificates"
        Effect    = "Allow"
        Action    = ["acm:DescribeCertificate", "acm:ListTagsForCertificate"]
        Resource  = "arn:aws:acm:us-east-1:123456789012:certificate/*"
        Condition = { StringEquals = { "aws:ResourceTag/environment" = env } }
      },
      {
        Sid    = "UserPool"
        Effect = "Allow"
        Action = [
          "cognito-idp:CreateManagedLoginBranding", "cognito-idp:CreateUserPoolClient", "cognito-idp:CreateUserPoolDomain",
          "cognito-idp:DescribeManagedLoginBranding", "cognito-idp:DescribeManagedLoginBrandingByClient", "cognito-idp:DescribeUserPool",
          "cognito-idp:DescribeUserPoolClient", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:ListUserPoolClients",
          "cognito-idp:UpdateManagedLoginBranding", "cognito-idp:UpdateUserPoolClient", "cognito-idp:UpdateUserPoolDomain",
        ]
        Resource  = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/*"
        Condition = { StringEquals = { "aws:ResourceTag/environment" = env } }
      },
      {
        Sid       = "UserPoolUpdate"
        Effect    = "Allow"
        Action    = "cognito-idp:UpdateUserPool"
        Resource  = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/*"
        Condition = { StringEquals = { "aws:ResourceTag/environment" = env }, Null = { "aws:TagKeys" = "true" } }
      },
      { Sid = "UserPoolDomainRead", Effect = "Allow", Action = "cognito-idp:DescribeUserPoolDomain", Resource = "*" },
      {
        Sid       = "ApiCreate"
        Effect    = "Allow"
        Action    = "apigateway:POST"
        Resource  = ["arn:aws:apigateway:us-east-1::/apis", "arn:aws:apigateway:us-east-1::/domainnames"]
        Condition = { StringEquals = { "aws:RequestTag/environment" = env } }
      },
      {
        Sid       = "Api"
        Effect    = "Allow"
        Action    = ["apigateway:GET", "apigateway:PATCH", "apigateway:POST"]
        Resource  = ["arn:aws:apigateway:us-east-1::/apis/*", "arn:aws:apigateway:us-east-1::/domainnames/*"]
        Condition = { StringEquals = { "aws:ResourceTag/environment" = env } }
      },
      {
        Sid      = "ZoneRead"
        Effect   = "Allow"
        Action   = ["route53:GetChange", "route53:GetHostedZone", "route53:ListResourceRecordSets", "route53:ListTagsForResource"]
        Resource = ["arn:aws:route53:::hostedzone/Z0000000EXAMPLE", "arn:aws:route53:::change/*"]
      },
      { Sid = "ZoneList", Effect = "Allow", Action = "route53:ListHostedZones", Resource = "*" },
      {
        Sid      = "Records"
        Effect   = "Allow"
        Action   = "route53:ChangeResourceRecordSets"
        Resource = "arn:aws:route53:::hostedzone/Z0000000EXAMPLE"
        Condition = merge(
          {
            "ForAllValues:StringEquals" = {
              "route53:ChangeResourceRecordSetsActions"     = ["CREATE", "UPSERT"]
              "route53:ChangeResourceRecordSetsRecordTypes" = ["A", "CNAME"]
            }
            Null = {
              "route53:ChangeResourceRecordSetsActions"               = "false"
              "route53:ChangeResourceRecordSetsNormalizedRecordNames" = "false"
              "route53:ChangeResourceRecordSetsRecordTypes"           = "false"
            }
            "ForAllValues:StringLike" = {
              "route53:ChangeResourceRecordSetsNormalizedRecordNames" = { staging = ["staging.example.com", "*.staging.example.com"], production = ["example.com", "api.example.com", "auth.example.com", "_*.example.com"] }[env]
            }
          },
          { for operator in ["ForAllValues:StringNotLike"] : operator => { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["staging.example.com", "*.staging.example.com"] } if env == "production" },
        )
      },
    ]])
    error_message = "A política dá exatamente estes 14 Allow, com o ambiente na tag ou no nome do registro. Ação, recurso ou condição a mais ou a menos quebra o assert."
  }
}

run "tamanho_por_politica_e_por_papel" {
  command = apply

  assert {
    condition     = alltrue([for env in ["staging", "production"] : length(aws_iam_policy.apply_id[env].policy) <= 6144 && length(aws_iam_policy.apply_named[env].policy) <= 6144])
    error_message = "Uma política gerenciada não pode passar de 6144 caracteres, o limite da AWS."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      length(aws_iam_role_policy.apply_state[env].policy) + length(aws_iam_role_policy.apply_deny[env].policy) + length(aws_iam_role_policy.apply_deny_data[env].policy) <= 10240
      && length([for a in concat(values(aws_iam_role_policy_attachment.apply_named), values(aws_iam_role_policy_attachment.apply_id)) : a if a.role == "acp-ci-apply-${env}"]) == 2
    ])
    error_message = "Cada papel apply fica dentro dos limites da AWS: 10240 caracteres de políticas inline e, das 10 gerenciadas possíveis, exatamente as duas do bootstrap."
  }
}

run "forma_e_escopo_por_ambiente" {
  command = apply

  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : [
          s.Effect == "Allow",
          !can(s.NotAction) && !can(s.NotResource),
          !strcontains(jsonencode(s.Action), "*"),
          alltrue([for action in flatten([s.Action]) : can(regex("^(acm|apigateway|cloudfront|cognito-idp|route53):", action))]),
        ]
      ]
    ]))
    error_message = "Todo statement é Allow, sem NotAction, NotResource nem curinga em ação, e só de acm, apigateway, cloudfront, cognito-idp e route53."
  }

  # Sem condição de tag do próprio ambiente só passam leitura, criação de política do CloudFront
  # (que não aceita tag) e os registros, delimitados pelo nome.
  assert {
    condition = alltrue(flatten([
      for env, other in { staging = "production", production = "staging" } : [
        for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : [
          s.Sid == "Records" || !strcontains(jsonencode(s), other),
          anytrue([
            try(s.Condition.StringEquals["aws:ResourceTag/environment"], "") == env,
            try(s.Condition.StringEquals["aws:RequestTag/environment"], "") == env,
            contains(["EdgePolicies", "UserPoolDomainRead", "ZoneRead", "ZoneList", "Records"], s.Sid),
          ]),
          can(s.Condition) || alltrue([for action in flatten([s.Action]) : can(regex(":(Get|List|Describe)", action)) || (s.Sid == "EdgePolicies" && can(regex("^cloudfront:Create(CachePolicy|OriginAccessControl|ResponseHeadersPolicy)$", action)))]),
          s.Resource != "*" || contains(["CreateTagged", "CertificateRequest", "EdgePolicies", "UserPoolDomainRead", "ZoneList"], s.Sid),
        ]
      ]
    ]))
    error_message = "Toda escrita exige a tag environment do próprio ambiente (no recurso ou no pedido). Sem condição só há leitura e criação de política ou OAC do CloudFront; Resource \"*\" só nos cinco Sids conhecidos; nada cita o outro ambiente."
  }

  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : [
          for action in flatten([s.Action]) : [
            alltrue([for word in ["Delete", "Remove", "Untag", "Admin", "ListUsers", "Import", "Password", "SignUp", "Auth", "apigateway:DELETE", "apigateway:PUT", "iam:"] : !strcontains(action, word)]),
            !can(regex("^cognito-idp:.*User", action)) || can(regex("^cognito-idp:[A-Za-z]*UserPool", action)),
            !can(regex("Tag(Resource|sToCertificate)$", action)) || (s.Sid == "TagOwn" && s.Condition.StringEquals["aws:RequestTag/environment"] == env && s.Condition.StringEqualsIfExists["aws:ResourceTag/environment"] == env),
            action != "cognito-idp:UpdateUserPool" || (s.Action == action && s.Condition.StringEquals["aws:ResourceTag/environment"] == env && s.Condition.Null["aws:TagKeys"] == "true"),
          ]
        ]
      ]
    ]))
    error_message = "Nenhuma exclusão, nenhuma ação de usuário do Cognito, nenhum DELETE ou PUT do API Gateway, nada de IAM; etiquetar só no Sid TagOwn, com o ambiente no pedido e no recurso, nunca tirar etiqueta, e UpdateUserPool só sem tags no pedido."
  }

  # Nada do que o papel já tem negado (Deny sem condição em qualquer recurso) pode voltar por um Allow.
  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for denied in flatten([
          for s in concat(jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement, jsondecode(aws_iam_role_policy.apply_deny_data[env].policy).Statement) :
          flatten([s.Action]) if s.Effect == "Deny" && can(s.Action) && try(s.Resource == "*", false) && !can(s.Condition)
          ]) : [
          for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : [for action in flatten([s.Action]) : !can(regex("^${replace(denied, "*", ".*")}$", action))]
        ]
      ]
    ]))
    error_message = "Nenhuma ação da política casa com um Deny sem condição de deny-guardrails ou deny-data (DeleteUserPool, Admin*, ListUsers*, DeleteHostedZone)."
  }

  # O assert acima passaria com a lista de negados vazia: ela tem de trazer o que protege o Cognito e a zona.
  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for expected in ["cognito-idp:DeleteUserPool", "cognito-idp:Admin*", "cognito-idp:ListUsers*", "route53:DeleteHostedZone"] : contains(flatten([
          for s in concat(jsondecode(aws_iam_role_policy.apply_deny[env].policy).Statement, jsondecode(aws_iam_role_policy.apply_deny_data[env].policy).Statement) :
          flatten([s.Action]) if s.Effect == "Deny" && can(s.Action) && try(s.Resource == "*", false) && !can(s.Condition)
        ]), expected)
      ]
    ]))
    error_message = "A lista de negados sem condição, que o assert anterior percorre, contém cognito-idp:DeleteUserPool, cognito-idp:Admin*, cognito-idp:ListUsers* e route53:DeleteHostedZone: esvaziá-la ou trocar o filtro reprova."
  }
}

run "registros_dns_por_ambiente" {
  command = apply

  # Os asserts abaixo filtram por Sid ou por ação: sem o statement, passariam sem conferir nada.
  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      [for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : s.Sid if contains(flatten([s.Action]), "route53:ChangeResourceRecordSets")] == ["Records"]
      && [for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : s.Sid if contains(flatten([s.Action]), "acm:RequestCertificate")] == ["CertificateRequest"]
    ])
    error_message = "route53:ChangeResourceRecordSets aparece uma vez, no Sid Records, e acm:RequestCertificate uma vez, no Sid CertificateRequest: os asserts de nome deste run dependem desses dois statements."
  }

  # Avalia as condições como o IAM: todo nome do pedido precisa casar com StringLike e com nenhum StringNotLike.
  assert {
    condition = alltrue(flatten([
      for env, probes in {
        staging = {
          allowed = ["staging.example.com", "api.staging.example.com", "auth.staging.example.com", "_a1b2.staging.example.com", "_a1b2.api.staging.example.com"]
          denied  = ["example.com", "api.example.com", "auth.example.com", "www.example.com", "_a1b2.example.com", "_a1b2.api.example.com", "xstaging.example.com", "staging.example.com.evil.net"]
        }
        production = {
          allowed = ["example.com", "api.example.com", "auth.example.com", "_a1b2.example.com", "_a1b2.api.example.com", "_a1b2.auth.example.com"]
          denied  = ["staging.example.com", "api.staging.example.com", "auth.staging.example.com", "_a1b2.staging.example.com", "_a1b2.api.staging.example.com", "www.example.com", "mail.example.com", "example.com.evil.net"]
        }
        } : [
        for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : [
          for expected, names in probes : [
            for name in names : (
              anytrue([for p in s.Condition["ForAllValues:StringLike"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"] : can(regex("^${replace(replace(p, ".", "\\."), "*", ".*")}$", name))])
              && !anytrue([for p in try(s.Condition["ForAllValues:StringNotLike"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"], []) : can(regex("^${replace(replace(p, ".", "\\."), "*", ".*")}$", name))])
            ) == (expected == "allowed")
          ]
        ] if s.Sid == "Records"
      ]
    ]))
    error_message = "Staging só grava registros sob staging.<domínio>; produção grava o domínio, api., auth. e os CNAMEs de validação, e nunca um nome de staging."
  }

  assert {
    condition = alltrue(flatten([
      for env, probes in {
        staging    = { allowed = ["staging.example.com", "api.staging.example.com", "*.staging.example.com"], denied = ["example.com", "api.example.com", "auth.example.com", "*.example.com"] }
        production = { allowed = ["example.com", "api.example.com", "auth.example.com"], denied = ["staging.example.com", "api.staging.example.com", "*.example.com", "www.example.com"] }
        } : [
        for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : [
          for expected, names in probes : [
            for name in names :
            anytrue([for p in s.Condition["ForAllValues:StringLike"]["acm:DomainNames"] : can(regex("^${replace(replace(p, ".", "\\."), "*", ".*")}$", name))]) == (expected == "allowed")
          ]
        ] if s.Sid == "CertificateRequest"
      ]
    ]))
    error_message = "Cada papel só pede certificado para os nomes do próprio ambiente: staging não obtém certificado de um nome de produção (nem o curinga da zona), e vice-versa."
  }

  assert {
    condition = alltrue(flatten([
      for env in ["staging", "production"] : [
        for s in jsondecode(aws_iam_policy.apply_id[env].policy).Statement : [
          s.Resource == "arn:aws:route53:::hostedzone/Z0000000EXAMPLE",
          s.Condition["ForAllValues:StringEquals"] == { "route53:ChangeResourceRecordSetsActions" = ["CREATE", "UPSERT"], "route53:ChangeResourceRecordSetsRecordTypes" = ["A", "CNAME"] },
          length(s.Condition) == (env == "staging" ? 3 : 4) && alltrue([for v in values(s.Condition.Null) : v == "false"]) && length(s.Condition.Null) == 3,
        ] if contains(flatten([s.Action]), "route53:ChangeResourceRecordSets")
      ]
    ]))
    error_message = "ChangeResourceRecordSets vale só na zona do produto, só para criar ou sobrescrever registros A e CNAME (sem DELETE), sempre com a condição de nome e com as três chaves presentes no pedido (Null)."
  }
}

run "dominio_mais_longo_cabe_no_limite" {
  command = apply

  variables {
    zone_name = "um-dominio-de-exemplo-com-o-tamanho-maximo-aceito-pela.variavel"
  }

  assert {
    condition     = length(var.zone_name) == 63 && length(aws_iam_policy.apply_id["staging"].policy) <= 6144 && length(aws_iam_policy.apply_id["production"].policy) <= 6144
    error_message = "Com o domínio mais longo que a variável aceita (63 caracteres), a política por ID continua dentro dos 6144 caracteres."
  }
}

run "dominio_invalido_e_recusado" {
  command = plan

  variables {
    zone_name = "Example.com."
  }

  expect_failures = [var.zone_name]
}
