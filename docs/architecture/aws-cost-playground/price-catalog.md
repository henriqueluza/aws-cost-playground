# Contrato do catálogo de preços

O catálogo é o conjunto de arquivos JSON de preço que o frontend baixa de `public/prices/` e entrega ao motor. O pipeline `pricing/` (script Python sobre a Price List API) deve gerar exatamente este formato; quem mudar um dos lados muda o outro junto.

- **Origem:** [ADR-0001](ADR-0001-stack.md). Este documento só detalha o formato e a validação.
- **Onde mora:** `web/src/features/pricing/model/catalog.ts` (schemas zod `priceFileSchema` e `priceManifestSchema`, `CATALOG_LIMITS` e os tipos `Price`, `PriceTier`, `PriceFile`, `PriceManifest`, `PriceSource` e `PriceCatalog`). Importe pelo `index.ts` da feature. Se este texto e o código divergirem, vale o código.
- **Fora deste contrato:** a carga por HTTP, a conferência do `sha256` e o motor de cálculo.

## Arquivo de preço

Um arquivo por serviço e região, em `public/prices/<region>/<service>.json`.

```json
{
  "schemaVersion": 1,
  "service": "lambda",
  "region": "us-east-1",
  "currency": "USD",
  "prices": [
    {
      "sku": "lambda-requests",
      "description": "Requisições",
      "unit": "request",
      "tiers": [{ "upTo": null, "unitPrice": "0.0000002" }],
      "freeTier": { "quantity": "1000000", "pool": "lambda-requests" }
    },
    {
      "sku": "lambda-duration-x86",
      "description": "Duração (x86)",
      "unit": "GB-second",
      "tiers": [
        { "upTo": "6000000000", "unitPrice": "0.0000166667" },
        { "upTo": null, "unitPrice": "0.0000150000" }
      ],
      "minimumQuantity": "0.001"
    }
  ]
}
```

| Campo                  | Regra                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `schemaVersion`        | `1`                                                                                                   |
| `service`              | Slug `^[a-z][a-z0-9-]{0,39}$`, pois vira nome de arquivo                                              |
| `region`               | `us-east-1` ou `sa-east-1`                                                                            |
| `currency`             | `USD`                                                                                                 |
| `prices[].sku`         | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`; único no arquivo                                                |
| `prices[].description` | Até `maxDescriptionLength` caracteres                                                                 |
| `prices[].unit`        | De 1 até `maxUnitLength` caracteres                                                                   |
| `prices[].tiers`       | De 1 a `maxTiersPerPrice` faixas (abaixo)                                                             |
| `freeTier`             | Opcional. `quantity` decimal por mês; `pool` (slug, opcional) junta SKUs que dividem a mesma franquia |
| `minimumQuantity`      | Opcional. Quantidade mínima cobrada                                                                   |

## Manifest

`public/prices/manifest.json` diz de onde vieram os preços, quando, e o hash de cada arquivo.

```json
{
  "schemaVersion": 1,
  "source": "price-list",
  "generatedAt": "2026-11-23T12:00:00Z",
  "files": [
    {
      "path": "us-east-1/lambda.json",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
```

| Campo            | Regra                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `schemaVersion`  | `1`                                                                                     |
| `source`         | `seed` (valores escritos à mão no repositório) ou `price-list` (gerado pelo `pricing/`) |
| `generatedAt`    | ISO 8601 em UTC, com sufixo `Z`                                                         |
| `files[].path`   | `<region>/<service>.json`, relativo a `public/prices/`; único na lista                  |
| `files[].sha256` | 64 caracteres hexadecimais minúsculos                                                   |

## Regras de validação

- **Decimais:** preço e quantidade são string decimal sem sinal nem expoente, com até 15 dígitos inteiros e 12 casas (`^\d{1,15}(\.\d{1,12})?$`). Valor fora do formato é recusado, nunca arredondado. Por isso o valor vai como string no JSON, sem perder precisão.
- **Faixas:** `upTo` é o limite superior cumulativo e deve ser estritamente crescente, a partir de zero. A última faixa tem `upTo: null` e só ela pode tê-lo; `null` fora da última, ou última com número, é recusado.
- **Unicidade:** SKUs únicos dentro do arquivo; caminhos únicos em `files`.
- **Limites** (`CATALOG_LIMITS`): 200 preços por arquivo, 16 faixas por preço, 100 arquivos no manifest, 200 caracteres de `description`, 40 de `unit`.
- **Leitura tolerante:** chave desconhecida, em qualquer nível, é descartada, não recusada (mesma regra do [documento do design](design-document.md)).
- **`Decimal`:** só existe no tipo de saída do schema (`Decimal` de `shared/lib/money`, `bigint` escalado). Nunca vai para JSON, estado persistido nem query key do TanStack Query; use `toFixed`.

## Fora do escopo

- Baixar os arquivos, conferir o `sha256` contra o manifest e tratar falhas de rede: Issue própria, fora da #99.
- Calcular custo com o catálogo (`PriceCatalog` é só o que o motor recebe).
- Gerar os arquivos: `pricing/` deve emitir este formato e o hash de cada arquivo no manifest.
