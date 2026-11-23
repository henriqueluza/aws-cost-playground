# Módulo `site`

Hospedagem da SPA: bucket S3 privado atrás de uma distribuição CloudFront. Os ambientes `staging` e `production` passam a chamá-lo na Issue #21. O certificado ACM vem do módulo `dns` (Issue #15).

## O que cria

- **Bucket S3 privado**: acesso só pela distribuição via OAC (SigV4), public access block total, `BucketOwnerEnforced`, versionamento, SSE-S3, política que nega tráfego sem TLS e `prevent_destroy`.
- **Distribuição CloudFront**: HTTPS obrigatório (`redirect-to-https`), TLS `TLSv1.2_2021` com SNI, `http2and3`, IPv6, `PriceClass_100`, só `GET`/`HEAD`.
- **Fallback da SPA**: `custom_error_response` 403 e 404 para `/index.html` com status 200 (o bucket privado devolve 403 para chave inexistente).
- **Duas response headers policies** (`default` e `assets`), ambas com CSP, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` e `Cache-Control` (ver Cache).

## Entradas

| Nome | Tipo | Obrigatória | Descrição e validação |
|---|---|---|---|
| `name_prefix` | `string` | sim | Prefixo do ambiente; nomeia OAC e políticas. Aceita só `acp-stg` ou `acp-prod`. |
| `bucket_name` | `string` | sim | Nome do bucket (global na AWS). 3 a 63 caracteres, minúsculas, números e hífen, sem hífen nas pontas. |
| `aliases` | `list(string)` | sim | Domínios da distribuição. Ao menos um, minúsculas, sem esquema, porta nem curinga; devem constar no certificado. |
| `acm_certificate_arn` | `string` | sim | Certificado ACM em `us-east-1` que cobre os `aliases`. |
| `connect_src_origins` | `list(string)` | sim | Origens liberadas no `connect-src` da CSP. Só `https://<host>`, sem caminho, porta, curinga, espaço nem barra final. |

## Saídas

| Nome | Descrição |
|---|---|
| `bucket_name` | Nome do bucket (destino do deploy do bundle e do `/config.json`). |
| `distribution_id` | Id da distribuição (invalidação de cache no deploy). |
| `distribution_domain_name` | Domínio `*.cloudfront.net`, alvo do alias no módulo `dns`. |
| `distribution_hosted_zone_id` | Zona hospedada do CloudFront, usada no alias do Route 53. |

## Exemplo mínimo

Valores fictícios.

```hcl
module "site" {
  source = "../../modules/site"

  name_prefix         = "acp-stg"
  bucket_name         = "acp-stg-site-exemplo"
  aliases             = ["staging.exemplo.com"]
  acm_certificate_arn = module.dns.certificate_arn # saída do módulo dns (Issue #15); nome a confirmar

  connect_src_origins = [
    "https://api.staging.exemplo.com",
    "https://auth.staging.exemplo.com",
    "https://cognito-idp.us-east-1.amazonaws.com",
  ]
}
```

## Cache

| Caminho | Borda (CloudFront) | Navegador (`Cache-Control`) |
|---|---|---|
| `/assets/*` | `Managed-CachingOptimized` | `public, max-age=31536000, immutable` |
| Todo o resto, inclusive `index.html`, `/config.json` e `/prices/**` | política `short`: TTL mínimo 0, padrão 60, máximo 300 s | `no-cache` |

Regras para o deploy:

1. Subir `assets/` antes do `index.html`.
2. Não apagar assets antigos no mesmo deploy (quem ainda tem o `index.html` antigo em cache precisa deles).
3. Após publicar, invalidar só `/index.html` e `/config.json` (os arquivos sem hash).

Por quê: um asset inexistente em `/assets/*` cai no fallback e devolve o HTML do `index.html` com status 200. Na borda o erro não fica em cache (`error_caching_min_ttl = 0`), mas, se a resposta levar a política de cabeçalhos de `/assets/*`, o navegador guarda esse HTML por 1 ano. Conferir em staging (#21).

## CSP aplicada

Montada em `headers.tf`:

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' <connect_src_origins>; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
```

Se a SPA precisar de outra origem, altere só `connect_src_origins` (a validação impede curinga, caminho e injeção de diretivas).

`style-src 'self'` não tem `unsafe-inline`. Se o React Flow ou outra lib injetar `<style>`, o ajuste mínimo é um `style-src-attr` ou `style-src-elem` específico, decidido em PR próprio.

## Decisões e riscos aceitos

- **Sem WAF**: tem custo fixo; risco aceito pelo autor no ADR (`#trivy:ignore:AVD-AWS-0011`).
- **SSE-S3 em vez de KMS CMK**: a chave custa US$ 1/mês fixo (`#trivy:ignore:AVD-AWS-0132`).
- **Sem logging** do CloudFront e do S3: achados MEDIUM/LOW do trivy, que não reprovam.
- **HSTS** sem `includeSubDomains` e sem `preload` até o domínio ser definido.
- **Lifecycle do bucket** (versões antigas, multipart incompleto): o autor configura à mão, conforme o ADR, pelo runbook `docs/runbooks/guardrails-de-custo.md`.
- **Sem `s3:ListBucket`** para o OAC: objeto ausente dá 403, coberto pelo fallback.

## Validação local

```bash
terraform -chdir=infra/modules/site init -backend=false \
  && terraform -chdir=infra/modules/site validate \
  && terraform -chdir=infra/modules/site test
```

`tflint` e `trivy` rodam como descrito em `infra/README.md`. O `terraform test` usa `mock_provider` e não toca a AWS. O workflow `terraform.yml` ainda não roda `terraform test` nem valida módulos isolados (só os ambientes).
