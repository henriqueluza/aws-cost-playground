# ADR-0001 — Stack, arquitetura e hospedagem do AWS Cost Playground

- **Status:** aprovado pelo autor no Gate 1 em 2026-11-18, com as decisões registradas em "Decisões do Gate 1"
- **Data:** 2026-11-18
- **Entrada:** [discovery](../../discovery/aws-cost-playground.md), revisão de 2026-11-09
- **Diagrama:** [C4 de contexto](C4-context.md)

## Contexto

Editor visual em que o usuário monta uma arquitetura com serviços reais da AWS, descreve a carga e recebe uma estimativa de custo mensal. O preço é calculado no navegador, de forma determinística, a partir de arquivos estáticos gerados da Price List API. A LLM só traduz descrição + diagrama em números de uso.

Restrições que decidem a arquitetura:

- Um desenvolvedor (o autor), que também paga a conta. Teto de US$ 20/mês de infra e US$ 200/mês de créditos da Claude API.
- Um usuário no lançamento; cadastro aberto depois. Sem picos previstos.
- Nenhum custo fixo mensal além da zona do Route 53.
- Dado pessoal: só o e-mail. LGPD mínima.
- A stack foi escolhida pelo autor no discovery. Este ADR a registra, justifica o desvio do padrão da casa e fecha o que ficou em aberto.

## Decisão

### Nível de arquitetura

| Componente | Nível | Justificativa (tabela de proporcionalidade) |
|---|---|---|
| `web/` (React) | **clean** | A regra de negócio do produto mora aqui: motor de preço, regras de free tier, custos de aresta, precedência de override, export Terraform. Vida útil > 1 ano e precisa ser testada sem React nem rede. |
| `api/` (FastAPI) | **simple** | CRUD de designs, contador de quota e um proxy. Poucas regras, um banco, uma integração. |
| `pricing/` (script de CI) | **simple** | Extração e transformação em lote, sem estado. |

O guia da casa diz que frontend raramente precisa de `clean` porque a regra pesada mora no backend. Aqui é o contrário por desenho: o cálculo roda no navegador para o modo anônimo funcionar sem backend.

### Stack

| Camada | Escolha |
|---|---|
| Frontend | React + TypeScript + Vite (SPA estática), React Flow para o canvas, Zustand para o estado do editor, TanStack Query para o estado de servidor, zod para validar o design e as respostas da API |
| Backend | Python + FastAPI + Pydantic v2 em AWS Lambda, atrás de API Gateway HTTP API |
| Banco | DynamoDB on-demand, tabela única |
| Auth | Cognito User Pool (tier Essentials), login gerenciado em domínio próprio, Authorization Code + PKCE |
| LLM | Claude API pelo SDK oficial `anthropic`, saída estruturada por JSON Schema |
| IaC e CI | Terraform + GitHub Actions com OIDC |

Não é Next.js: não há renderização no servidor nem rota de API no frontend; o site é um bundle estático no S3. Versões e APIs de cada biblioteca são confirmadas no Context7 na Issue do esqueleto, que também passa as dependências pelo `supply-chain-risk-auditor`.

### Estrutura do repositório

Monorepo `henriqueluza/aws-cost-playground`:

```
web/
  src/
    app/                    # rotas, providers, composition root
    features/
      editor/               # canvas, paleta, inspetor de bloco
      pricing/              # motor de preço
      workload/             # descrição de carga, "Re-estimar carga"
      designs/              # salvar, listar, abrir, baixar
      auth/
      export/               # Terraform (release 3)
      compare/              # comparação de cenários (release 3)
    shared/{ui,lib,config}/
  public/prices/<region>/<service>.json
api/
  app/
    main.py  config.py  auth.py  dynamo.py
    designs/{router,schemas,service,repository}.py
    estimates/{router,schemas,service,claude_client}.py
    quotas/{service,repository}.py
    account/{router,service}.py
  tests/
pricing/                    # script GetProducts → JSON
infra/{modules,envs/{staging,production},bootstrap}/
docs/
```

