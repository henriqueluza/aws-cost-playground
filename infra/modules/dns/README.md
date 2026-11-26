# Módulo `dns`

Certificados TLS de um ambiente para os três nomes do ADR: `site`, `api` e `auth`.

| Ambiente | `site_domain` | Nomes |
|---|---|---|
| staging | `staging.<zona>` | `staging.<zona>`, `api.staging.<zona>`, `auth.staging.<zona>` |
| production | `<zona>` | `<zona>`, `api.<zona>`, `auth.<zona>` |

## O que cria

- 3 certificados ACM públicos, um por nome e sem SANs. Ficam sempre em `us-east-1`, a região que o CloudFront e o Cognito exigem, pelo argumento `region` do provider 6.
- Os registros CNAME de validação na zona e a espera pela emissão (`aws_acm_certificate_validation`).
- Até 3 registros alias `A`: `site` aponta para o CloudFront, `api` para o domínio customizado do API Gateway e `auth` para o domínio customizado do Cognito. Cada um só existe quando o alvo é informado, e todos usam `evaluate_target_health = false`.

## O que não cria

A zona do Route 53, que é do autor. O módulo a lê como data source (`data "aws_route53_zone"`, zona pública) e nunca a cria nem a apaga.

## Variáveis

| Nome | Tipo | Padrão | Descrição |
|---|---|---|---|
| `zone_name` | `string` | obrigatória | Zona pública existente (ex.: `example.com`). |
| `site_domain` | `string` | obrigatória | `zone_name` em production, `staging.<zone_name>` em staging. Precisa ser a zona ou um subdomínio dela. |
| `site_alias` | `object({ name = string, zone_id = string })` | `null` | Alvo do site: `domain_name` e `hosted_zone_id` do `aws_cloudfront_distribution`. `null` = sem registro. |
| `api_alias` | `object({ name = string, zone_id = string })` | `null` | Alvo da API: `target_domain_name` e `hosted_zone_id` de `aws_apigatewayv2_domain_name` (dentro de `domain_name_configuration[0]`). O módulo `http-api` já entrega esse objeto na saída `domain_alias`. `null` = sem registro. |
| `auth_alias` | `object({ name = string, zone_id = string })` | `null` | Alvo do login: `cloudfront_distribution` e `cloudfront_distribution_zone_id` de `aws_cognito_user_pool_domain`. `null` = sem registro. |

## Outputs

| Nome | Descrição |
|---|---|
| `zone_id` | Id da zona lida. |
| `domain_names` | Nomes por chave: `site`, `api` e `auth`. |
| `certificate_arns` | ARN de cada certificado já emitido, por chave. |
| `auth_domain` | Nome do login. Só é liberado depois do registro A do site: a AWS exige o domínio pai resolvendo antes de criar o domínio customizado do Cognito. |

## Exemplo (`envs/<env>/main.tf`)

```hcl
module "dns" {
  source = "../../modules/dns"

  zone_name   = "example.com"
  site_domain = "staging.example.com"

  site_alias = {
    name    = aws_cloudfront_distribution.site.domain_name
    zone_id = aws_cloudfront_distribution.site.hosted_zone_id
  }

  api_alias = {
    name    = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
    zone_id = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
  }

  auth_alias = {
    name    = aws_cognito_user_pool_domain.this.cloudfront_distribution
    zone_id = aws_cognito_user_pool_domain.this.cloudfront_distribution_zone_id
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain          = module.dns.auth_domain
  certificate_arn = module.dns.certificate_arns["auth"]
  user_pool_id    = aws_cognito_user_pool.this.id
}

# CloudFront: module.dns.certificate_arns["site"]
# API Gateway (domínio customizado): module.dns.certificate_arns["api"]
```

## Regras de uso dos alias

- São três variáveis e três blocos de recurso, não um map com `for_each`. Cada alvo é um nó próprio no grafo. Um bloco único com `for_each` fecha ciclo com o Cognito: ele consome `auth_domain` e devolve o alvo em `auth_alias`.
- O domínio do Cognito deve usar `module.dns.auth_domain`. Não monte o nome à mão, senão ele perde a espera pelo registro A do site.
- Com Cognito, passe sempre `site_alias`. Sem ele, o registro do site não existe e `auth_domain` sai sem nada para esperar; a criação do domínio do Cognito falha porque o domínio pai não resolve.
- Nunca use `depends_on = [module.dns]` no consumidor: fecha ciclo.
- Só há registro `A`. O ADR não prevê IPv6; o `AAAA` pode entrar depois sem `replace`.
- Alias para esses alvos não tem custo de consulta no Route 53.
- Os registros não têm `prevent_destroy`: não guardam dado nem identidade. Trocar o alvo é update in-place, sem `replace`.

## Observações

- Use `certificate_arns`. Os ARNs só saem depois da validação, então quem os consome espera a emissão.
- Os certificados têm `create_before_destroy`. Mesmo assim, trocar um nome aparece como `replace` no plan-guard e exige `infra:destroy-approved`. Não há `prevent_destroy`, porque o certificado não guarda dado nem identidade.
- Um registro manual com o mesmo nome do CNAME de validação faz o apply falhar. O módulo não usa `allow_overwrite`, então não sobrescreve nada da zona.
- O módulo não gera custo novo: certificado público do ACM não é cobrado. A zona é o único custo fixo, previsto no ADR e fora deste módulo.

## Validar e testar

```bash
terraform -chdir=infra/modules/dns init -backend=false
terraform -chdir=infra/modules/dns validate
terraform -chdir=infra/modules/dns test
```

`tests/dns.tftest.hcl` usa provider simulado e só faz `plan`, sem credenciais. Cobre os alias, com e sem alvo. O run `consumidor_com_cognito_sem_ciclo` planeja `tests/consumer/`, um consumidor mínimo com Cognito, e falha com `Cycle` se o módulo voltar a um `for_each` único. O `.terraform.lock.hcl` gerado no módulo não é versionado (só os das raízes são): o `.gitignore` cobre `infra/modules/**/.terraform.lock.hcl`. O CI roda `fmt`, `validate`, `terraform test`, tflint e trivy neste módulo (`infra/tools/tf_checks.sh`).
