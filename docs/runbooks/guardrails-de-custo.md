# Runbook — guardrails de custo

Tudo o que o autor configura na conta AWS e no Console da Anthropic para que o projeto fique abaixo do teto de US$ 20/mês de hospedagem e do limite de gasto da Claude API. Nenhuma configuração de custo é automatizada, por decisão do Gate 1 ([ADR-0001](../architecture/aws-cost-playground/ADR-0001-stack.md), seção "Guardrails de custo"). Dois valores são variáveis dos módulos de infra, com o valor escolhido pelo autor em cada ambiente: o limite de taxa (#19) e a retenção de logs (#18). Para esses, o runbook diz o valor sugerido e como conferir.

Os guardrails que vivem no código (quotas, limites de entrada, `max_tokens`, timeouts) estão no ADR e não são configurados aqui.

## Antes de começar

- **Quem:** o autor, com acesso de administrador à conta AWS e de administrador da organização no Console da Anthropic.
- **Quando:** por ambiente, depois do primeiro `apply` dele e antes de liberar o uso. Staging primeiro; produção antes de gravar a chave real no SSM de produção. Repita a cada troca de modelo ou de quota da LLM e na revisão mensal (seção "Verificação mensal").
- **Pré-requisito:** a infra do ambiente já aplicada (funções, papéis e buckets existem). Se o papel de produção ainda não existir, crie a ação do Budgets só com o de staging e acrescente o de produção depois (passos 4 e 5).
- **Placeholders:** tudo entre `< >` é substituído na hora de rodar e nunca é escrito de volta neste arquivo, em Issue ou em commit. `<ACCOUNT_ID>` é o id da conta; `<env>` é `staging` ou `production`. Os nomes reais de função, papel, API e bucket saem do `terraform output` de cada ambiente.

> **Drift com o Terraform.** O `apply` volta ao valor do código todo atributo que o Terraform gerencia, mesmo os que o módulo não declara. Exemplos: a concorrência reservada da Lambda (o padrão é "sem reserva"), as variáveis de ambiente e as políticas do papel, se o módulo usar anexação exclusiva. Staging é aplicado a cada merge em `main`, e o `plan-guard` só barra `delete` e `replace`: a reversão é silenciosa. Por isso:
>
> - o que é variável do Terraform (limite de taxa, retenção de logs) muda por PR, nunca só no console;
> - o que é manual só sobrevive se o módulo deixar o atributo em paz. Os requisitos para o módulo das funções estão comentados na #18: ignorar `reserved_concurrent_executions`, não usar anexação exclusiva de políticas no papel do proxy (senão o `apply` desfaz o corte do Budgets) e manter estável o nome do papel, para o qual a ação do Budgets aponta;
> - confira o plano de **todo** PR de infra. Se um desses atributos aparecer como alteração, não faça merge: abra Issue. Durante um corte, confira depois de cada `apply` que a política continua anexada (`aws iam list-attached-role-policies`).

## Resumo

| # | Guardrail | Onde | Valor sugerido |
|---|---|---|---|
| 1 | Quota de concorrência da conta | Lambda / Service Quotas | Verificar; reservar 2 (prod) e 1 (stg) no `llm-proxy` se a conta permitir |
| 2 | Limite de taxa | Variável do módulo do API Gateway (#19) | `POST /estimates`: 1 req/s, rajada 5. Demais rotas: 10 req/s, rajada 20 |
| 3 | Política de negação do `llm-proxy` | IAM | `acp-llm-proxy-corte` |
| 4 | Papel de execução do Budgets | IAM | `acp-budgets-acao` |
| 5 | Orçamento, alertas e ação de corte | AWS Budgets | US$ 20/mês; alertas em 25%, 50% e 100% previsto; corte em 80% real |
| 6 | Retenção de logs | Variável do módulo das funções (#18); conferir no CloudWatch Logs | 7 dias |
| 7 | Lifecycle | S3 (site e artefatos) | Versões antigas após 30 dias, mantendo as 3 mais novas; multipart incompleto após 7 dias |
| 8 | Limite de gasto | Console da Anthropic, por workspace | production US$ 20/mês; staging US$ 5/mês |

## 1. Quota de concorrência da conta

Contas novas nascem com quota de concorrência reduzida (o ADR cita 10), e a AWS exige manter pelo menos 100 execuções não reservadas. Nesse caso não dá para reservar concorrência, e o limite de taxa do passo 2 é a contenção.

```bash
aws lambda get-account-settings \
  --query 'AccountLimit.[ConcurrentExecutions,UnreservedConcurrentExecutions]'
```

- **`ConcurrentExecutions` ≥ 103:** reserve concorrência no `llm-proxy` de cada ambiente. Ela limita quantas chamadas à Claude API rodam ao mesmo tempo.

  ```bash
  aws lambda put-function-concurrency --function-name <função-llm-proxy-prod> --reserved-concurrent-executions 2
  aws lambda put-function-concurrency --function-name <função-llm-proxy-stg> --reserved-concurrent-executions 1
  ```

  A reserva só dura se o módulo das funções ignorar `reserved_concurrent_executions` (ver "Drift com o Terraform"). Confira depois de cada `apply` com `aws lambda get-function-concurrency --function-name <função>`.

  Com a reserva, o gargalo real passa a ser a Lambda, não o limite de taxa do passo 2. Uma estimativa pode levar até 29 s, então duas simultâneas já ocupam a reserva de produção, e a terceira recebe erro (nem o 429 do API Gateway, nem o 503 tratado). Com um usuário no lançamento, isso é aceitável; suba a reserva se aparecer erro de throttle no alarme do proxy.

- **Limite menor:** não reserve. Se quiser, peça aumento em Service Quotas → AWS Lambda → "Concurrent executions" (código `L-B99A9384`; o pedido é gratuito) e volte a este passo quando aprovado.

Concorrência reservada não tem custo; a **provisionada** é cobrada e seria custo fixo, proibido pelo ADR.

## 2. Limite de taxa no API Gateway

O limite por rota é variável do módulo do API Gateway (#19), com valor por ambiente em `infra/envs/<env>`. Mude por PR: o que for mudado só no console volta no próximo `apply`.

Valores sugeridos, iguais nos dois ambientes: `POST /estimates` com 1 req/s e rajada 5; demais rotas com 10 req/s e rajada 20. A quota global é de 300 estimativas por dia. Com 1 req/s sobra folga para o uso legítimo, e as invocações do proxy ficam limitadas sob abuso. Requisição acima do limite recebe 429 sem invocar a Lambda.

O limite é da rota, não de cada usuário: um usuário insistente pode fazer os outros receberem 429. Com um usuário no lançamento, isso é aceitável; reveja se aparecer reclamação.

**Conferir** depois do deploy de cada ambiente:

`<API_ID>` sai do `terraform output` do ambiente (ou da lista de `aws apigatewayv2 get-apis --query 'Items[].[Name,ApiId]' --output table`).

```bash
aws apigatewayv2 get-routes --api-id <API_ID> --query 'Items[].RouteKey'
aws apigatewayv2 get-stage --api-id <API_ID> --stage-name '<stage>' \
  --query '[DefaultRouteSettings,RouteSettings]'
```

`<stage>` costuma ser `$default` (as aspas simples evitam que o shell expanda o `$`). Cada chave de `RouteSettings` precisa ser idêntica a um `RouteKey` da lista, por exemplo `POST /estimates`. Uma chave diferente é aceita e não tem efeito.

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

Com ela anexada, o proxy perde toda chamada à AWS, exceto escrever log: não lê a chave no SSM e não consome a quota no DynamoDB. A quota é consumida **antes** da chamada à Claude API: é a ordem do ADR ("Fluxo da estimativa de carga", passo 2) e um critério de aceite da rota de estimativa (#62). Por isso a requisição falha antes de chegar à Anthropic, mesmo num ambiente quente que já tenha a chave em memória. Isso só vale se o proxy **falhar fechado**: um erro do DynamoDB ao consumir a quota, inclusive `AccessDenied`, precisa encerrar a requisição sem chamar a LLM (pedido comentado na #62). Os logs continuam, para diagnosticar. Durante o corte, `GET /quota`, que também vai para o proxy (#19), falha junto.

**Teste em staging antes de confiar no corte:**

```bash
aws iam attach-role-policy --role-name <papel-llm-proxy-stg> \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/acp-llm-proxy-corte
# Faça uma estimativa com uma conta de teste: deve falhar, e o uso no Console da Anthropic não muda.
aws iam detach-role-policy --role-name <papel-llm-proxy-stg> \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/acp-llm-proxy-corte
```

A mudança de IAM leva alguns segundos para valer. Este teste prova a política, não o Budgets: o teste ponta a ponta fica no fim do passo 5. Se o fluxo do proxy mudar (por exemplo, chamar a LLM antes de consumir a quota), refaça os dois testes.

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
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "<ACCOUNT_ID>" },
        "ArnLike": { "aws:SourceArn": "arn:aws:budgets::<ACCOUNT_ID>:budget/*" }
      }
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

A condição na trust policy evita que outra conta use o Budgets para assumir o papel (confused deputy). Não há política gerenciada que sirva aqui: a do papel de execução do Budgets só cobre EC2 e RDS e não tem `iam:AttachRolePolicy`. Quem cria a ação no console precisa de `iam:PassRole` para este papel; o administrador da conta já tem.

## 5. AWS Budgets: orçamento, alertas e ação de corte

Billing and Cost Management → Budgets → Create budget → Customize → Cost budget.

1. **Orçamento:** nome `acp-conta-mensal`, período mensal, recorrente, valor fixo de US$ 20, escopo de todos os serviços (staging e produção dividem a conta).
2. **Créditos fora da conta:** o orçamento inclui créditos por padrão (`IncludeCredit` é `true` na API). Com créditos incluídos, o gasto medido cai pelo valor dos créditos e os alertas atrasam ou não disparam enquanto eles duram. Em Budget scope, exclua o tipo de cobrança *Credit* (e *Refund*) e não use a agregação *net unblended*, que já desconta créditos.
3. **Alertas por e-mail** (para `<seu-e-mail>`):

   | Gatilho | Limite | Para quê |
   |---|---|---|
   | Real | 25% (US$ 5) | O gasto esperado é de US$ 0,50 a 6/mês; passar disso merece olhar |
   | Real | 50% (US$ 10) | Investigar no mesmo dia |
   | Previsto | 100% (US$ 20) | O mês vai estourar se nada mudar |

   O alerta de previsão só funciona depois de cerca de 5 semanas de histórico de uso na conta. Até lá, quem cobre são os alertas de gasto real e o corte.

4. **Ação** (Attach actions):
   - Tipo: IAM policy; política `acp-llm-proxy-corte`; papéis `<papel-llm-proxy-stg>` e `<papel-llm-proxy-prod>`.
   - Gatilho: custo **real** em **80%** (US$ 16).
   - Papel de execução: `acp-budgets-acao`.
   - Execução: **automática**, sem aprovação. Notificar o mesmo e-mail.

Os dados do Budgets atualizam até três vezes por dia, com 8 a 12 horas entre uma atualização e outra: ele é rede de segurança, não controle em tempo real. Por isso o corte é em 80%, e não em 100%. O controle em tempo real são as quotas no código.

Custo: monitorar e alertar é gratuito, e os dois primeiros orçamentos com ação também; este runbook usa um. Do terceiro em diante, cada orçamento com ação custa US$ 0,10 por dia.

**Teste ponta a ponta do corte (staging, uma vez):** o teste do passo 3 não prova que o Budgets consegue assumir `acp-budgets-acao`. Se a trust policy estiver errada, o corte só falha no dia em que for necessário.

1. Confira que `acp-conta-mensal` é o único orçamento com ação na conta; com o de teste, serão dois, ainda gratuitos.
2. Crie `acp-teste-corte`, mensal, com valor fixo **abaixo** do gasto real já registrado no mês (veja no Cost Explorer; se o gasto for zero, espere haver algum).
3. Anexe uma ação igual à do item 4, mas só com `<papel-llm-proxy-stg>`, gatilho real em 100% e execução automática.
4. Espere a próxima atualização do Budgets (até 12 horas). Confira que a ação executou, que a política aparece em `aws iam list-attached-role-policies --role-name <papel-llm-proxy-stg>` e que uma estimativa em staging falha.
5. No mesmo dia, reverta a ação com o passo 2 de "Reverter o corte do Budgets", trocando o nome por `--budget-name acp-teste-corte`. Confira com `list-attached-role-policies` que a política saiu de `<papel-llm-proxy-stg>` e **apague** `acp-teste-corte`, para não esquecer uma ação que corta staging.

**Importante:** o gasto com a Claude API não aparece na fatura da AWS, e o Budgets não o vê. O teto da LLM é o passo 8.

## 6. Retenção de logs

7 dias em todos os grupos de log do projeto: limita custo e cumpre a LGPD (ADR, seção "Segurança"). O módulo das funções (#18) cria um grupo por função com a retenção por variável. Defina 7 em cada ambiente e mude por PR. Aqui você só confere.

```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/acp- \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output table
```

Confira também o grupo do log de acesso do API Gateway (#19; retenção por variável e nome no `terraform output` foram pedidos em comentário na Issue). Se um grupo estiver sem retenção ou com valor diferente de 7:

- **ele está no Terraform:** corrija a variável por PR;
- **ele não está:** foi criado pela própria AWS (a Lambda cria o seu na primeira invocação, se o Terraform não o criou antes). Ajuste com `aws logs put-retention-policy --log-group-name <grupo> --retention-in-days 7` e abra Issue para o módulo passar a criá-lo.

## 7. Lifecycle do S3

Nos buckets do site e de artefatos de cada ambiente. **Não** aplique no bucket de estado do Terraform: ele é do `infra/bootstrap/`, e as versões antigas são a proteção do estado.

Nenhum módulo declara lifecycle hoje (o do site, #14, não declara). Se um passar a declarar, ele vence, e esta configuração manual sai.

`put-bucket-lifecycle-configuration` substitui a configuração inteira. Veja antes se já existe alguma regra e, se existir, junte as duas no mesmo arquivo:

```bash
aws s3api get-bucket-lifecycle-configuration --bucket <bucket>
```

O erro `NoSuchLifecycleConfiguration` quer dizer só que o bucket ainda não tem regra.

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

Consequência: o versionamento é uma das travas contra destruição do ADR, e com esta regra a janela de recuperação desses buckets cai para 30 dias, com as 3 versões mais novas sempre guardadas. O impacto é baixo, porque o site e os artefatos são reconstruídos a partir do repositório; o dado real fica no DynamoDB, com PITR em produção.

## 8. Limite de gasto do workspace da Anthropic

É o único teto real do gasto com a LLM. Cada ambiente tem o seu workspace e a sua chave (ADR, "Hospedagem e ambientes").

1. Console da Anthropic (`platform.claude.com`) → Settings → Workspaces → crie `acp-staging` e `acp-production`, se ainda não existirem. Não use o Default Workspace: o limite dele pode não contar parte do uso.
2. Settings → Spend limits → em **Workspace limits**, escolha o workspace na lista → Set limit. Valores: **production US$ 20/mês** (o pior caso com a quota global cheia é cerca de US$ 13 com `claude-haiku-5-5`) e **staging US$ 5/mês**.
3. Confira que a chave de cada ambiente tem escopo do workspace certo (ver [rotação de segredos](rotacao-de-segredos.md)). Uma chave sem escopo de workspace não fica sob o limite.

Ao atingir o limite, a Claude API recusa as chamadas daquele workspace até o mês virar ou o limite subir; o proxy devolve erro tratado. Trocar de modelo muda o custo em até 40 vezes: antes de qualquer troca, refaça a conta e reveja este limite.

## Interruptor manual: `LLM_ENABLED=false`

Use quando houver suspeita de abuso, chave vazada, gasto sem explicação ou o workspace perto do limite. Com `false`, o proxy responde 503 sem chamar a Claude API; o editor, o modo anônimo e os designs salvos continuam funcionando.

**Desligar (emergência):**

1. Lambda → `<função-llm-proxy>` do ambiente → Configuration → Environment variables → Edit.
2. Mude só `LLM_ENABLED` para `false` e salve.
3. Confira: uma estimativa com conta de teste recebe 503, e o uso no Console da Anthropic para de subir.

Não use `aws lambda update-function-configuration --environment` para isso: o comando substitui **todas** as variáveis da função pelas que você passar.

**Por quanto tempo vale:** até o próximo `apply` daquele ambiente, que volta o valor do Terraform (em staging, o próximo merge em `main`; em produção, o próximo deploy disparado). Enquanto o proxy precisar ficar desligado, não faça merge em `main` nem dispare o deploy de produção. Se for durar mais de um dia, abra um PR que mude a variável no Terraform do ambiente.

**Religar:** volte `LLM_ENABLED` para `true` no console (ou reverta o PR) e faça uma estimativa de teste.

**Plano B**, se o interruptor não responder: o botão Throttle da função (concorrência reservada 0) bloqueia todas as invocações, e o cliente recebe erro em vez do 503 tratado. Desfaça com `aws lambda delete-function-concurrency --function-name <função>` e, se a função tinha concorrência reservada (passo 1), aplique de novo o valor anterior.

## Reverter o corte do Budgets

**Sintoma:** o e-mail do Budgets avisa que a ação rodou, e os logs do proxy mostram `AccessDenied`.

**Atenção:** depois de revertida, o Budgets não avalia mais a ação no resto do período. O corte fica **desarmado até o mês virar**, e o que protege no resto do mês são as quotas, o limite de taxa, o limite do workspace da Anthropic e o interruptor `LLM_ENABLED`.

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
   aws iam list-attached-role-policies --role-name <papel-llm-proxy-stg>
   aws iam list-attached-role-policies --role-name <papel-llm-proxy-prod>
   ```

   Se ela ainda estiver lá, desanexe à mão com `aws iam detach-role-policy` (mesmos argumentos do teste do passo 3).

4. **Teste** uma estimativa com conta de teste em cada ambiente.
5. **Decida o resto do mês:** o gasto continua acima de 80%. Se a causa foi resolvida e o mês ainda cabe no teto, siga; se não, mantenha `LLM_ENABLED=false` até o mês virar. Para rearmar o corte no mesmo mês há `--execution-type RESET_BUDGET_ACTION`, mas com o gasto acima do limite ele dispara de novo: só faz sentido depois de subir o limite do corte. Mudar o valor do orçamento ou o limite do corte é decisão do autor, registrada no ADR.

## Verificação mensal

- [ ] Fatura do mês anterior abaixo de US$ 20, e o gasto da Anthropic abaixo do limite de cada workspace.
- [ ] `acp-conta-mensal` com os 3 alertas e a ação em espera (`STANDBY`) no começo do mês. Se ela ainda estiver revertida, rearme com `RESET_BUDGET_ACTION`.
- [ ] Os papéis da ação existem e batem com o `terraform output` de cada ambiente.
- [ ] No máximo 2 orçamentos com ação na conta (do terceiro em diante há custo diário).
- [ ] `acp-llm-proxy-corte` **não** anexada a nenhum papel fora de um corte em andamento.
- [ ] Todos os grupos de log `acp-` com retenção de 7 dias.
- [ ] Throttling dos stages, lifecycle dos buckets e concorrência reservada iguais aos deste runbook (nada desfeito por `apply`).
- [ ] `LLM_ENABLED=true` nos dois ambientes, a menos que tenha sido desligado de propósito.
