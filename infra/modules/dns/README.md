# Módulo `dns`

Certificados TLS de um ambiente para os três nomes do ADR: `site`, `api` e `auth`.

| Ambiente | `site_domain` | Nomes |
|---|---|---|
| staging | `staging.<zona>` | `staging.<zona>`, `api.staging.<zona>`, `auth.staging.<zona>` |
| production | `<zona>` | `<zona>`, `api.<zona>`, `auth.<zona>` |

## O que cria

- 3 certificados ACM públicos, um por nome e sem SANs. Ficam sempre em `us-east-1`, a região que o CloudFront e o Cognito exigem, pelo argumento `region` do provider 6.
- Os registros CNAME de validação na zona e a espera pela emissão (`aws_acm_certificate_validation`).

Os registros de alias para CloudFront, API Gateway e Cognito chegam na #121.

## O que não cria

A zona do Route 53, que é do autor. O módulo a lê como data source (`data "aws_route53_zone"`, zona pública) e nunca a cria nem a apaga.

## Variáveis

| Nome | Tipo | Descrição |
|---|---|---|
| `zone_name` | `string` | Zona pública existente (ex.: `example.com`). |
| `site_domain` | `string` | `zone_name` em production, `staging.<zone_name>` em staging. Precisa ser a zona ou um subdomínio dela. |

## Outputs

| Nome | Descrição |
|---|---|
| `zone_id` | Id da zona lida. |
| `domain_names` | Nomes por chave: `site`, `api` e `auth`. |
| `certificate_arns` | ARN de cada certificado já emitido, por chave. |

## Exemplo (`envs/<env>/main.tf`)

```hcl
module "dns" {
  source = "../../modules/dns"

  zone_name   = "example.com"
  site_domain = "staging.example.com"
}

# CloudFront: module.dns.certificate_arns["site"]
# API Gateway (domínio customizado): module.dns.certificate_arns["api"]
# Cognito (domínio customizado): module.dns.certificate_arns["auth"]
```

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

`tests/dns.tftest.hcl` usa provider simulado e só faz `plan`, sem credenciais. O `.terraform.lock.hcl` gerado no módulo não é versionado. O CI roda tflint e trivy em todo `infra/`, mas `validate` só nos ambientes, e não roda `terraform test`.
