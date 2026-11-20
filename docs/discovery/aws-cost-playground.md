# Discovery — AWS Cost Playground

Rascunho compilado em 2026-11-05 a partir da conversa com o mentor; revisado em 2026-11-09 com as respostas L1–L14 ao feedback da ai-software-house. Formato segue as 9 perguntas da skill `architecture-discovery`. A versão canônica é a que a fábrica grava no repo; este documento é o espelho da conversa.

## 1. Objetivo e problema

Editor visual (canvas com blocos e arestas) onde o usuário monta uma arquitetura com serviços reais da AWS, descreve a carga esperada em linguagem natural ou em números, e recebe uma estimativa de custo mensal que se atualiza a cada bloco adicionado.

Problema resolvido: obter uma primeira estimativa de custo no início de um projeto, com fidelidade de SKU real (Price List API), não de blocos genéricos.

Motivação inicial: projeto universitário para estudar AWS e praticar system design. Possível evolução para produto se houver procura.

Diferenciais frente a systemdesignsim.com (ferramenta de estudo para entrevistas):
- Blocos são SKUs reais da AWS, não "database"/"cache" genéricos
- Carga descrita em linguagem natural; LLM lê descrição + diagrama e devolve uso por bloco; preço é determinístico
- Custos invisíveis modelados nas arestas e em blocos dedicados (egress, cross-AZ, NAT Gateway, logs)
- Separação explícita de custo fixo vs. variável por design
- Export para Terraform/CDK
- Comparação de cenários lado a lado

Posicionamento: ferramenta de orçamento, não de estudo. Abre mão de multi-cloud e de simulação de latência.

## 2. Perfil e volume de usuários

- Lançamento: 1 usuário (o autor)
- 6 meses: o autor + recrutadores e curiosos (cadastro aberto)
- 12/24 meses: não definido (risco). Gatilho de revisão em "Critério de MVP pronto".

## 3. Picos de uso

Nenhum previsto.

## 4. Volume e sensibilidade dos dados

- Diagramas em JSON. Sem dados financeiros ou de saúde.
- Login opcional (Cognito, cadastro aberto com verificação de e-mail). Dados pessoais: e-mail. LGPD: política de privacidade e exclusão de conta são Issues obrigatórias do MVP. Issues de auth recebem `security:sensitive`.
- Sem colaboração. Cada usuário vê apenas os próprios designs.
- Modelo: design = um documento JSON (blocos, arestas tipadas, descrição de carga, usage por bloco vindo da LLM, overrides manuais, cenários). Persistido no DynamoDB para logados; baixado como arquivo para anônimos. Limite de 400 KB por item; se crescer, JSON vai para S3 com ponteiro.

## 5. Integrações externas

- AWS Price List Query API (GetProducts), consumida apenas em CI para gerar JSON estático de preços.
- Claude API (Anthropic) para traduzir descrição + diagrama em usage por bloco.

## 6. Mobile, tempo real, assíncrono

- Mobile: não
- Tempo real: não. Recálculo de preço é determinístico e roda no navegador.
- Assíncrono: apenas o job de build semanal de preços em CI, fora do runtime.
- Futuro: edição colaborativa.

## 7. Restrições legais/regulatórias

- LGPD mínima (ver 4).
- UI e exports deixam claro que os valores são estimativa, não cotação oficial.

## 8. Orçamento mensal e teto

- LLM: $200/mês de créditos de API do plano Claude Ultra. **Verificado** (platform.claude.com/docs/about-claude/api-credits-for-subscribers): vinculados a uma organização do Console, expiram por ciclo sem acúmulo, cobrem Claude API e Agent SDK, não cobrem Claude Code. Pendente: vínculo e workspace com limite de gasto.
- Infra: apenas serviços com custo proporcional ao uso, mais a zona do Route 53. Estimativa: **$0,50 a 2,50/mês** + registro anual do domínio.
- Teto: $20/mês com guardrails abaixo.

## 9. Quem paga e duração

O autor. Duração indefinida.

---

## Decisões de stack (entrada para o ADR)

- Frontend: React + React Flow, em S3 + CloudFront com domínio próprio (Route 53 + ACM).
- Backend: Python + FastAPI em Lambda, atrás de API Gateway HTTP API com JWT authorizer nativo do Cognito. Funções: CRUD de designs, proxy da LLM, quotas. Sem função "auth" própria.
- Banco: DynamoDB on-demand, tabela única. `USER#<id>` / `DESIGN#<id>`; `USER#<id>` / `QUOTA#<data>`; `GLOBAL` / `QUOTA#<data>`.
- Auth: Cognito Essentials, self-signup habilitado com verificação de e-mail, domínio customizado com ACM.
- Segredos: SSM Parameter Store standard (SecureString). Secrets Manager só como bloco do produto.
- Preços: script Python em CI chama GetProducts com filtros, gera `prices/<region>/<service>.json` (< 500 KB cada), publica no S3. Regiões us-east-1 e sa-east-1. Cadência semanal + manual. Free tier e mínimos como regras no JSON. Frontend carrega sob demanda.
- Hospedagem: AWS, 100% serverless. **Nada em VPC**, logo NAT Gateway impossível por construção.
- Fora da infra do MVP (só como blocos do produto): WAF, ElastiCache, RDS/Aurora, Secrets Manager.
- Prompt injection: defesa na aplicação. Resposta da LLM validada contra schema numérico e contra os ids do diagrama; descrição como dado separado do system prompt; LLM sem ferramentas e sem segredos.
- Desvio do padrão da casa (.NET/NestJS): simplicidade do backend e stack que o autor quer praticar.

