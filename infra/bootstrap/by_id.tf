# Escrita dos papéis apply nos serviços cujo ARN é um ID gerado: CloudFront, API Gateway v2,
# Cognito, ACM e Route 53. O prefixo `acp-<prefixo>-*` não os delimita; o ambiente vem da tag
# `environment` (os roots de `infra/envs/*` a aplicam por `default_tags`) ou do nome do registro
# DNS. Só `Allow`, sem exclusão e sem ação de usuário do Cognito: as negações de `apply.tf` vencem.
variable "zone_name" {
  description = "Domínio do produto: nome da zona pública do Route 53, a mesma de TF_VAR_zone_name dos ambientes. Não fica no repositório."
  type        = string

  # A chave de condição do Route 53 compara nomes normalizados: minúsculas e sem ponto final.
  # O domínio aparece nove vezes na política de produção: o teto de tamanho a mantém em 6.144.
  validation {
    condition     = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.zone_name)) && length(var.zone_name) <= 63
    error_message = "Informe o domínio em minúsculas, sem ponto final e sem curinga, com até 63 caracteres (por exemplo, exemplo.com)."
  }
}

# A zona é criada à mão pelo autor (#74) antes do bootstrap; aqui só o ID, para o ARN exato.
data "aws_route53_zone" "product" {
  name         = var.zone_name
  private_zone = false
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  zone_arn   = "arn:aws:route53:::hostedzone/${data.aws_route53_zone.product.zone_id}"

  # Mesmos nomes de `infra/envs/<ambiente>/main.tf` e do módulo `dns`: staging vive inteiro sob
  # `staging.<domínio>`; produção usa o domínio, `api.`, `auth.` e os CNAMEs de validação do ACM.
  staging_record_names = ["staging.${var.zone_name}", "*.staging.${var.zone_name}"]
  production_names     = [var.zone_name, "api.${var.zone_name}", "auth.${var.zone_name}"]
  record_names = {
    staging    = local.staging_record_names
    production = concat(local.production_names, ["_*.${var.zone_name}"])
  }

  # Certificados só para os nomes do próprio ambiente: o ACM reaproveita o CNAME de validação,
  # e um certificado de staging para um nome de produção validaria sozinho.
  certificate_names = { staging = local.staging_record_names, production = local.production_names }

  # `ForAllValues` é verdadeiro com a chave ausente: `Null` exige que o pedido a traga.
  record_keys = [for key in ["Actions", "NormalizedRecordNames", "RecordTypes"] : "route53:ChangeResourceRecordSets${key}"]

  # ARN montado por nome, como `local.apply_named_arn`.
  apply_id_arn = { for env in keys(local.environments) : env => "${local.iam_arn}:policy/acp-ci-apply-id-${env}" }
}

# O API Gateway cria este papel na primeira API ou domínio, com a permissão de quem chama. Os
# papéis apply negam `iam:CreateServiceLinkedRole` (`DenyIamOutsideEnvironment`); ele nasce aqui.
resource "aws_iam_service_linked_role" "apigateway" {
  aws_service_name = "ops.apigateway.amazonaws.com"

  lifecycle {
    prevent_destroy = true
  }
}

