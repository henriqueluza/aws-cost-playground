# Runbook — guardrails de custo

Tudo o que o autor configura **à mão** na conta AWS e no Console da Anthropic para que o projeto fique abaixo do teto de US$ 20/mês de hospedagem e do limite de gasto da Claude API. Nenhum item deste runbook é automatizado, por decisão do Gate 1 ([ADR-0001](../architecture/aws-cost-playground/ADR-0001-stack.md), seção "Guardrails de custo").

Os guardrails que vivem no código (quotas, limites de entrada, `max_tokens`, timeouts) estão no ADR e não são configurados aqui.

## Antes de começar

- **Quem:** o autor, com acesso de administrador à conta AWS e de administrador da organização no Console da Anthropic.
- **Quando:** antes do primeiro deploy de produção; de novo a cada troca de modelo ou de quota da LLM; e na revisão mensal (seção "Verificação mensal").
- **Pré-requisito:** a infra de cada ambiente já aplicada (funções, papéis e buckets existem).
- **Placeholders:** tudo entre `< >` é substituído na hora de rodar e nunca é escrito de volta neste arquivo, em Issue ou em commit. `<ACCOUNT_ID>` é o id da conta; `<env>` é `staging` ou `production`; `<pfx>` é `acp-stg` ou `acp-prod`. Os nomes reais de função, papel, API e bucket saem do `terraform output` de cada ambiente.

> **Drift com o Terraform.** Se um módulo declarar o mesmo atributo que este runbook configura à mão (retenção de log, throttling do stage, lifecycle, concorrência reservada, variável de ambiente), o próximo `apply` volta o valor do código sem avisar. Staging é aplicado a cada merge em `main`. Depois de configurar, confira no plano do próximo PR de infra se algum desses atributos aparece como alteração; se aparecer, abra Issue para o módulo ignorar o atributo (`lifecycle { ignore_changes = [...] }`).

## Resumo

| # | Guardrail | Onde | Valor sugerido |
|---|---|---|---|
| 1 | Quota de concorrência da conta | Lambda / Service Quotas | Verificar; reservar 2 (prod) e 1 (stg) no `llm-proxy` se a conta permitir |
| 2 | Limite de taxa | API Gateway, stage de cada ambiente | `POST /estimates`: 1 req/s, rajada 5. Demais rotas: 10 req/s, rajada 20 |
| 3 | Política de negação do `llm-proxy` | IAM | `acp-llm-proxy-corte` |
| 4 | Papel de execução do Budgets | IAM | `acp-budgets-acao` |
| 5 | Orçamento, alertas e ação de corte | AWS Budgets | US$ 20/mês; alertas em 25%, 50% e 100% previsto; corte em 80% real |
| 6 | Retenção de logs | CloudWatch Logs | 7 dias |
| 7 | Lifecycle | S3 (site e artefatos) | Versões antigas após 30 dias, mantendo as 3 mais novas; multipart incompleto após 7 dias |
| 8 | Limite de gasto | Console da Anthropic, por workspace | production US$ 20/mês; staging US$ 5/mês |

## 1. Quota de concorrência da conta

Contas novas costumam nascer com limite de 10 execuções concorrentes, e a AWS exige manter 100 não reservadas. Nesse caso não dá para reservar concorrência, e o limite de taxa do passo 2 é a contenção.

```bash
aws lambda get-account-settings \
  --query 'AccountLimit.[ConcurrentExecutions,UnreservedConcurrentExecutions]'
```

- **`ConcurrentExecutions` ≥ 103:** reserve concorrência no `llm-proxy` de cada ambiente. Ela limita quantas chamadas à Claude API rodam ao mesmo tempo.

  ```bash
  aws lambda put-function-concurrency --function-name <função-llm-proxy-prod> --reserved-concurrent-executions 2
  aws lambda put-function-concurrency --function-name <função-llm-proxy-stg> --reserved-concurrent-executions 1
  ```

- **Limite menor:** não reserve. Se quiser, peça aumento em Service Quotas → AWS Lambda → "Concurrent executions" (o pedido é gratuito) e volte a este passo quando aprovado.

Não confunda com **concorrência provisionada** (provisioned concurrency): ela é cobrada por hora e seria custo fixo, que o ADR proíbe.

## 2. Limite de taxa no API Gateway

O HTTP API aceita limite padrão no stage e limite por rota. A quota global é de 300 estimativas por dia; 1 requisição por segundo em `POST /estimates` sobra para o uso legítimo e limita as invocações do proxy sob abuso.

```bash
aws apigatewayv2 get-apis --query "Items[?starts_with(Name, '<pfx>')].[Name,ApiId]" --output table

aws apigatewayv2 update-stage --api-id <API_ID> --stage-name '<stage>' \
  --default-route-settings ThrottlingBurstLimit=20,ThrottlingRateLimit=10 \
  --route-settings '{"POST /estimates":{"ThrottlingBurstLimit":5,"ThrottlingRateLimit":1}}'

aws apigatewayv2 get-stage --api-id <API_ID> --stage-name '<stage>' \
  --query '[DefaultRouteSettings,RouteSettings]'
```