### Dois modos de uso

- **Anônimo:** editor completo, template, recálculo determinístico, baixar e abrir JSON. Zero chamadas ao backend além do JSON estático de preços.
- **Logado:** tudo isso + salvar designs + chamar a LLM.

A LLM é a única fronteira que gasta dinheiro do autor; fica atrás do login com três camadas: quota por usuário (20/dia), quota global (300/dia), ação do Budgets em $15.

### Guardrails de custo

- AWS Budgets: alertas em $5 e $10; ação em $15 desabilita a Lambda do proxy da LLM
- Limite mensal de gasto da conta (Paid plan) em $20, se disponível
- Lambda: reserved concurrency 5, timeout curto
- SQS: DLQ com maxReceiveCount 3
- CloudWatch Logs: retenção 7 dias
- DynamoDB on-demand
- Cognito Essentials; não ativar Plus/Advanced Security
- S3: lifecycle apaga versões antigas e multipart incompleto
- Checklist no PR de infra: nenhum custo fixo mensal além da zona do Route 53

### Estimativa mensal da infra (1 usuário, us-east-1, a calibrar na Price List API)

| Serviço | Custo |
|---|---|
| Route 53 | $0,50 (zona) |
| CloudFront | $0 |
| API Gateway HTTP API | ~$0 |
| Lambda | $0 |
| DynamoDB | $0 |
| S3 | < $1 |
| SQS + worker Lambda | $0 |
| Cognito | $0 (10k MAU) |
| SSM Parameter Store | $0 |
| CloudWatch | ~$0 a 1 |
| CloudTrail | $0 |
| IAM, CloudFormation, CodePipeline | ~$0 |
| **Total** | **~$0,50 a 2,50/mês** |

Referência: versão clássica (ALB + EC2/ECS + RDS + ElastiCache + NAT) ficaria entre $70 e $110/mês com zero tráfego.

## Modelo de cálculo (L6)

A LLM recebe a descrição de carga e o diagrama inteiro (blocos com atributos, arestas tipadas) e devolve um objeto `usage` por `id` de bloco. Saída validada contra schema numérico e contra os ids presentes; ids desconhecidos descartados; blocos sem usage recebem defaults conservadores marcados como default. Preço é determinístico (usage × preço, no navegador); mudanças de atributo recalculam sem LLM. Chamada sob demanda via botão "Re-estimar carga"; mudança no diagrama só marca a estimativa como desatualizada. Override manual de usage vence a LLM e sobrevive a re-estimativas (campo separado no JSON). Sem fórmulas por serviço no MVP.

## Escopo (entrada para o PRD)

### MVP: 20 blocos

19 da "standard production architecture" (Route 53, CloudFront, WAF, ALB, EC2, ECS, Lambda, ElastiCache, RDS, DynamoDB, S3, SQS, Cognito, IAM, Secrets Manager, CloudWatch, CloudTrail, CodePipeline, CloudFormation) + NAT Gateway. O diagrama de referência é o template inicial de um design novo.

### Níveis (ordem de implementação e releases)

- **Nível A** (release 1): EC2, Lambda, RDS, DynamoDB, ElastiCache, S3, SQS, CloudFront, ALB, CloudWatch, NAT Gateway
- **Nível B** (release 2): WAF, Cognito, Secrets Manager, CloudTrail, Route 53, CodePipeline
- **Nível C** (release 2): IAM, CloudFormation, ECS (custo zero; "roda em" EC2 via aresta de composição; Fargate na expansão)
- **Release 3:** export Terraform/CDK e comparação de cenários

### Arestas e custos invisíveis no MVP
- Egress para internet (CloudFront, S3, API Gateway → cliente)
- Cross-AZ: blocos em VPC (EC2, ECS, RDS, ElastiCache) têm atributo opcional `az`; fluxo entre AZs cobra $0,01/GB por direção
- NAT Gateway como bloco (hora + GB)
- CloudWatch Logs: ingestão derivada do tráfego dos blocos conectados
- Aresta "roda em" (composição) para ECS → EC2
- Uma região por design; cross-region fora do MVP

### Critério de MVP pronto
1. Template dos 20 blocos abre e calcula
2. Para 3 cenários de referência (API serverless, app clássico, pipeline de filas), estimativa dentro de ±15% da AWS Pricing Calculator
3. Export Terraform de cada cenário passa em `terraform validate`
4. Comparação lado a lado de 2 designs com a mesma carga

Gatilho de revisão (arquitetura e cobrança): 100 estimativas/mês por não-autor, ou quota global atingida em 5 dias do mesmo mês.

### Fora de escopo do MVP
Colaboração, multi-cloud, simulação de latência/erros, cobrança por uso, cross-region. Expansão: EKS, Fargate, Glacier, EBS, KMS, SNS, EventBridge, Step Functions, Config, API Gateway, VPC como bloco.

## Pendências antes do board

- [ ] JSON de um bloco Lambda e de um bloco S3 com `attributes`, `usage` da LLM e override manual
- [ ] Consultar ALB e NAT Gateway via `aws pricing get-products` e calibrar a estimativa
- [ ] Definir campos fora do JSON no item do DynamoDB (nome, updatedAt, ...)
- [ ] Ler seção de segredos de `devops-standards`
- [ ] Vincular créditos do Ultra a uma organização do Console e criar workspace com limite
- [ ] Confirmar condições do Free Tier da AWS para conta nova (Paid plan, limite de gasto)
- [ ] Escolher e registrar o domínio