Dentro de cada feature do `web/`: `ui/` → `hooks/` → `application/` → `model/`, com `api/` como adapter. `features/pricing/{application,model}` é TypeScript puro: não importa React, React Flow nem `fetch`. Store Zustand (inclusive `zustand/vanilla`) fica em `hooks/`: guarda o estado de tela (layout, seleção) e delega toda mudança de documento às ações puras de `model/`/`application/`.

### Teste de arquitetura

- `web/`: `eslint-plugin-boundaries` (feature só importa outra pelo `index.ts`) mais `no-restricted-imports` proibindo `react`, `react-dom`, `@xyflow/*`, `@tanstack/*`, `zustand` e módulos `http` (`shared/lib/http`) nas camadas TypeScript puro: `**/application/**`, `**/model/**`, `shared/lib/design/**`, `shared/lib/api/**` e `shared/lib/money.ts`.
- `api/`: `import-linter` com um contrato `forbidden`: módulos `router` não importam `boto3` nem `anthropic`. É a garantia mínima do nível `simple` (regra fora do controller, acesso a dados atrás de função nomeada).

### Comandos de qualidade

| Onde | Comandos |
|---|---|
| `web/` | `npx prettier --check .` · `npx eslint .` · `npx tsc --noEmit` · `npm test -- --run` · `npm run build` |
| `api/`, `pricing/` | `uv run ruff format --check .` · `uv run ruff check .` · `uv run mypy app` · `uv run lint-imports` · `uv run pytest -q --cov` |
| `infra/` | `terraform fmt -check -recursive infra` · `terraform validate` · `tflint --recursive` · `trivy config infra` |

### Modelo de dados

**Documento do design** (o JSON que o anônimo baixa e que o logado salva). Proposta para as pendências 1 e 3 do discovery:

```json
{
  "schemaVersion": 1,
  "region": "us-east-1",
  "workload": { "description": "API REST com 3 milhões de requisições por mês..." },
  "blocks": [
    {
      "id": "blk_fn_api",
      "type": "aws.lambda",
      "label": "API handler",
      "attributes": { "memoryMb": 512, "architecture": "arm64" },
      "usage": {
        "source": "llm",
        "estimatedAt": "2026-11-18T14:00:00Z",
        "values": { "requestsPerMonth": 3000000, "avgDurationMs": 120 }
      },
      "overrides": { "avgDurationMs": 80 }
    },
    {
      "id": "blk_assets",
      "type": "aws.s3",
      "label": "Uploads",
      "attributes": { "storageClass": "STANDARD" },
      "usage": {
        "source": "default",
        "values": { "storageGb": 50, "putRequestsPerMonth": 100000, "getRequestsPerMonth": 1000000 }
      },
      "overrides": {}
    }
  ],
  "edges": [
    {
      "id": "edg_1",
      "source": "blk_assets",
      "target": "client",
      "kind": "data",
      "usage": { "source": "llm", "values": { "gbPerMonth": 120 } },
      "overrides": {}
    }
  ],
  "scenarios": []
}
```

- Uso efetivo = `{ ...usage.values, ...overrides }`. Uma re-estimativa substitui `usage` inteiro e nunca toca em `overrides`.
- `usage.source` é `llm` ou `default`; a UI marca os valores `default`.
- `edges[].kind`: `data` (tráfego cobrado), `runs-on` (ECS → EC2), `logs` (bloco → CloudWatch).
- `client` é um nó fixo, sem preço, que representa a internet. É o destino das arestas de egress.
- `schemaVersion` permite migrar arquivos antigos na abertura.

**Tabela DynamoDB** (única, on-demand):

| Item | PK | SK | Atributos |
|---|---|---|---|
| Design | `USER#<sub>` | `DESIGN#<ulid>` | `name`, `region`, `schemaVersion`, `blockCount`, `sizeBytes`, `createdAt`, `updatedAt`, `version`, `doc` (JSON em string) |
| Quota do usuário | `USER#<sub>` | `QUOTA#<aaaa-mm-dd>` | `count`, `ttl` |
| Quota global | `GLOBAL` | `QUOTA#<aaaa-mm-dd>` | `count`, `ttl` |