`<stage>` costuma ser `$default` (as aspas simples evitam que o shell expanda o `$`). Repita para os dois ambientes. Requisição acima do limite recebe 429 sem invocar a Lambda.

## 3. Política de negação do `llm-proxy`

É a política que o Budgets anexa ao papel do `llm-proxy` quando o gasto passa do limite. O Budgets não desliga Lambda; ele só sabe anexar política IAM.

IAM → Policies → Create policy → JSON, nome `acp-llm-proxy-corte`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CorteDoBudgets",
      "Effect": "Deny",
      "NotAction": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "*"
    }
  ]
}
```

Com ela anexada, o proxy perde toda chamada à AWS, exceto escrever log: não lê a chave no SSM e não consome a quota no DynamoDB. Como a quota é consumida **antes** da chamada à Claude API (ADR, "Fluxo da estimativa de carga", passo 2), a requisição falha antes de chegar à Anthropic, mesmo num ambiente quente que já tenha a chave em memória. Os logs continuam, para diagnosticar.

**Teste em staging antes de confiar no corte:**

```bash
aws iam attach-role-policy --role-name <papel-llm-proxy-stg> \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/acp-llm-proxy-corte
# Faça uma estimativa com uma conta de teste: deve falhar, e o uso no Console da Anthropic não muda.
aws iam detach-role-policy --role-name <papel-llm-proxy-stg> \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/acp-llm-proxy-corte
```

A mudança de IAM leva alguns segundos para valer. Se o fluxo do proxy mudar (por exemplo, chamar a LLM antes de consumir a quota), refaça este teste.

## 4. Papel de execução do Budgets

O Budgets precisa de um papel que ele assume para anexar a política. Dê a ele só o necessário: anexar e desanexar **esta** política **nestes** dois papéis.

IAM → Roles → Create role → Custom trust policy, nome `acp-budgets-acao`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "budgets.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": { "StringEquals": { "aws:SourceAccount": "<ACCOUNT_ID>" } }
    }
  ]
}
```

Política em linha do papel:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["iam:AttachRolePolicy", "iam:DetachRolePolicy"],
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/<papel-llm-proxy-stg>",
        "arn:aws:iam::<ACCOUNT_ID>:role/<papel-llm-proxy-prod>"
      ],
      "Condition": {
        "ArnEquals": { "iam:PolicyARN": "arn:aws:iam::<ACCOUNT_ID>:policy/acp-llm-proxy-corte" }
      }
    }
  ]
}
```

Não use a política gerenciada genérica de ações do Budgets: ela também permite parar EC2 e RDS e aplicar SCP na conta inteira.

## 5. AWS Budgets: orçamento, alertas e ação de corte

Billing and Cost Management → Budgets → Create budget → Customize → Cost budget.

1. **Orçamento:** nome `acp-conta-mensal`, período mensal, recorrente, valor fixo de US$ 20, escopo de todos os serviços (staging e produção dividem a conta).
2. **Opções avançadas:** desmarque **Credits** e **Refunds**. Com créditos incluídos, o gasto líquido fica em zero enquanto os créditos duram e nenhum alerta dispara.
3. **Alertas por e-mail** (para `<seu-e-mail>`):

   | Gatilho | Limite | Para quê |
   |---|---|---|
   | Real | 25% (US$ 5) | O gasto esperado é de US$ 0,50 a 6/mês; passar disso merece olhar |
   | Real | 50% (US$ 10) | Investigar no mesmo dia |
   | Previsto | 100% (US$ 20) | O mês vai estourar se nada mudar |

4. **Ação** (Attach actions):
   - Tipo: IAM policy; política `acp-llm-proxy-corte`; papéis `<papel-llm-proxy-stg>` e `<papel-llm-proxy-prod>`.
   - Gatilho: custo **real** em **80%** (US$ 16).
   - Papel de execução: `acp-budgets-acao`.
   - Execução: **automática**, sem aprovação. Notificar o mesmo e-mail.

Os dados do Budgets atrasam horas: ele é rede de segurança, não controle em tempo real. Por isso o corte é em 80%, e não em 100%. O controle em tempo real são as quotas no código.

**Importante:** o gasto com a Claude API não aparece na fatura da AWS, e o Budgets não o vê. O teto da LLM é o passo 8.

## 6. Retenção de logs

7 dias em todos os grupos de log do projeto: limita custo e cumpre a LGPD (ADR, seção "Segurança").

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/acp- \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output table

aws logs put-retention-policy --log-group-name <grupo> --retention-in-days 7
```

Faça o mesmo nos grupos de access log do API Gateway (nome no `terraform output`). A Lambda cria o grupo sozinha, sem retenção, na primeira invocação se ele não existir: rode a listagem de novo depois do primeiro uso de cada função e na verificação mensal.

## 7. Lifecycle do S3

Nos buckets do site e de artefatos de cada ambiente. **Não** aplique no bucket de estado do Terraform: ele é do `infra/bootstrap/`, e as versões antigas são a proteção do estado.

`put-bucket-lifecycle-configuration` substitui a configuração inteira. Veja antes se já existe alguma regra e, se existir, junte as duas no mesmo arquivo:

