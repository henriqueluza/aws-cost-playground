# Cenários de referência

Os três cenários do critério 2 do MVP ([PRD](product/aws-cost-playground/PRD.md)): a estimativa do motor precisa ficar dentro de ±15% da [AWS Pricing Calculator](https://calculator.aws/) em cada um. Este documento diz o que digitar na calculadora para reproduzir cada cenário.

- **Arquivos:** `contracts/scenarios/api-serverless.json`, `app-classico.json` e `pipeline-de-filas.json`. São designs comuns ([design-document.md](architecture/aws-cost-playground/design-document.md)) e abrem no editor. Se este texto e um arquivo divergirem, vale o arquivo.
- **Conferência:** `web/src/features/pricing/application/referenceScenarios.test.ts` valida os três contra o schema do design e contra `contracts/blocks.json` e `contracts/edges.json`.
- **Quem usa:** a #76 (o autor monta os cenários na calculadora e anota os totais), a #81 (teste de ±15%) e a #68 (`terraform validate` do export).

## Totais de referência

Os valores vêm da #76. Não preencha com valor calculado pelo motor.

| Cenário | Total mensal (US$) | Data | Link da estimativa |
| --- | --- | --- | --- |
| `api-serverless` | _vem da #76_ | | |
| `app-classico` | _vem da #76_ | | |
| `pipeline-de-filas` | _vem da #76_ | | |

## Premissas dos três cenários

1. **Região:** US East (N. Virginia), `us-east-1`, em todos os serviços. No CloudFront, todo o tráfego sai por pontos de presença dos Estados Unidos.
2. **Preço:** On-Demand. Sem Savings Plans, sem instância reservada, sem Spot, sem desconto de contrato e sem plano de suporte.
3. **Mês:** 730 horas. Recurso cobrado por hora fica ligado o mês inteiro (100% de utilização).
4. **Franquia gratuita:** a franquia permanente (_always free_) entra na conta; a de 12 meses de conta nova não entra. O motor aplica a franquia que está no catálogo de preços, então a referência precisa incluí-la. Onde a calculadora tiver a opção, marque-a; onde não tiver, anote na #76 o que ela fez (veja [Franquias em jogo](#franquias-em-jogo)).
5. **Uma estimativa por cenário,** com um item por linha das tabelas abaixo. Dois blocos do mesmo serviço são dois itens.
6. **O que não está na tabela fica em zero ou no padrão da calculadora.** Os campos que a calculadora exige e o contrato dos blocos não tem estão em [Parâmetros fora do contrato](#parâmetros-fora-do-contrato).
7. **Nomes dos campos:** os nomes entre aspas são os da calculadora em inglês e podem mudar. Se o campo tiver outro nome ou outra unidade, vale o significado e o valor da tabela; anote a diferença na #76.

## Como ler as arestas

A aresta `data` parte de quem chama e chega em quem é chamado (CloudFront para S3, Lambda para DynamoDB, fila para o worker). `gbPerMonth` é o volume mensal que passa pela ligação. Só quatro tipos de aresta custam (PRD F13), e só eles entram na calculadora:

| Aresta | Custo | Onde digitar |
| --- | --- | --- |
| `data` com destino `client` | Saída para a internet | No item do serviço de origem: "Data transfer out to internet" |
| `data` entre blocos com `az` diferentes | Tráfego entre zonas, cobrado nas duas direções | Item "Data Transfer", tipo "Intra-Region" |
| `data` com destino NAT Gateway | GB processado pelo NAT | Item "NAT Gateway": "Data processed per NAT Gateway" |
| `logs` | Ingestão de logs | Item "CloudWatch": "Standard Logs: Data Ingested" |

As outras arestas `data` (mesma zona, ou serviços sem zona) não custam e não entram na calculadora. O volume delas serve à estimativa de carga e ao export.

Para não contar duas vezes, os blocos NAT Gateway e CloudWatch têm `processedGbPerMonth` e `logsIngestedGbPerMonth` em zero: o volume vem só das arestas. O valor a digitar é a soma das arestas, já feita nas tabelas.

## 1. `api-serverless`

API REST serverless com site estático: o CloudFront entrega o site (S3) e encaminha as chamadas a uma função Lambda que lê e grava no DynamoDB.

- **Região:** us-east-1
- **Blocos (5):** CloudFront, S3, Lambda, DynamoDB, CloudWatch
- **Arestas (5):** 4 `data` (uma para `client`) e 1 `logs`

| Bloco | Item na calculadora | Parâmetro | Valor |
| --- | --- | --- | --- |
| `blk_cdn` | Amazon CloudFront | Requisições HTTPS ("Number of requests (HTTPS)") | 12.000.000 por mês |
| `blk_cdn` | Amazon CloudFront | Saída para a internet (aresta `edg_cdn_client`) | 300 GB por mês |
| `blk_site` | Amazon S3 (S3 Standard) | Armazenamento ("S3 Standard storage") | 5 GB por mês |
| `blk_site` | Amazon S3 (S3 Standard) | Requisições PUT, COPY, POST, LIST | 2.000 por mês |
| `blk_site` | Amazon S3 (S3 Standard) | Requisições GET, SELECT | 500.000 por mês |
| `blk_api` | AWS Lambda | Arquitetura | Arm |
| `blk_api` | AWS Lambda | Requisições ("Number of requests") | 10.000.000 por mês |
| `blk_api` | AWS Lambda | Duração média ("Duration of each request") | 120 ms |
| `blk_api` | AWS Lambda | Memória ("Amount of memory allocated") | 512 MB |
| `blk_table` | Amazon DynamoDB (on-demand) | Armazenamento ("Data storage size") | 50 GB |
| `blk_table` | Amazon DynamoDB (on-demand) | Leituras | 20.000.000 por mês |
| `blk_table` | Amazon DynamoDB (on-demand) | Escritas | 5.000.000 por mês |
| `blk_logs` | Amazon CloudWatch | Logs ingeridos (aresta `edg_api_logs`) | 20 GB por mês |
| `blk_logs` | Amazon CloudWatch | Logs armazenados | 3 GB |
| `blk_logs` | Amazon CloudWatch | Métricas customizadas ("Number of Metrics") | 20 |
| `blk_logs` | Amazon CloudWatch | Alarmes de resolução padrão | 15 |
| | | **Total de referência** | _vem da #76_ |

Arestas sem custo (não digitar): `edg_cdn_site` (50 GB), `edg_cdn_api` (40 GB), `edg_api_table` (30 GB).

## 2. `app-classico`

Aplicação web em três camadas: CloudFront na frente de um ALB com duas instâncias EC2 em zonas diferentes, banco RDS PostgreSQL Multi-AZ, cache Redis, saída para a internet por NAT Gateway e arquivos no S3.

- **Região:** us-east-1
- **Blocos (9):** CloudFront, S3, ALB, EC2 (dois blocos, zonas `a` e `b`), RDS, ElastiCache, NAT Gateway, CloudWatch
- **Arestas (15):** 12 `data` (duas para `client`, duas entre zonas, duas para o NAT) e 3 `logs`

| Bloco | Item na calculadora | Parâmetro | Valor |
| --- | --- | --- | --- |
| `blk_cdn` | Amazon CloudFront | Requisições HTTPS | 20.000.000 por mês |
| `blk_cdn` | Amazon CloudFront | Saída para a internet (aresta `edg_cdn_client`) | 500 GB por mês |
| `blk_assets` | Amazon S3 (S3 Standard) | Armazenamento | 100 GB por mês |
| `blk_assets` | Amazon S3 (S3 Standard) | Requisições PUT, COPY, POST, LIST | 50.000 por mês |
| `blk_assets` | Amazon S3 (S3 Standard) | Requisições GET, SELECT | 2.000.000 por mês |
| `blk_assets` | Amazon S3 (Data Transfer) | Saída para a internet (aresta `edg_assets_client`) | 50 GB por mês |
| `blk_alb` | Elastic Load Balancing (Application Load Balancer) | Quantidade de balanceadores | 1 |
| `blk_alb` | Elastic Load Balancing (Application Load Balancer) | Bytes processados, alvos EC2 ("Processed bytes") | 365 GB por mês, ou 0,5 GB por hora |
| `blk_alb` | Elastic Load Balancing (Application Load Balancer) | Conexões novas ("Average number of new connections") | 10 por segundo |
| `blk_alb` | Elastic Load Balancing (Application Load Balancer) | Conexões ativas | 600 por minuto |
| `blk_alb` | Elastic Load Balancing (Application Load Balancer) | Avaliações de regra | 0 por segundo |
| `blk_web_a`, `blk_web_b` | Amazon EC2 | Tipo de instância | t3.medium |
| `blk_web_a`, `blk_web_b` | Amazon EC2 | Quantidade | 2 no total (1 por bloco) |
| `blk_web_a`, `blk_web_b` | Amazon EC2 | Horas | 730 por mês cada |
| `blk_web_a`, `blk_web_b` | Amazon EC2 (EBS) | Volume raiz | 30 GB por instância |
| `blk_db` | Amazon RDS for PostgreSQL | Classe da instância | db.t3.medium |
| `blk_db` | Amazon RDS for PostgreSQL | Quantidade | 1 |
| `blk_db` | Amazon RDS for PostgreSQL | Implantação ("Deployment option") | Multi-AZ |
| `blk_db` | Amazon RDS for PostgreSQL | Armazenamento | 100 GB |
| `blk_db` | Amazon RDS for PostgreSQL | Backup adicional ("Additional backup storage") | 0 GB |
| `blk_cache` | Amazon ElastiCache | Motor | Redis OSS |
| `blk_cache` | Amazon ElastiCache | Tipo de nó | cache.t3.small |
| `blk_cache` | Amazon ElastiCache | Nós | 2 |
| `blk_nat` | NAT Gateway (em Amazon VPC) | Quantidade de gateways | 1 |
| `blk_nat` | NAT Gateway (em Amazon VPC) | GB processado (arestas `edg_web_a_nat` + `edg_web_b_nat`) | 50 GB por mês |
| arestas entre zonas | Data Transfer (Intra-Region) | Tráfego entre zonas (`edg_web_b_db` + `edg_web_b_cache`) | 40 GB por mês |
| `blk_logs` | Amazon CloudWatch | Logs ingeridos (`edg_web_a_logs` + `edg_web_b_logs` + `edg_db_logs`) | 40 GB por mês |
| `blk_logs` | Amazon CloudWatch | Logs armazenados | 6 GB |
| `blk_logs` | Amazon CloudWatch | Métricas customizadas | 20 |
| `blk_logs` | Amazon CloudWatch | Alarmes de resolução padrão | 15 |
| | | **Total de referência** | _vem da #76_ |

- **Zonas:** `blk_web_a`, `blk_db` (instância primária) e `blk_cache` estão na zona `a`; `blk_web_b` está na zona `b`. Só as duas arestas que saem de `blk_web_b` para o banco e para o cache cruzam zonas. O motor cobra os 40 GB nas duas direções; confira se a calculadora faz o mesmo no "Intra-Region" e anote na #76.
- **ALB:** a calculadora pede a duração da conexão em vez das conexões ativas. Use 60 segundos (10 conexões novas por segundo × 60 s = 600 ativas). Para zerar as avaliações de regra, use 10 regras ou menos por requisição (as 10 primeiras não são cobradas).
- **EC2:** os dois blocos são iguais; na calculadora pode ser um item com quantidade 2.

Arestas sem custo (não digitar): `edg_cdn_assets` (150 GB), `edg_cdn_alb` (365 GB), `edg_alb_web_a` e `edg_alb_web_b` (182,5 GB cada), `edg_web_a_db` (30 GB), `edg_web_a_cache` (10 GB).

## 3. `pipeline-de-filas`

Pipeline assíncrono em filas: arquivos chegam a um bucket S3, uma função Lambda divide cada um em mensagens numa fila SQS, um worker Lambda consome, grava no DynamoDB, arquiva no S3 Standard-IA e avisa por uma fila FIFO.

- **Região:** us-east-1
- **Blocos (8):** S3 (dois: Standard e Standard-IA), Lambda (dois), SQS (dois: standard e FIFO), DynamoDB, CloudWatch
- **Arestas (8):** 6 `data` (nenhuma com custo) e 2 `logs`

| Bloco | Item na calculadora | Parâmetro | Valor |
| --- | --- | --- | --- |
| `blk_landing` | Amazon S3 (S3 Standard) | Armazenamento | 200 GB por mês |
| `blk_landing` | Amazon S3 (S3 Standard) | Requisições PUT, COPY, POST, LIST | 1.000.000 por mês |
| `blk_landing` | Amazon S3 (S3 Standard) | Requisições GET, SELECT | 1.000.000 por mês |
| `blk_splitter` | AWS Lambda | Arquitetura | x86 |
| `blk_splitter` | AWS Lambda | Requisições | 1.000.000 por mês |
| `blk_splitter` | AWS Lambda | Duração média | 800 ms |
| `blk_splitter` | AWS Lambda | Memória | 1.024 MB |
| `blk_queue` | Amazon SQS | Requisições de fila standard ("Standard queue requests") | 150 milhões por mês |
| `blk_worker` | AWS Lambda | Arquitetura | Arm |
| `blk_worker` | AWS Lambda | Requisições | 5.000.000 por mês |
| `blk_worker` | AWS Lambda | Duração média | 400 ms |
| `blk_worker` | AWS Lambda | Memória | 512 MB |
| `blk_results` | Amazon DynamoDB (provisionado) | Armazenamento | 100 GB |
| `blk_results` | Amazon DynamoDB (provisionado) | Capacidade de leitura | 20 RCU, o mês inteiro |
| `blk_results` | Amazon DynamoDB (provisionado) | Capacidade de escrita | 50 WCU, o mês inteiro |
| `blk_archive` | Amazon S3 (S3 Standard - Infrequent Access) | Armazenamento | 1.000 GB por mês |
| `blk_archive` | Amazon S3 (S3 Standard - Infrequent Access) | Requisições PUT, COPY, POST, LIST | 500.000 por mês |
| `blk_archive` | Amazon S3 (S3 Standard - Infrequent Access) | Requisições GET, SELECT | 0 |
| `blk_notify` | Amazon SQS | Requisições de fila FIFO ("FIFO queue requests") | 5 milhões por mês |
| `blk_logs` | Amazon CloudWatch | Logs ingeridos (`edg_splitter_logs` + `edg_worker_logs`) | 40 GB por mês |
| `blk_logs` | Amazon CloudWatch | Logs armazenados | 6 GB |
| `blk_logs` | Amazon CloudWatch | Métricas customizadas | 20 |
| `blk_logs` | Amazon CloudWatch | Alarmes de resolução padrão | 15 |
| | | **Total de referência** | _vem da #76_ |

- **Lambda:** são duas funções e uma franquia só por conta. Marque "Include Free Tier" em um dos dois itens (o do `blk_worker`) e desmarque no outro.
- **DynamoDB provisionado:** se a calculadora pedir taxa de leitura e de escrita em vez de unidades, use 20 leituras por segundo e 50 escritas por segundo, constantes (linha de base igual ao pico), com item de 1 KB. As chaves `readRequestsPerMonth` e `writeRequestsPerMonth` estão em zero porque são do modo on-demand.
- **SQS:** as duas filas podem ir no mesmo item, que tem um campo para cada tipo.

Arestas sem custo (não digitar): `edg_landing_splitter` (100 GB), `edg_splitter_queue` (60 GB), `edg_queue_worker` (60 GB), `edg_worker_results` (40 GB), `edg_worker_archive` (50 GB), `edg_worker_notify` (2 GB).

## Parâmetros fora do contrato

A calculadora pede estes campos e `contracts/blocks.json` não os tem. Use o valor da tabela nos três cenários. São premissas: se o motor (#30 a #37, #42) assumir outra coisa, a diferença aparece no teste de ±15% (#81).

| Serviço | Parâmetro da calculadora | Valor a usar |
| --- | --- | --- |
| EC2 | Sistema operacional | Linux |
| EC2 | Tenancy | Shared Instances |
| EC2 | Carga ("Workload") | Constante, 100% de utilização |
| EC2 | Opção de preço | On-Demand |
| EC2 | Tipo do volume EBS | gp3, com 3.000 IOPS e 125 MB/s (o incluído), sem snapshot |
| EC2 | Monitoramento detalhado, IP elástico, transferência de dados | Desligado, zero |
| Lambda | Armazenamento efêmero | 512 MB (o incluído) |
| Lambda | Concorrência provisionada, Lambda@Edge, URL de função com streaming | Zero |
| Lambda | Modo de invocação ("Invoke mode") | Buffered (sem streaming de resposta) |
| S3 | Dados retornados e varridos pelo S3 Select; recuperação do Standard-IA | 0 GB |
| S3 | Regras de ciclo de vida, replicação, inventário, versionamento | Nenhum |
| DynamoDB | Classe da tabela | Standard |
| DynamoDB | Tamanho médio do item | 1 KB (uma requisição = uma unidade) |
| DynamoDB | Consistência das leituras | Forte (100% "strongly consistent") |
| DynamoDB | Escritas | 100% padrão, 0% transacionais |
| DynamoDB | Backup, Streams, tabelas globais, exportação, capacidade reservada | Zero |
| CloudFront | Região de borda | Só Estados Unidos |
| CloudFront | Saída para a origem ("Data transfer out to origin") | 0 GB |
| CloudFront | Requisições HTTP, invalidações, Functions, Lambda@Edge, logs em tempo real | Zero |
| ALB | Duração média da conexão | 60 segundos |
| ALB | Requisições por segundo e regras por requisição | 8 requisições por segundo, até 10 regras (avaliações cobradas: zero) |
| ALB | Alvos Lambda, bytes processados para Lambda | Zero |
| RDS | Opção de preço | On-Demand, 100% de utilização |
| RDS | Tipo de armazenamento | gp3, com o IOPS e a vazão incluídos |
| RDS | RDS Proxy, Performance Insights pago, Extended Support, snapshot exportado | Nenhum |
| ElastiCache | Modelo | Nós (não Serverless), On-Demand, 100% de utilização |
| ElastiCache | Motor | Redis OSS (não Valkey, que tem outro preço) |
| ElastiCache | Backup, data tiering | Zero |
| SQS | Transferência de dados, tamanho da mensagem | Zero; até 64 KB por requisição (1 requisição = 1 cobrança) |
| NAT Gateway | Transferência de saída para a internet do tráfego que passa pelo NAT | Não digitar: o contrato não tem aresta de NAT para `client` |
| CloudWatch | Retenção dos logs | 1 mês; o armazenado (3 GB ou 6 GB) é 15% do ingerido, a compressão que a calculadora costuma assumir; se ela calcular sozinha, não há campo a preencher |
| CloudWatch | Logs entregues ao S3 ou ao Firehose (_vended_), Logs Insights, painéis, chamadas de API, alarmes de alta resolução | Zero |
| Data Transfer | Entrada da internet | 0 GB (não é cobrada) |

Dois pontos do contrato dependem das Issues de preço e foram deixados fora do alcance da dúvida:

- **Backup do RDS:** `backupStorageGb` é 0. A #34 decidiu que a chave é só o backup além do incluído, o campo "Additional backup storage" da calculadora, cobrado inteiro por GB-mês. Com zero, o cenário não muda.
- **Recuperação do Standard-IA:** `blk_archive` tem `getRequestsPerMonth` em 0, porque o contrato não tem GB recuperado.

## Franquias em jogo

Franquias permanentes que afetam os cenários. O catálogo de preços (#30 a #37, #42) é a fonte de verdade das quantidades; a coluna abaixo é o que se espera encontrar nele. Para cada linha, anote na #76 se a calculadora aplicou a franquia. Onde ela não aplicar e não houver opção, anote também o valor do serviço com e sem a franquia: a #81 usa isso para explicar a diferença.

| Serviço | Franquia permanente esperada | Cenários |
| --- | --- | --- |
| Lambda | 1 milhão de requisições e 400.000 GB-segundo por mês (opção "Include Free Tier") | 1 e 3 |
| SQS | 1 milhão de requisições por mês | 3 |
| DynamoDB | 25 GB de armazenamento; no provisionado, 25 RCU e 25 WCU | 1 e 3 |
| CloudFront | 1 TB de saída e 10 milhões de requisições por mês | 1 e 2 |
| CloudWatch | 5 GB de logs, 10 métricas customizadas e 10 alarmes | 1, 2 e 3 |
| Saída para a internet (S3, EC2, ALB) | 100 GB por mês, somados entre os serviços | 2 |

A franquia de 12 meses (por exemplo, 5 GB de S3 e 750 horas de EC2 ou de RDS) não entra em nenhum cenário.

A do CloudFront é a que mais pesa: os 300 GB do cenário 1 e os 500 GB do cenário 2 cabem inteiros em 1 TB.

## Como mudar um cenário

Mudar um número em `contracts/scenarios/` invalida o total de referência daquele cenário: refaça a estimativa na calculadora e atualize a #76 e os valores versionados pela #81 no mesmo PR. Atualize também a tabela deste documento.
