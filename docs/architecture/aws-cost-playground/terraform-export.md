# Export para Terraform

O export transforma o design num arquivo Terraform (HCL). Este documento descreve o construtor de HCL e os nomes de recurso (Issue #64) e fixa as regras que os geradores de bloco (#65, #66 e #67) seguem.

- **Origem:** [ADR-0001](ADR-0001-stack.md) e o PRD (F27). Formato do design em [design-document.md](design-document.md); contrato dos blocos em [block-contract.md](block-contract.md).
- **Onde mora:** `web/src/features/export/model/hcl.ts` (construtor e `renderHcl`) e `model/names.ts` (nomes). Se este texto e o código divergirem, vale o código.

## O que é e o que não é

- É um export gerado no navegador, sem LLM e sem rede, a partir do design já validado.
- É um ponto de partida, sem garantia. O arquivo precisa de revisão antes de aplicar em qualquer conta.
- Preço e `Decimal` não fazem parte do export: o arquivo descreve recursos, não custo.
- A saída é uma lista `{ path, content }`. O `path` vem de uma lista fixa; hoje só `main.tf`, como pede a #64. Nenhum caminho sai de dado do usuário.
- Baixar os arquivos é outra camada (#268); o export só devolve texto.

## Modelo de ameaça

O export é geração de código a partir de dado do usuário: rótulo do bloco, atributos e uso. A ameaça central é injeção em HCL, por exemplo um rótulo que fecha o literal, abre um recurso novo ou escreve uma interpolação (`${...}`).

Regra: **nenhum texto chega a um `.tf` fora do construtor `hcl`.** Os geradores montam nós e nunca concatenam texto.

## O construtor

Cada função devolve um nó; `renderHcl(nodes)` produz o arquivo (determinístico, `\n` no fim, no formato do `terraform fmt`).

| Função                       | Aceita                                                       | Recusa com `HclError`                                                                       |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `hcl.string(texto)`          | Qualquer texto; sai como literal escapado                    | Nada                                                                                        |
| `hcl.number(n)`              | Número finito                                                | `NaN`, infinito e módulo de 1e15 ou mais com fração                                         |
| `hcl.bool(b)`                | Booleano                                                     | Nada                                                                                        |
| `hcl.list(valores)`          | Lista de valores, numa linha                                 | O que os itens recusarem                                                                    |
| `hcl.map(objeto)`            | Objeto `{ "chave" = valor }`; chave sempre entre aspas       | O que os valores recusarem                                                                  |
| `hcl.ref(...partes)`         | Primeira parte e demais partes de texto são identificadores; parte numérica é índice | Identificador fora de `[A-Za-z_][A-Za-z0-9_]{0,63}`; índice que não seja inteiro seguro não negativo; referência sem identificador inicial |
| `hcl.attr(nome, valor)`      | `nome` identificador                                         | Nome fora do padrão de identificador                                                        |
| `hcl.block(tipo, rótulos, corpo)` | `tipo` e cada rótulo identificadores (rótulo sai entre aspas) | Tipo ou rótulo fora do padrão de identificador                                         |
| `hcl.comment(texto)`         | Qualquer texto                                               | Nada (o texto é neutralizado)                                                               |

Os erros são lançados em `renderHcl`, não na criação do nó.

## Escape e formatação

- **String (`quoteHclString`):** barra invertida e aspas recebem barra; `\n`, `\r` e `\t` viram as formas curtas; `${` vira `$${` e `%{` vira `%%{`. Caracteres de controle e de formato (categorias Unicode Cc, Cf, Zl e Zp, o que inclui marcadores bidi e largura zero) viram `\uNNNN` ou `\UNNNNNNNN`. Surrogate solto vira U+FFFD. O resto do Unicode sai como está (o arquivo é UTF-8).
- **Chave de mapa:** sempre literal entre aspas, com as mesmas regras da string.
- **Comentário:** sempre `#` de uma linha. Controle e formato viram espaço e o fim de comentário de bloco (`*/`) é quebrado, então o texto não escapa da linha.
- **Número:** sem notação exponencial. Inteiro seguro sai como está; fração sai com até 6 casas. Módulo a partir de 1e15 com fração é recusado.

## Nomes de recurso

`terraformName(texto, fallback)` e `uniqueNames(itens)` geram o rótulo do recurso a partir do rótulo do bloco.

- Só `[a-z0-9_]`, começando por letra: nome que começa por dígito ganha o prefixo `r_`.
- Acento é reduzido à letra base (NFKD); qualquer outra sequência vira um `_`.
- No máximo 48 caracteres, já com o sufixo de colisão. Só os primeiros 256 caracteres do texto são lidos.
- Fallback quando o texto não deixa letra nem dígito: o tipo do bloco sem `aws.`, depois `bloco`.
- Colisão resolvida por sufixo `_2`, `_3`... na ordem recebida. `buildExportModel` ordena os blocos por id, então o mesmo design dá sempre os mesmos nomes.

## Registro de geradores e `exportDesign`

Sobre o construtor (#267):

- **`BlockGenerator`** (`model/generator.ts`): função pura `(GeneratorInput) => GeneratorOutput`, um arquivo por tipo de bloco em `model/generators/`, registrada em `BLOCK_GENERATORS` (`Record<BlockType, BlockGenerator>`: o compilador recusa um bloco do PRD sem entrada).
  - Entrada: `block` (`id`, `type`, `name`, `label`, `attributes`, `usage`), `links` (arestas que tocam o bloco, na ordem do id da aresta: `kind`, `role` `source` ou `target`, e `peer`, que é `undefined` quando o outro lado é a internet), `blocks` (todos os blocos conferidos, para o que é gerado uma vez por design, como rede e AZs) e `region`.
  - Saída: `nodes` (nós do construtor) e `exported`. `exported: false` põe o bloco na lista de não exportados do cabeçalho.
- **Gerador provisório** (`generators/provisional.ts`): devolve o comentário "Não suportado ainda" e `exported: false`. `PROVISIONAL_BLOCK_TYPES` lista os tipos que ainda estão nele; o teste `registry.test.ts` tem a lista escrita à mão, e cada gerador real (#65, #66, #67) tira o seu tipo dela.
- **`buildExportModel`** (`model/exportBlocks.ts`): lê o design pelo contrato dos blocos. Atributos: só as chaves do contrato, cada uma com uma das opções aceitas (ausente recebe o padrão); valor fora das opções recusa o bloco (`invalid-attribute`), tipo fora do contrato também (`unknown-type`). Uso: o efetivo (override vence), só com as chaves do contrato, limitado à faixa. Blocos ordenados por id; nomes por `uniqueNames`. Aresta para bloco recusado não vira ligação.
- **`exportDesign(input)`** (`application/exportDesign.ts`): valida o documento de novo (`designDocumentSchema`) e devolve `{ ok: true, files }` ou `{ ok: false, error: 'invalid-design' }`. O `main.tf` traz, nesta ordem: o aviso fixo (ponto de partida sem garantia, custos são estimativa, sem credenciais), a contagem de blocos exportados com a lista dos não exportados e o motivo, o bloco `terraform` com as versões fixadas, a variável `aws_region`, o `provider "aws"` com `default_tags`, e uma seção por bloco aberta por um comentário com tipo, rótulo e nome de recurso.

Nenhum bloco some: sem gerador real, de tipo desconhecido ou com atributo fora do contrato, ele aparece como comentário e na lista do cabeçalho.

## Convenções para os geradores (#65, #66 e #67)

Regras normativas; o revisor recusa o que fugir delas.

1. O gerador só devolve nós do construtor. Texto do usuário entra apenas por `hcl.string` ou `hcl.comment`. `hcl.ref` nunca recebe texto do usuário, exceto `block.name`. Se faltar algo ao construtor (por exemplo chamada de função), a mudança é no construtor, com teste; nunca texto cru.
2. O recurso principal do bloco leva `block.name` como rótulo. As chaves de `hcl.map` são constantes do gerador: não monte o objeto com chave vinda do design (`__proto__` perde o valor e chave numérica muda de ordem).
3. Nenhum segredo no arquivo: nada de senha, chave ou token em literal nem em `default` de variável. Onde o recurso exige senha (RDS), use `manage_master_user_password = true` ou variável com `sensitive = true` e sem `default`. Segredo do Secrets Manager é criado sem valor.
4. Seguro por padrão:
   - nada de `0.0.0.0/0` em regra de entrada de banco, cache ou administração;
   - bucket privado, com bloqueio de acesso público e criptografia;
   - criptografia em repouso ligada;
   - HTTPS obrigatório;
   - banco sem acesso público;
   - IAM sem `*` em ação e recurso.
5. Versões fixadas iguais às de `infra/`: Terraform `~> 1.16.0` e provider AWS `~> 6.73`. A região vem da variável `aws_region`, com o padrão tirado do design, e o provider leva `default_tags`.
6. Saída determinística: nada de data, valor aleatório ou ordem de inserção de `Map` vinda do usuário.

## Como conferir

- **Testes do vitest** (`hcl.test.ts`, `names.test.ts`): rodam no `npm test` e no CI. Incluem a bateria de cargas de injeção (`test/injectionPayloads.ts`) em valor, chave, comentário e nome.
- **Conferência local, opcional**, em `web/`:

  ```bash
  EXPORT_TERRAFORM_CHECK=1 npx vitest run src/features/export/test/terraform.local.test.ts
  ```

  Roda o formatador e a validação do Terraform num diretório temporário, com só `locals` e `output` (sem provider nem credencial), e compara o valor que o Terraform lê de volta com o original. Não entra no `npm test` nem no CI.
- **Export inteiro:** a validação nos 3 cenários, com o provider da AWS, é o job da #68.