- `<sub>` vem do JWT. Nunca do path nem do corpo.
- `version` implementa trava otimista: a atualização é um `UpdateItem` com `ConditionExpression attribute_exists(PK) AND version = :esperada`, sem ler antes (um `PutItem` regravaria o item inteiro e obrigaria a ler `createdAt` e o `doc` ao renomear). Duas abas abertas não se sobrescrevem em silêncio: a versão desatualizada é 409 e nada é gravado (#54).
- Listagem: `Query` em `PK` com `begins_with(SK, "DESIGN#")`, projetando tudo menos `doc`.
- Limites validados na API: 50 designs por usuário, `doc` até 350 KB, 100 blocos por design.
- O ponteiro para S3 previsto no discovery fica fora do MVP: um design de 20 blocos tem poucos KB. Acima de 350 KB a API responde 413. O ponteiro vira Issue quando alguém bater no limite.
- Consistência forte só na quota. Os dois contadores sobem numa `TransactWriteItems` com `ADD count :1` e `ConditionExpression count < :limite` em cada item: ou os dois incrementam, ou a chamada é recusada com 429. Sem leitura antes da escrita. A condição implementada é `attribute_not_exists(count) OR count < :limite` (o item nasce no primeiro `Update` do dia) e o `ttl` entra por `if_not_exists`.
- `ttl` de 35 dias nos itens de quota, para sobrar histórico do gatilho de revisão (100 estimativas/mês por não-autor).
- Exclusão de conta: apaga a partição `USER#<sub>` inteira e depois o usuário no Cognito.
  - Apaga: todos os itens de `USER#<sub>` (designs e contadores de quota) e o usuário no Cognito (e-mail e refresh tokens).
  - Não apaga: a quota global (`PK = GLOBAL`); backups de PITR (só produção, 35 dias pelo padrão do DynamoDB, depois somem sozinhos; o dado apagado continua recuperável nessa janela); logs do CloudWatch até a retenção de 7 dias (o log da aplicação não tem e-mail; o evento de exclusão não leva `sub`, mas os eventos de quota e de estimativa do `llm-proxy` levam o `sub`, pseudônimo; o log de acesso do API Gateway registra o `sub`, pseudônimo, em toda requisição, inclusive nesta); o que já foi enviado à Anthropic.
  - Janela do token: o access token vale até 15 min após a exclusão e uma escrita nesse intervalo recria itens de `USER#<sub>`. Sem revogação; mitigação no cliente (descartar os tokens após o 204). Decisão pendente do autor (#284).

### Fluxo da estimativa de carga

1. `POST /estimates` com o diagrama (sem `usage`, sem `overrides`) e a descrição.
2. A API valida tamanho (descrição até 2.000 caracteres, até 100 blocos), consome a quota e chama a Claude API.
3. A descrição e o diagrama vão na mensagem do usuário, delimitados como dado. O system prompt é fixo. O modelo não recebe ferramentas.
4. Saída por `output_config.format` com JSON Schema: `blocks: [{ id, values }]` e `edges: [{ id, values }]`, só números.
5. A API revalida: descarta ids que não estão no diagrama, descarta chaves que o tipo do bloco não aceita, limita cada número a uma faixa plausível. `stop_reason` igual a `refusal` ou `max_tokens` vira erro tratado, sem consumir a resposta.
6. O navegador recebe só números e ids. Nenhum texto livre vindo da LLM é exibido.

Dois ajustes em relação ao discovery, aprovados no Gate 1:

- A LLM devolve uso também por **aresta** (`gbPerMonth`), não só por bloco. Sem isso o egress e o cross-AZ precisariam de fórmula por serviço, que o discovery exclui do MVP.
- O egress "API Gateway → cliente" sai do MVP, porque API Gateway não está entre os 20 blocos. Entram as arestas para `client` a partir de CloudFront, S3, ALB e EC2.

O template inicial já traz uma descrição de carga de exemplo e `usage` com `source: "default"` em todos os blocos, para o anônimo ver um total calculado sem LLM (critério 1 do MVP).

### Modelo da LLM e custo por chamada

Estimativa por chamada com um diagrama de 20 blocos: cerca de 4 mil tokens de entrada e 2 mil de saída. A medir na Issue do proxy.

| Modelo | Custo por chamada (20 blocos) | Quota global cheia (30/dia), 20 blocos | Quota global cheia, pior chamada |
|---|---|---|---|
| `claude-haiku-5-5` (**escolhido**) | ~US$ 0,0014 | ~US$ 1,30/mês | ~US$ 3,30/mês |
| `claude-sonnet-5-5` | ~US$ 0,028 | ~US$ 26/mês | ~US$ 66/mês |
| `claude-opus-5-5` | ~US$ 0,056 | ~US$ 52/mês | ~US$ 132/mês |

**Decisão do autor (26/11/2026, #384):** `claude-haiku-5-5`, quota de **5/dia por usuário e 30/dia global** (eram 20 e 300 no Gate 1). O pior caso fica em cerca de US$ 3,30/mês. O id do modelo e as quotas são configuração, não código; trocar de modelo muda o custo em até 40 vezes e por isso passa pelo autor.

A conta do pior caso, com o preço do Haiku 5.5 (US$ 0,10 por milhão de tokens de entrada e US$ 0,50 de saída, para prompt de até 100 mil tokens):

- **Chamadas por mês:** quota global × dias = 30 × 31 = 930. A quota por usuário não entra: o teto de custo é dado pela global.
- **Chamada de 20 blocos** (4.000 de entrada, 2.000 de saída): 4.000 × 0,10 / 10⁶ + 2.000 × 0,50 / 10⁶ = 0,0004 + 0,0010 = US$ 0,0014. No mês: 930 × 0,0014 = **US$ 1,30**.
- **Pior chamada que a API aceita** (cerca de 15.000 de entrada, estimativa da #61; saída no teto `max_tokens` = 4.096): 15.000 × 0,10 / 10⁶ + 4.096 × 0,50 / 10⁶ = 0,0015 + 0,0020 = US$ 0,0035. No mês: 930 × 0,0035 = **US$ 3,30** (US$ 3,72 se a chamada for arredondada para US$ 0,004, como na #61; a decisão do autor cita "cerca de US$ 3,50").
- **Antes** (300/dia): 300 × 31 = 9.300 chamadas; US$ 13/mês com 20 blocos e US$ 33/mês com a pior chamada (os "cerca de US$ 35" da #61). O valor de US$ 13 que este ADR trazia supunha o diagrama de 20 blocos, não o teto de `max_tokens`.

Os tokens são estimativas: nenhuma chamada real foi medida. `max_tokens`, modelo, timeout e ausência de nova tentativa não mudaram.

Os números vivem em um lugar por camada: `DEFAULT_QUOTA_USER_DAILY_LIMIT` e `DEFAULT_QUOTA_GLOBAL_DAILY_LIMIT` em `api/app/config.py` (a infra não passa as variáveis `QUOTA_*`, então valem esses padrões) e `QUOTA_LIMITS` em `web/src/shared/lib/api/quotaLimits.ts` (fake de desenvolvimento e e2e). Se 5 por dia for pouco no ensaio da apresentação, o autor previu subir a quota por usuário para 10, **mantendo a global em 30**: é trocar a constante do usuário nos dois arquivos, e o teto de custo acima não muda.

O gasto com a Claude API **não aparece na fatura da AWS**. Quem o limita é o limite de gasto do workspace no Console da Anthropic, mais as quotas.

### Preços

- `pricing/` chama `GetProducts` com filtros por serviço e região e gera `web/public/prices/<region>/<service>.json` (us-east-1 e sa-east-1), com free tier e mínimos como regras no próprio arquivo, mais um `manifest.json` com data e hash.
- Um workflow semanal (e manual) roda o script e **abre um PR** com o diff. Os preços entram em produção pelo fluxo normal: merge humano, staging automático, produção por disparo manual.
- Os 3 cenários de referência (critério 2 do MVP) são testes do motor de preço. Rodam em todo PR, inclusive nos de preço: uma mudança de SKU que tire um cenário da faixa de ±15% reprova o PR.
- `web/public/prices/**` entra no `.github/pr-size-ignore` (arquivo gerado).

Isso troca "publicar direto no S3" por "publicar via PR". O custo é a produção ficar tão atual quanto o último deploy manual. O ganho é não precisar de exceção à regra da casa (produção só por humano) e ter revisão e rollback dos preços de graça.

### Hospedagem e ambientes

Tudo na AWS, uma conta, região us-east-1, nada em VPC.

| Componente | Serviço |
|---|---|
| Site | S3 privado + CloudFront com Origin Access Control, política de cabeçalhos com CSP e HSTS |
| API | API Gateway HTTP API com JWT authorizer do Cognito; CORS com lista explícita de origens |
| Funções | Duas Lambdas do mesmo pacote: `api` (designs, conta) e `llm-proxy` (estimativas e quota) |
| Banco | DynamoDB on-demand; PITR ligado em produção; `prevent_destroy` |
| Auth | Cognito User Pool por ambiente, domínio `auth.<domínio>` |
| DNS e TLS | Route 53 (uma zona) + ACM |
| Segredos | SSM Parameter Store, SecureString |
| Observabilidade | CloudWatch Logs em JSON; alarmes de erro e de throttle do proxy |

O proxy é uma Lambda separada para que concorrência, timeout, permissão de leitura da chave e o corte do Budgets atinjam só ele.

O repositório traz a infra como código Terraform, escrito pelos agentes e revisado por PR. Nenhum agente aplica nada: o autor configura a conta, os itens de custo e o `infra/bootstrap/` à mão.

| Ambiente | Domínios | Publica | Dados |
|---|---|---|---|
| `staging` | `staging.<domínio>`, `api.staging.<domínio>`, `auth.staging.<domínio>` | CI, após merge em `main` | fictícios; self-signup **desligado**, contas de teste criadas pelo autor |
| `production` | `<domínio>`, `api.<domínio>`, `auth.<domínio>` | CI, só por `workflow_dispatch` humano | reais |

- Mesmo código Terraform, `infra/envs/staging` e `infra/envs/production`, cada um com estado próprio em S3 com lock nativo. Nomes `acp-stg-*` e `acp-prod-*`.
- **Mesmo artefato nos dois ambientes.** O zip das Lambdas e o bundle do site são construídos uma vez por commit e guardados por SHA. Por isso o site não recebe configuração em tempo de build: lê `/config.json` (URL da API, ids do Cognito) ao iniciar, e esse arquivo é o único que difere por ambiente.
- **CI autentica por OIDC.** Papéis separados: `plan` (leitura, usado em PR), `apply-staging`, `apply-production` e `prices` (só `pricing:GetProducts`). Trust restrito a `repo:henriqueluza/aws-cost-playground:environment:<env>`.
- `infra/bootstrap/` (buckets de estado, provedor OIDC, papéis) é aplicado uma vez pelo autor. Agentes não mexem nele.
- **Segredos.** O parâmetro `/acp/<env>/anthropic-api-key` fica fora do Terraform: o autor o cria e grava a chave à mão, e os módulos só conhecem o nome. O valor nunca passa pelo plano, pelo state nem pelo CI. Só o papel do `llm-proxy` tem `ssm:GetParameter` nesse caminho; nenhum papel de CI o lê, e o papel `plan` tem negação explícita (decisão do autor na #126). Chaves diferentes por ambiente, cada uma num workspace do Console com limite de gasto próprio. Rotação em `docs/runbooks/rotacao-de-segredos.md`.
- **Rollback.** O workflow de produção recebe o SHA a publicar; rollback é dispará-lo com o SHA anterior. Documentado em `docs/runbooks/rollback.md`. Mudanças no formato do design são compatíveis com a versão anterior (`schemaVersion` + leitura tolerante).

### Travas contra destruição da infra

Exigência do autor no Gate 2: nenhum agente pode apagar a infra por acidente. As travas são em camadas, para que a falha de uma não baste:

| Camada | Trava |
|---|---|
| Agente | Nunca roda `apply`, `destroy`, `import` nem comandos de estado; o hook do repositório bloqueia. O papel `plan` usado em PR é só leitura |
| Código | `lifecycle { prevent_destroy = true }` em tudo que guarda dado ou identidade: tabela DynamoDB, User Pool do Cognito, buckets, zona do Route 53, papéis IAM das funções. O parâmetro do SSM é criado à mão e não é recurso do Terraform |
| Serviço | Proteção contra exclusão ligada na tabela DynamoDB e no User Pool; versionamento nos buckets; PITR na tabela de produção |
| CI | Um passo `plan-guard` lê o plano em JSON e reprova o PR se houver `delete` ou `replace` em qualquer recurso. Só o autor libera, com a label `infra:destroy-approved`, e o PR recebe `needs-human` |
| IAM | Os papéis `apply-staging` e `apply-production` têm negação explícita para `dynamodb:DeleteTable`, `cognito-idp:DeleteUserPool`, `s3:DeleteBucket` e `route53:DeleteHostedZone`. Mesmo um plano destrutivo aprovado por engano falha no apply |
| Estado | Bucket de estado com versionamento, criado no `infra/bootstrap/`, que agentes não tocam |
| Revisão | PR de infra é pequeno (um módulo por PR) e passa pelo `devops-reviewer` |

Remover um recurso com dado de propósito exige, nesta ordem: PR que tira o `prevent_destroy`, label do autor, e o autor apagando o recurso à mão, porque o papel de apply não consegue.

### Guardrails de custo

Divisão combinada no Gate 1: a aplicação se protege sozinha de consumo sem limite, que é requisito de segurança (OWASP LLM10); tudo o que é configuração de custo na conta AWS é feito à mão pelo autor.

**Na aplicação (código, coberto por teste):**

| Guardrail | Como |
|---|---|
| Quotas | 5/dia por usuário e 30/dia global, atômicas no DynamoDB |
| Tamanho da entrada | Descrição até 2.000 caracteres, até 100 blocos, `doc` até 350 KB, 50 designs por usuário |
| Chamada à LLM | `max_tokens` fixo; timeout de 29 s no proxy e 10 s na API |
| Interruptor | Variável `LLM_ENABLED`: com `false`, o proxy responde 503 sem chamar a Claude API |

**Na conta AWS (autor, manual, guiado por `docs/runbooks/guardrails-de-custo.md`):**

| Guardrail | Observação |
|---|---|
| AWS Budgets com alertas e ação de corte | O Budgets não desliga Lambda nativamente. A ação nativa mais simples é aplicar uma política IAM de negação ao papel do `llm-proxy`, sem código extra |
| Concorrência reservada do proxy | Contas novas costumam nascer com limite de 10 execuções concorrentes e a AWS exige manter 100 não reservadas; nesse caso não dá para reservar. Alternativa: limite de taxa por rota no API Gateway |
| Limite de gasto do workspace da Anthropic | Único teto real do gasto com a LLM |
| Retenção de logs, lifecycle do S3 | Valores sugeridos no runbook: 7 dias; apagar versões antigas e multipart incompleto |

Os dados do Budgets atrasam horas: ele é rede de segurança, não controle em tempo real. O controle em tempo real são as quotas.

### Custo de infra em três cenários

Valores a calibrar na Price List API (pendência 2 do discovery); ordem de grandeza.

| Cenário | Uso | Infra/mês | LLM/mês (Haiku 5.5) |
|---|---|---|---|
| Lançamento | 1 usuário, ~100 estimativas | US$ 0,50 a 2,50 | ~US$ 0,15 |
| 6 meses | ~50 usuários ativos, ~1.000 estimativas | US$ 1 a 3 | ~US$ 1,40 |
| Gatilho de revisão | ~1.000 usuários ativos, quota global cheia | US$ 2 a 6 | ~US$ 1,30 (até ~US$ 3,30 no pior caso) |

Nos três a infra fica abaixo do teto de US$ 20. O que escala com uso é a LLM, e ela tem teto próprio: com a quota global de 30/dia (#384) são no máximo 930 estimativas por mês, então o cenário de 6 meses também fica limitado a esse número.

## Segurança

**Ativos:** a chave da Claude API; o dinheiro do autor (fatura AWS e créditos); e-mails dos usuários; designs salvos; a integridade dos arquivos de preço.

**Superfícies:** cadastro aberto no Cognito; API autenticada; proxy da LLM; arquivo JSON aberto no navegador; pipeline de CI e de preços.

| # | Ameaça | Mitigação |
|---|---|---|
| T1 | Abuso de custo: contas descartáveis esgotando a LLM (OWASP LLM10) | Quota por usuário e global, limite de tamanho da entrada, `max_tokens` fixo, interruptor `LLM_ENABLED`; na conta, limite de gasto do workspace e ação do Budgets |
| T2 | Prompt injection pela descrição de carga ou por rótulos de bloco (LLM01, LLM05) | Texto do usuário só como dado; sem ferramentas e sem segredos no contexto; saída por schema numérico; revalidação de ids, chaves e faixas; nenhum texto da LLM é exibido |
| T3 | Acesso ao design de outro usuário (A01) | Chave de partição derivada só do `sub` do JWT; teste de API cobrindo acesso cruzado |
| T4 | XSS por design importado ou rótulo malicioso | zod valida o arquivo antes de entrar no estado; rótulos renderizados como texto; CSP no CloudFront |
| T5 | Vazamento da chave ou de credencial de CI | SSM SecureString lido só pelo proxy; OIDC sem chave estática; gitleaks no PR; log sem cabeçalhos, sem corpo e sem e-mail |
| T6 | Adulteração dos preços | Preço entra por PR revisado; testes de cenário reprovam desvio; papel `prices` só lê a Price List API |

**LGPD:** o único dado pessoal é o e-mail, guardado no Cognito. A política de privacidade declara a hospedagem em us-east-1 e o envio da descrição de carga à Anthropic, e orienta a não pôr dado pessoal na descrição. Exclusão de conta apaga designs, quotas e o usuário. Logs sem e-mail, com retenção de 7 dias. Issues de auth, conta e proxy levam `security:sensitive`.

**Riscos aceitos pelo autor no Gate 1:**

- Sem WAF (custo fixo). O cadastro aberto pode ser usado para disparar e-mails de verificação a terceiros; o limite diário de envio do remetente padrão do Cognito contém o volume.
- Cadastro aberto em produção com o remetente padrão do Cognito (aceito pelo autor em 25/11/2026, #139). Dois efeitos conhecidos: a cota é de 50 e-mails por dia por conta AWS, não ajustável e dividida com o staging, e qualquer pessoa pode esgotá-la pelo `client_id` público, o que suspende verificação e recuperação de senha até as 09:00 UTC; e o `SignUp` revela se um e-mail já tem conta. Saídas, se o volume crescer: fechar o cadastro (uma linha em `infra/envs/production/terraform.tfvars`) ou adotar o SES, que cria custo e exige ADR novo.
- Staging e produção na mesma conta AWS, separados por papéis e nomes, não por conta.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Stack padrão da casa (.NET + PostgreSQL ou NestJS + Firebase) | Postgres gerenciado tem custo fixo, que o orçamento proíbe; Firebase tiraria o projeto da AWS, que é o objeto de estudo. O backend é pequeno o bastante para o desvio não pesar na manutenção. |
| Next.js | Não há SSR nem rota de servidor; exigiria runtime além de S3 + CloudFront. |
| Motor de preço no backend | Quebra o modo anônimo sem backend e põe custo por recálculo. |
| ECS/Fargate + RDS + ALB | US$ 70 a 110/mês com zero tráfego. |
| Secrets Manager | US$ 0,40 por segredo/mês; SSM standard é gratuito e basta para uma chave. |
| CloudFormation/CDK + CodePipeline | O padrão da casa é Terraform + GitHub Actions, e o export do produto também gera Terraform. |
| Publicar preços direto no S3 pelo cron | Seria deploy em produção sem humano, exceção à regra da casa. |
| Chamar a Claude API do navegador | Exporia a chave. |
| Fila (SQS + worker) para a chamada da LLM | Sem necessidade medida; ver "Decisões do Gate 1". |

## Consequências

- Custo fixo mensal de US$ 0,50. O resto é proporcional ao uso e fica no free tier no lançamento.
- A regra de negócio fica no cliente. Qualquer pessoa pode ler e alterar o cálculo no próprio navegador, o que é aceitável porque o resultado é uma estimativa para ela mesma. Nada que custe dinheiro ou toque dado de outro usuário é decidido no cliente.
- Dois ecossistemas (TypeScript e Python) para um desenvolvedor. Ambos são comuns e têm guia na casa.
- Preço em produção depende de deploy manual. Aceitável com cadência semanal.
- Cold start de Lambda com FastAPI na primeira chamada. Aceitável sem requisito de latência.
- Sem VPC, não há como criar NAT Gateway nem recurso com custo por hora por acidente.

## Manutenibilidade

Mantido pelo autor. O motor de preço é TypeScript puro com testes de cenário, que é onde os bugs custam mais. Adicionar um bloco novo é um tipo em `features/pricing/model`, um arquivo de preço e um filtro em `pricing/`, sem tocar no backend.

## Decisões do Gate 1

| Ponto | Decisão |
|---|---|
| Modelo e quota global | `claude-haiku-5-5`, 300/dia global, 20/dia por usuário. **Revisto pelo autor em 26/11/2026 (#384): 30/dia global, 5/dia por usuário** (ver "Modelo da LLM e custo por chamada") |
| SQS + worker Lambda | Fora do MVP. O API Gateway HTTP API corta a integração em 30 s; se a medição na Issue do proxy mostrar p95 acima de 20 s, a fila com polling entra por ADR novo, com aviso ao autor |
| Preços | Por PR aberto pelo workflow semanal, não por publicação direta no S3 |
| Uso por aresta | A LLM devolve `gbPerMonth` por aresta; egress do API Gateway fora do MVP |
| Riscos aceitos | Sem WAF; staging e produção na mesma conta; cadastro aberto com o remetente padrão do Cognito |
| Configuração de custo na AWS | Manual, pelo autor (ver "Guardrails de custo") |
| Adapter ASGI → Lambda | Mangum ou AWS Lambda Web Adapter, decidido na Issue do esqueleto com checagem de manutenção e de supply chain. Decidido em #7: Mangum, ver `api/README.md` |

**Regra de trabalho deste projeto:** os agentes decidem sozinhos o que couber neste ADR e no teto de US$ 20/mês de hospedagem. Qualquer decisão que envolva valores (serviço pago novo, mudança de modelo ou de quota, custo fixo) ou algo não previsto aqui é comunicada ao autor no PR, na seção "Decisões tomadas sem humano"; se criar custo, a Issue recebe `needs-human` antes do merge.

## Pendências do discovery

| Pendência | Situação |
|---|---|
| JSON de bloco Lambda e S3 | Proposto em "Modelo de dados"; autor confirma ou substitui |
| Preços de ALB e NAT Gateway | Não bloqueia: a infra não usa nenhum dos dois. Vira critério de aceite da Issue do pipeline de preços |
| Campos fora do JSON no DynamoDB | Proposto em "Modelo de dados" |
| Seção de segredos do `devops-standards` | Aplicada em "Hospedagem e ambientes" |
| Créditos do Ultra e workspace com limite | Tarefa do autor; Issue `needs-human`; bloqueia só o uso real do proxy |
| Condições do Free Tier | Tarefa do autor; Issue `needs-human` |
| Domínio | Tarefa do autor; Issue `needs-human`; bloqueia só as Issues de DNS, ACM e Cognito |
