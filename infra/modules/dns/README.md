# Módulo `dns`

Certificados e registros DNS de um ambiente (`site`, `api` e `auth`).

## O que cria

- 3 certificados ACM públicos em `us-east-1` (um por nome, sem SANs), com validação por DNS.
- Os registros CNAME de validação e a espera pela emissão (`aws_acm_certificate_validation`).
- Até 3 registros alias `A` (site, API e login), cada um só quando o alvo é informado.

## O que não cria

A zona do Route 53. Ela é lida como data source (`data "aws_route53_zone"`) e nunca é criada nem apagada pelo módulo.

## Variáveis

| Nome | Tipo | Padrão | Descrição |
|---|---|---|---|
| `zone_name` | `string` | obrigatória | Zona pública existente (ex.: `example.com`). |
| `site_domain` | `string` | obrigatória | `zone_name` em production, `staging.<zone_name>` em staging. Deve ser a zona ou subdomínio dela. |
| `site_alias` | `object({ name, zone_id })` | `null` | Alvo do site. `null` = sem registro. |
| `api_alias` | `object({ name, zone_id })` | `null` | Alvo da API. `null` = sem registro. |
| `auth_alias` | `object({ name, zone_id })` | `null` | Alvo do login. `null` = sem registro. |

## Outputs

| Nome | Descrição |
|---|---|
| `zone_id` | Id da zona lida. |
| `domain_names` | Nomes por chave: `site`, `api`, `auth`. |
| `certificate_arns` | ARN de cada certificado já validado, por chave. |
| `auth_domain` | Nome do login, liberado só depois do A do site (domínio pai). |

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
```

## Regras de uso

- Consuma `certificate_arns`: os ARNs só saem depois da validação.
- O domínio do Cognito usa `module.dns.auth_domain`, que espera o A do site (domínio pai).
- Nunca use `depends_on = [module.dns]`: fecha ciclo.
- O alvo de um alias vem só de recurso do mesmo estado.

## Observações

- `create_before_destroy` nos certificados ainda aparece como `replace` no plan-guard e exige `infra:destroy-approved`.
- Registro manual com o mesmo nome faz o apply falhar (o módulo não usa `allow_overwrite`).
- Só registros `A`; o ADR não prevê IPv6. O `AAAA` pode entrar depois sem replace.
- Custo zero: ACM público e consultas a alias são gratuitos. A zona é custo fixo fora deste módulo.

## Validar e testar

```bash
terraform -chdir=infra/modules/dns init -backend=false
terraform -chdir=infra/modules/dns validate
terraform -chdir=infra/modules/dns test
```

O teste fica em `tests/dns.tftest.hcl`. O `.terraform.lock.hcl` gerado no módulo não é versionado.
