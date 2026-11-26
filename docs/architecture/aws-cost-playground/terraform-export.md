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
| `hcl.call(nome, args)`       | `nome` de uma lista fechada (`HCL_FUNCTIONS`, hoje só `format`); argumentos são valores do construtor | Função fora da lista (erro em `renderHcl`) e o que os argumentos recusarem |
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
  - Entrada: `block` (`id`, `type`, `name`, `label`, `attributes`, `usage`), `links` (arestas que tocam o bloco, na ordem do id da aresta: `kind`, `role` `source` ou `target`, e `peer`, que é `undefined` quando o outro lado é a internet), `designLinks` (as arestas de todos os blocos, por id do bloco, para o que é gerado uma vez por design enxergar quem fala com quem), `blocks` (todos os blocos conferidos, para o que é gerado uma vez por design, como rede e AZs) e `region`.
  - Saída: `nodes` (nós do construtor) e `exported`. `exported: false` põe o bloco na lista de não exportados do cabeçalho.
- **Gerador provisório** (`generators/provisional.ts`): devolve o comentário "Não suportado ainda" e `exported: false`. `PROVISIONAL_BLOCK_TYPES` lista os tipos que ainda estão nele; o teste `registry.test.ts` tem a lista escrita à mão, e cada gerador real (#65, #66, #67) tira o seu tipo dela.
- **`buildExportModel`** (`model/exportBlocks.ts`): lê o design pelo contrato dos blocos. Atributos: só as chaves do contrato, cada uma com uma das opções aceitas (ausente recebe o padrão); valor fora das opções recusa o bloco (`invalid-attribute`), tipo fora do contrato também (`unknown-type`). Uso: o efetivo (override vence), só com as chaves do contrato, limitado à faixa. Blocos ordenados por id; nomes por `uniqueNames`. Aresta para bloco recusado não vira ligação.
- **`exportDesign(input)`** (`application/exportDesign.ts`): valida o documento de novo (`designDocumentSchema`) e devolve `{ ok: true, files }` ou `{ ok: false, error }`. Os erros são dois: `invalid-design` (o documento não passa no schema) e `generation-failed` (um gerador devolveu um nó que o construtor recusa, ou lançou). A falha é fechada: nos dois casos não sai arquivo nenhum, nem parcial, e a mensagem da exceção não é repassada. Quem chama (o painel da #268) mostra um erro e não baixa nada. O `main.tf` traz, nesta ordem: o aviso fixo (ponto de partida sem garantia, custos são estimativa, sem credenciais), a contagem de blocos exportados com a lista dos não exportados e o motivo, o bloco `terraform` com as versões fixadas, a variável `aws_region`, o `provider "aws"` com `default_tags`, e uma seção por bloco aberta por um comentário com tipo, rótulo e nome de recurso.
- **Apoio comum** (`model/generators/`): `policyDocument.ts` tem `policyDocument`, `policyJson` e `denyInsecureTransport`, que escrevem a política de IAM como `data "aws_iam_policy_document"`, sem JSON à mão nem `jsonencode`. `links.ts` tem `dataPeers`: os pares ligados por aresta de dados, sem repetição e na ordem das arestas. O apoio de teste destes geradores está em `test/generatorHarness.ts`, sobre o `generatorKit.ts`: leitura estrutural de blocos repetidos (declarações de política, origens) e a bateria dos dois cenários de referência.
- **Rótulo derivado:** recurso extra do mesmo tipo usa `<nome>__<sufixo>` (por exemplo `api__assume`, `api__package`, `worker__sqs_1`). `terraformName` nunca produz `__`, então o rótulo não colide com nome de bloco.

Nenhum bloco some: sem gerador real, de tipo desconhecido ou com atributo fora do contrato, ele aparece como comentário e na lista do cabeçalho.

## Rede compartilhada (#66)

`model/generators/network.ts` emite VPC, sub-redes, rotas e security groups uma vez por design.

- **Mecanismo:** cada gerador de bloco em VPC devolve `withNetwork(input, nodes)`. A rede entra só na saída do primeiro bloco, na ordem do id, cujo tipo está em `NETWORK_OWNERS` (hoje `aws.ec2`); os demais só a referenciam. Os nomes são fixos (`aws_vpc.main`, `aws_subnet.public_a`, `aws_security_group.app` etc.), então a referência não depende de quem emitiu. `NETWORK_OWNERS` cresce a cada gerador em VPC entregue.
- **Zonas:** o atributo `az` do bloco (EC2, RDS, ElastiCache); sem ele, `a`. O design usa as zonas dos blocos, completadas até duas (ALB e grupos de sub-redes do RDS e do ElastiCache exigem pelo menos duas). O nome da zona sai de `format("%s%s", var.aws_region, "a")`, via `hcl.call`.
- **CIDRs:** VPC `10.0.0.0/16`; sub-rede pública `10.0.<n>.0/24` e privada `10.0.<10+n>.0/24`, com `n` = 0, 1, 2 para as zonas a, b, c. Sub-redes não dão IP público no lançamento. Há uma tabela de rotas pública (rota `0.0.0.0/0` no internet gateway) e uma privada por zona, sem rota de saída: sem bloco de NAT Gateway, as sub-redes privadas não saem para a internet. O security group padrão da VPC fica sem regras.
- **Security groups:** um por papel (`alb`, `app`, `db`, `cache`), só para os papéis presentes no design. Regras são recursos `aws_vpc_security_group_{ingress,egress}_rule`, sempre TCP numa porta. Os pares `alb-app`, `app-db` e `app-cache` só abrem se houver aresta `data` entre blocos desses papéis. Só quando o design não tem nenhuma aresta `data` entre blocos com papel vale a cadeia inteira. Outro par nunca é aberto: uma aresta do ALB direto para o banco não cria regra. As descrições de grupo e de regra são só ASCII, porque a API do EC2 recusa acento.

| Regra | Origem ou destino | Porta |
| --- | --- | --- |
| Entrada no `alb` | `0.0.0.0/0` (as únicas de entrada abertas à internet) | 443 e 80 (a 80 só redireciona) |
| Saída do `alb` e entrada no `app` | um do outro | 80 |
| Saída do `app` | `0.0.0.0/0` | 443 |
| Entrada no `db` e saída do `app` | um do outro | 5432 (postgres) ou 3306 (mysql), conforme os motores do design |
| Entrada no `cache` e saída do `app` | um do outro | 6379 (redis) ou 11211 (memcached), conforme os motores do design |

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
- **Com o provider da AWS, opcional:** `EXPORT_TERRAFORM_AWS=1` junto de `EXPORT_TERRAFORM_CHECK=1` também exporta os 3 cenários de `contracts/scenarios/`, um design só com os blocos sem VPC e dois cenários com cargas de injeção nos rótulos, e roda `fmt -check`, `init -backend=false` e `validate` em cada um. Baixa o provider; não precisa de credencial.

  ```bash
  EXPORT_TERRAFORM_CHECK=1 EXPORT_TERRAFORM_AWS=1 npx vitest run src/features/export/test/terraform.local.test.ts
  ```

- **Export inteiro:** a validação nos 3 cenários, com o provider da AWS, é o job da #68.

## Blocos sem VPC: Lambda, SQS e DynamoDB (#65)

Geradores em `model/generators/lambda.ts`, `sqs.ts` e `dynamodb.ts`.

### Lambda

- **Recursos:** `aws_lambda_function`, `aws_iam_role` (rótulo do papel de assunção em `<nome>__assume`), `aws_iam_role_policy`, `aws_cloudwatch_log_group`, a variável `<nome>__package` e um `aws_lambda_event_source_mapping` (`<nome>__sqs_N`) por fila que aponta para a função.
- **Do design:** `architecture`, `memoryMb` e o tempo limite: `timeout` = 3 × `avgDurationMs`, arredondado para cima em segundos, entre 3 s e 900 s.
- **Padrões seguros:** papel de menor privilégio (só `logs:CreateLogStream` e `logs:PutLogEvents` no grupo de logs, mais o que as arestas pedem), grupo de logs com retenção de 30 dias e nenhuma variável de ambiente.

### SQS

- **Recursos:** `aws_sqs_queue`, `data "aws_iam_policy_document"` e `aws_sqs_queue_policy`.
- **Do design:** `queueType`. Fila `fifo` leva `fifo_queue = true` e o nome termina em `.fifo`.
- **Padrões seguros:** `sqs_managed_sse_enabled = true` e política que nega `sqs:*` quando a chamada não usa TLS.
- **Visibilidade:** 6 × o tempo limite da função que consome a fila (a maior, se forem várias), com teto de 43.200 s. Sem função consumidora, o atributo não é escrito.

### DynamoDB

- **Recursos:** `aws_dynamodb_table`.
- **Do design:** `capacityMode`. `provisioned` vira `PROVISIONED` com `read_capacity` e `write_capacity` tirados de `provisionedReadUnits` e `provisionedWriteUnits` do uso, com mínimo 1; o outro modo vira `PAY_PER_REQUEST`.
- **Padrões seguros:** criptografia em repouso, recuperação pontual e `deletion_protection_enabled = true`.

### O que cada aresta cria

Só a aresta `data` dá permissão, nas ações abaixo e no ARN do par (no S3, sobre os objetos: `<arn>/*`). A tabela é o `GRANTS` de `lambda.ts`.

| Aresta                  | Cria                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| fila SQS → função       | `aws_lambda_event_source_mapping` e leitura da fila: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` |
| função → fila SQS       | `sqs:SendMessage`                                                                                  |
| função → tabela DynamoDB | `dynamodb:GetItem`, `Query`, `PutItem`, `UpdateItem` e `DeleteItem`                               |
| função → bucket S3      | `s3:GetObject` e `s3:PutObject` nos objetos                                                        |
| bucket S3 → função      | só `s3:GetObject` nos objetos                                                                      |
| aresta de logs, tabela → função | nada                                                                                       |

### Pontos de partida

- O código não existe no design: o pacote .zip vem de `var.<nome>__package`, sem valor padrão. Runtime `nodejs22.x` e handler `index.handler` são fixos e precisam de ajuste.
- O esquema de chaves da tabela é de exemplo: `pk` e `sk`, ambas string.
- Gatilho de bucket para função (notificação de evento do S3) não é gerado.