# `Resource = "*"` só onde a AWS não aceita recurso (criar e listar) ou o ID é gerado; nesses, o
# ambiente vem da condição de tag. Sem tag possível: políticas e OAC do CloudFront, só criar e ler.
# `UserPoolDomainDistribution` vale em `*` por risco aceito pelo autor (#338): a distribuição do
# domínio do Cognito é da AWS, fora da conta.
#trivy:ignore:AVD-AWS-0057
resource "aws_iam_policy" "apply_id" {
  for_each = local.environments

  name        = "acp-ci-apply-id-${each.key}"
  path        = "/"
  description = "Escrita do apply de ${each.key} nos recursos com ARN por ID"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Criar exige a tag do próprio ambiente no pedido: o recurso já nasce delimitado.
        Sid       = "CreateTagged"
        Effect    = "Allow"
        Action    = ["cloudfront:CreateDistribution", "cognito-idp:CreateUserPool"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestTag/environment" = each.key } }
      },
      {
        Sid      = "CertificateRequest"
        Effect   = "Allow"
        Action   = "acm:RequestCertificate"
        Resource = "*"
        Condition = {
          StringEquals              = { "aws:RequestTag/environment" = each.key }
          "ForAllValues:StringLike" = { "acm:DomainNames" = local.certificate_names[each.key] }
          Null                      = { "acm:DomainNames" = "false" }
        }
      },
      {
        # Etiquetar nunca troca `environment`: o pedido leva o próprio ambiente, e um recurso que
        # já tem a tag só é aceito se ela for a mesma. Sem tag (recurso nascendo) também passa:
        # criar com tags chama esta ação antes de a tag existir. Sem ação de tirar etiqueta.
        Sid      = "TagOwn"
        Effect   = "Allow"
        Action   = ["acm:AddTagsToCertificate", "cloudfront:TagResource", "cognito-idp:TagResource"]
        Resource = ["arn:aws:acm:${local.region}:${local.account_id}:certificate/*", "arn:aws:cloudfront::${local.account_id}:distribution/*", "arn:aws:cognito-idp:${local.region}:${local.account_id}:userpool/*"]
        Condition = {
          StringEquals         = { "aws:RequestTag/environment" = each.key }
          StringEqualsIfExists = { "aws:ResourceTag/environment" = each.key }
        }
      },
      {
        # `CreateInvalidation` e `GetInvalidation` são do deploy.
        Sid       = "Distribution"
        Effect    = "Allow"
        Action    = ["cloudfront:CreateInvalidation", "cloudfront:GetDistribution", "cloudfront:GetInvalidation", "cloudfront:ListTagsForResource", "cloudfront:UpdateDistribution"]
        Resource  = "arn:aws:cloudfront::${local.account_id}:distribution/*"
        Condition = { StringEquals = { "aws:ResourceTag/environment" = each.key } }
      },
      {
        # O Cognito exige `cloudfront:UpdateDistribution` em `*` de quem cria o domínio próprio do
        # user pool: a distribuição é da AWS e não tem a tag. Risco aceito pelo autor (#338). Só
        # passa recurso sem a tag `environment` ou com a do próprio ambiente; a distribuição do
        # outro ambiente também cai em `DenyOtherEnvironmentDistribution` (`apply.tf`).
        Sid       = "UserPoolDomainDistribution"
        Effect    = "Allow"
        Action    = "cloudfront:UpdateDistribution"
        Resource  = "*"
        Condition = { StringEqualsIfExists = { "aws:ResourceTag/environment" = each.key } }
      },
      {
        # Políticas de cache e de cabeçalhos e o OAC não aceitam tag nem outra condição: só criar
        # (não altera o que existe) e ler. Alterar as existentes é tarefa manual do autor (#338).
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
        Resource  = "arn:aws:acm:${local.region}:${local.account_id}:certificate/*"
        Condition = { StringEquals = { "aws:ResourceTag/environment" = each.key } }
      },
      {
        # Configuração do pool, do cliente, do domínio e do branding. Nenhuma ação de usuário
        # (`deny-data`) e sem `DeleteUserPool` (`deny-guardrails`).
        Sid    = "UserPool"
        Effect = "Allow"
        Action = [
          "cognito-idp:CreateManagedLoginBranding", "cognito-idp:CreateUserPoolClient", "cognito-idp:CreateUserPoolDomain",
          "cognito-idp:DescribeManagedLoginBranding", "cognito-idp:DescribeManagedLoginBrandingByClient", "cognito-idp:DescribeUserPool",
          "cognito-idp:DescribeUserPoolClient", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:ListUserPoolClients",
          "cognito-idp:UpdateManagedLoginBranding", "cognito-idp:UpdateUserPoolClient", "cognito-idp:UpdateUserPoolDomain",
        ]
        Resource  = "arn:aws:cognito-idp:${local.region}:${local.account_id}:userpool/*"
        Condition = { StringEquals = { "aws:ResourceTag/environment" = each.key } }
      },
      {
        # `UpdateUserPool` aceita tags no pedido e trocaria `environment` sem passar por `TagOwn`.
        # O provider não as envia nessa chamada: pedido com qualquer tag é recusado.
        Sid      = "UserPoolUpdate"
        Effect   = "Allow"
        Action   = "cognito-idp:UpdateUserPool"
        Resource = "arn:aws:cognito-idp:${local.region}:${local.account_id}:userpool/*"
        Condition = {
          StringEquals = { "aws:ResourceTag/environment" = each.key }
          Null         = { "aws:TagKeys" = "true" }
        }
      },
      {
        # A ação não aceita recurso. Só lê a configuração de um domínio pelo nome.
        Sid      = "UserPoolDomainRead"
        Effect   = "Allow"
        Action   = "cognito-idp:DescribeUserPoolDomain"
        Resource = "*"
      },
      {
        Sid       = "ApiCreate"
        Effect    = "Allow"
        Action    = "apigateway:POST"
        Resource  = ["arn:aws:apigateway:${local.region}::/apis", "arn:aws:apigateway:${local.region}::/domainnames"]
        Condition = { StringEquals = { "aws:RequestTag/environment" = each.key } }
      },
      {
        # API, authorizer, integrações, rotas, stage, domínio e mapeamento. Sem `DELETE`, sem `PUT`
        # e sem `/tags/*`: a tag de uma API não pode ser condicionada à tag que ela já tem.
        Sid       = "Api"
        Effect    = "Allow"
        Action    = ["apigateway:GET", "apigateway:PATCH", "apigateway:POST"]
        Resource  = ["arn:aws:apigateway:${local.region}::/apis/*", "arn:aws:apigateway:${local.region}::/domainnames/*"]
        Condition = { StringEquals = { "aws:ResourceTag/environment" = each.key } }
      },
      {
        Sid      = "ZoneRead"
        Effect   = "Allow"
        Action   = ["route53:GetChange", "route53:GetHostedZone", "route53:ListResourceRecordSets", "route53:ListTagsForResource"]
        Resource = [local.zone_arn, "arn:aws:route53:::change/*"]
      },
      {
        # A ação não aceita recurso. Lista nome e ID das zonas da conta.
        Sid      = "ZoneList"
        Effect   = "Allow"
        Action   = "route53:ListHostedZones"
        Resource = "*"
      },
      {
        # A zona é uma só para os dois ambientes: o que separa é o nome do registro. Só criar e
        # sobrescrever (sem `DELETE`) registros A e CNAME. Produção nunca toca em `staging.`.
        Sid      = "Records"
        Effect   = "Allow"
        Action   = "route53:ChangeResourceRecordSets"
        Resource = local.zone_arn
        Condition = merge(
          {
            "ForAllValues:StringEquals" = {
              "route53:ChangeResourceRecordSetsActions"     = ["CREATE", "UPSERT"]
              "route53:ChangeResourceRecordSetsRecordTypes" = ["A", "CNAME"]
            }
            "ForAllValues:StringLike" = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = local.record_names[each.key] }
            Null                      = { for key in local.record_keys : key => "false" }
          },
          {
            for operator, names in { "ForAllValues:StringNotLike" = local.staging_record_names } :
            operator => { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = names } if each.key != "staging"
          },
        )
      },
    ]
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Anexo feito pelo bootstrap: o papel apply nega a si mesmo anexar e desanexar política.
resource "aws_iam_role_policy_attachment" "apply_id" {
  for_each = local.environments

  role       = aws_iam_role.apply[each.key].name
  policy_arn = local.apply_id_arn[each.key]

  depends_on = [aws_iam_policy.apply_id]
}
