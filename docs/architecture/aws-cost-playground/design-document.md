# Contrato do documento do design

O documento do design é o JSON que o anônimo baixa e o logado salva. A API (#10, Pydantic) e o frontend validam o mesmo contrato. Quem mudar um dos lados muda o outro junto. Os modelos da API estão em `api/app/design_document.py`; os dois lados leem os exemplos de `contracts/examples/design/` e precisam dar o mesmo veredito.

- **Origem:** [ADR-0001, "Modelo de dados"](ADR-0001-stack.md#modelo-de-dados). O formato e o exemplo são os do ADR, e este documento só detalha a validação.
- **Onde mora:** `web/src/shared/lib/design/` (schema zod, tipos, `DESIGN_LIMITS` e `effectiveUsage`). Importe pelo `index.ts`. Se este texto e o código divergirem, vale o código.

## Regras

| Campo                                                | Regra                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chave desconhecida, em qualquer nível                | Descartada, não recusada (leitura tolerante; ver "Rollback" em [ADR-0001, "Hospedagem e ambientes"](ADR-0001-stack.md#hospedagem-e-ambientes)). No Pydantic, `extra="ignore"`.                                                 |
| `schemaVersion`                                      | `1`                                                                                                                                                                                                                            |
| `region`                                             | `us-east-1` ou `sa-east-1`                                                                                                                                                                                                     |
| `blocks[].id` / `edges[].id`                         | `blk_` / `edg_` seguido de 1 a 60 caracteres `[A-Za-z0-9_-]`                                                                                                                                                                   |
| `blocks[].type`                                      | Regex `^aws\.[a-z0-9-]{1,40}$`. A lista fechada de tipos fica em `features/pricing/model`.                                                                                                                                     |
| `blocks[].label`                                     | String de até 80 caracteres; pode ser vazia                                                                                                                                                                                    |
| Chaves de `attributes`, `usage.values` e `overrides` | camelCase até 40 caracteres: `^[a-z][A-Za-z0-9]{0,39}$`. Propriedades de `Object.prototype` são recusadas (`constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString`, `valueOf`). |
| Valores de `attributes`                              | String de até 64 caracteres, número finito ou booleano                                                                                                                                                                         |
| Valores de `usage.values` e `overrides`              | Número finito de 0 a `DESIGN_LIMITS.maxUsageValue` (1e12). As faixas por tipo de bloco ficam em [block-contract.md](block-contract.md).                                                                                                        |
| `usage.source`                                       | `llm` ou `default`                                                                                                                                                                                                             |
| `usage.estimatedAt`                                  | Opcional. ISO 8601 em UTC, com sufixo `Z`; outro fuso é recusado.                                                                                                                                                              |
| `edges[].kind`                                       | `data`, `runs-on` ou `logs`                                                                                                                                                                                                    |
| `edges[].target`                                     | Id de bloco existente ou `client`. Destino `client` só com `kind: "data"`.                                                                                                                                                     |
| `scenarios`                                          | Só `[]`                                                                                                                                                                                                                        |

**Integridade:** ids de bloco únicos e ids de aresta únicos. `source` é sempre um bloco existente (nunca `client`); `target` é um bloco existente ou `client`. Ciclos entre blocos são permitidos; uma aresta de um bloco para ele mesmo (auto-laço) é recusada.

**Limites:** 100 blocos, 400 arestas, `workload.description` até 2.000 caracteres, `label` até 80, string de atributo até 64, até 32 chaves em cada `attributes`, `usage.values` e `overrides`.

## Evolução

- `schemaVersion` muda quando o formato muda de modo incompatível.
- `scenarios` ganha conteúdo na release 3. Publique primeiro um leitor que o aceite e só depois a escrita: o build anterior recusa `scenarios` não vazio, e descartar o conteúdo em silêncio perderia dado.
- Não mostre crua na UI a mensagem de erro do schema: a chave recusada aparece no `path`. A #50 mostra mensagem própria.
- O limite de tamanho `maxDocBytes` (350 KB, o mesmo da API) entra com a #50.