```bash
aws s3api get-bucket-lifecycle-configuration --bucket <bucket>
```

`lifecycle.json`:

```json
{
  "Rules": [
    {
      "ID": "acp-limpeza",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30, "NewerNoncurrentVersions": 3 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://lifecycle.json
```

A regra apaga só versões **antigas** (não correntes) e uploads incompletos. Os artefatos guardados por SHA continuam: o rollback depende deles.

## 8. Limite de gasto do workspace da Anthropic

É o único teto real do gasto com a LLM. Cada ambiente tem o seu workspace e a sua chave (ADR, "Hospedagem e ambientes").

1. Console da Anthropic → Settings → Workspaces → crie `acp-staging` e `acp-production`, se ainda não existirem.
2. Em cada workspace → Limits → defina o limite mensal de gasto: **production US$ 20** (o pior caso com a quota global cheia é cerca de US$ 13 com `claude-haiku-5-5`) e **staging US$ 5**.
3. Confira que a chave usada por cada ambiente foi criada dentro do workspace certo (ver [rotação de segredos](rotacao-de-segredos.md)).

Ao atingir o limite, a Claude API recusa as chamadas daquele workspace até o mês virar ou o limite subir; o proxy devolve erro tratado. Trocar de modelo muda o custo em até 40 vezes: antes de qualquer troca, refaça a conta e reveja este limite.

## Interruptor manual: `LLM_ENABLED=false`

Use quando houver suspeita de abuso, chave vazada, gasto sem explicação ou o workspace perto do limite. Com `false`, o proxy responde 503 sem chamar a Claude API; o editor, o modo anônimo e os designs salvos continuam funcionando.

**Desligar (emergência):**

1. Lambda → `<função-llm-proxy-<env>>` → Configuration → Environment variables → Edit.
2. Mude só `LLM_ENABLED` para `false` e salve.
3. Confira: uma estimativa com conta de teste recebe 503, e o uso no Console da Anthropic para de subir.

Não use `aws lambda update-function-configuration --environment` para isso: o comando substitui **todas** as variáveis da função pelas que você passar.

**Por quanto tempo vale:** até o próximo `apply` daquele ambiente, que volta o valor do Terraform (em staging, o próximo merge em `main`). Para manter desligado além disso, abra um PR que mude a variável no Terraform do ambiente.

**Religar:** volte `LLM_ENABLED` para `true` no console (ou reverta o PR) e faça uma estimativa de teste.

**Plano B**, se o interruptor não responder: o botão Throttle da função (concorrência reservada 0) bloqueia todas as invocações, e o cliente recebe erro em vez do 503 tratado. Desfaça com `aws lambda delete-function-concurrency --function-name <função>` e, se a função tinha concorrência reservada (passo 1), aplique de novo o valor anterior.

## Reverter o corte do Budgets

**Sintoma:** o e-mail do Budgets avisa que a ação rodou, e os logs do proxy mostram `AccessDenied`.

1. **Entenda a causa antes de reverter.** Cost Explorer → custo por serviço nos últimos dias. Se a causa continua ativa, reverter só devolve o gasto; deixe `LLM_ENABLED=false` enquanto investiga.
2. **Reverta a ação:** Budgets → `acp-conta-mensal` → Actions → selecione a ação → Reverse. Pela CLI:

   ```bash
   aws budgets describe-budget-actions-for-budget --account-id <ACCOUNT_ID> \
     --budget-name acp-conta-mensal --query 'Actions[].[ActionId,Status]'

   aws budgets execute-budget-action --account-id <ACCOUNT_ID> --budget-name acp-conta-mensal \
     --action-id <ACTION_ID> --execution-type REVERSE_BUDGET_ACTION
   ```

3. **Confira** que a política saiu dos dois papéis:

   ```bash
   aws iam list-attached-role-policies --role-name <papel-llm-proxy-prod>
   ```

   Se ela ainda estiver lá, desanexe à mão com `aws iam detach-role-policy` (mesmos argumentos do teste do passo 3).

4. **Teste** uma estimativa com conta de teste em cada ambiente.
5. **Decida o resto do mês:** o gasto continua acima de 80%. Se a causa foi resolvida e o mês ainda cabe no teto, siga; se não, mantenha `LLM_ENABLED=false` até o mês virar. Mudar o valor do orçamento ou o limite do corte é decisão do autor, registrada no ADR.

## Verificação mensal

- [ ] Fatura do mês anterior abaixo de US$ 20, e o gasto da Anthropic abaixo do limite de cada workspace.
- [ ] `acp-conta-mensal` com os 3 alertas e a ação em estado de espera (`STANDBY`).
- [ ] `acp-llm-proxy-corte` **não** anexada a nenhum papel fora de um corte em andamento.
- [ ] Todos os grupos de log `acp-` com retenção de 7 dias.
- [ ] Throttling dos stages e lifecycle dos buckets iguais aos deste runbook (nada desfeito por `apply`).
- [ ] `LLM_ENABLED=true` nos dois ambientes, a menos que tenha sido desligado de propósito.
