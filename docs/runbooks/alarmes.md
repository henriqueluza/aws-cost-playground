# Runbook — alarmes

O que fazer quando um alarme do CloudWatch chega por e-mail. O módulo [`infra/modules/alarms`](../../infra/modules/alarms/README.md) (Issue #20) cria, por ambiente (`acp-stg` e `acp-prod`), o tópico SNS `<prefixo>-alarms` com assinatura por e-mail e 5 alarmes. Todos disparam com soma maior que 0 em 1 período de 5 minutos; dado ausente conta como OK; só há aviso ao entrar em alarme, não ao voltar a OK. Não há dashboards.

**Pendências de outros PRs:** as funções (nomes `<prefixo>-api` e `<prefixo>-llm-proxy`, log group `/aws/lambda/<função>`, variável `LLM_ENABLED` e reserva de concorrência) vêm do módulo `functions` (PR #122, ainda não em `main`); confirme esses nomes no `terraform output` quando ele entrar. O workflow de produção com SHA e `docs/runbooks/rollback.md`, previstos no ADR-0001, também ainda não existem no repositório; até lá, o rollback é decisão do autor.

**Placeholders:** tudo entre `< >` é substituído na hora de rodar e nunca é escrito de volta aqui. `<prefixo>` é `acp-stg` ou `acp-prod`; `<topic_arn>`, `<API_ID>` e os nomes das funções saem do `terraform output` do ambiente. O endereço de e-mail vem de `TF_VAR_alarm_email` e não fica no repositório.

## Antes do primeiro alarme

1. **Confirme a assinatura.** Depois do primeiro `apply` de cada ambiente, a AWS manda um e-mail de confirmação para o endereço de `TF_VAR_alarm_email`. Clique no link. Sem isso nenhum alarme chega.

   ```bash
   aws sns list-subscriptions-by-topic --topic-arn <topic_arn> \
     --query 'Subscriptions[].[Protocol,SubscriptionArn]'
   ```

   `PendingConfirmation` no lugar do ARN quer dizer que o link ainda não foi confirmado.
2. **Custo.** O nível gratuito do CloudWatch cobre 10 alarmes padrão por conta, e os 2 ambientes usam exatamente 10 (5 cada). Qualquer alarme novo custa US$ 0,10/mês e precisa de PR com a decisão registrada em "Decisões tomadas sem humano"; se criar custo, `needs-human`.

## Conferir o estado

```bash
aws cloudwatch describe-alarms \
  --alarm-names <prefixo>-api-errors <prefixo>-llm-proxy-errors \
    <prefixo>-api-throttles <prefixo>-llm-proxy-throttles <prefixo>-http-api-5xx \
  --query 'MetricAlarms[].[AlarmName,StateValue,StateReason]' --output table
```

## `<prefixo>-api-errors` e `<prefixo>-llm-proxy-errors`

- **Significa:** a função (`api` ou `llm-proxy`) terminou uma invocação com erro (exceção não tratada, timeout, falta de memória). Impacto: o usuário vê erro 5xx na rota atendida pela função; no `llm-proxy`, a estimativa de carga falha.
- **Confirmar:**

  ```bash
  aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Errors \
    --dimensions Name=FunctionName,Value=<função> --statistics Sum --period 300 \
    --start-time <início-ISO8601> --end-time <fim-ISO8601>
  ```

  Logs Insights no grupo `/aws/lambda/<função>`:

  ```
  fields @timestamp, @message
  | filter @message like /ERROR|Task timed out|Traceback/
  | sort @timestamp desc
  | limit 20
  ```

- **Mitigar:** se o erro começou após um deploy, faça rollback com o SHA anterior pelo workflow de produção previsto no ADR-0001 (ver pendências acima) e confirme que o alarme sai de `ALARM`. No `llm-proxy`, se a causa for a Claude API ou a chave, desligue com `LLM_ENABLED=false` ([guardrails de custo](guardrails-de-custo.md), "Interruptor manual"). Confira também se o corte do Budgets está ativo: `AccessDenied` nos logs do proxy é o sintoma (passo 5 e "Reverter o corte do Budgets" do mesmo runbook).

## `<prefixo>-api-throttles` e `<prefixo>-llm-proxy-throttles`

- **Significa:** a Lambda recusou invocações por falta de concorrência (quota da conta ou concorrência reservada). Impacto: o usuário recebe erro sem que a função rode. No `llm-proxy` é esperado sob rajada, porque uma estimativa leva até 29 s e, se a conta permitir a reserva do passo 1 do runbook de guardrails, ela é de 1 a 2.
- **Confirmar:** mesmo `get-metric-statistics`, com `--metric-name Throttles`. Veja a reserva atual:

  ```bash
  aws lambda get-function-concurrency --function-name <função>
  aws lambda get-account-settings --query 'AccountLimit.[ConcurrentExecutions,UnreservedConcurrentExecutions]'
  ```

- **Mitigar:** `llm-proxy`, com uso legítimo: suba a reserva conforme o passo 1 do runbook de guardrails, se a quota da conta permitir. Com uso suspeito (abuso ou rajada sem explicação): veja o log de acesso abaixo, desligue com `LLM_ENABLED=false` e revise o limite de taxa (passo 2). `api`: confira se não há laço de chamadas vindo do site e se a reserva de outra função não consumiu a quota da conta.

## `<prefixo>-http-api-5xx`

- **Significa:** o API Gateway devolveu 5xx (falha da integração, timeout de 30 s, Lambda com erro ou throttle). Impacto: requisições do usuário falham; costuma acompanhar um dos alarmes de Lambda acima, mas também dispara por falha só do gateway.
- **Confirmar:**

  ```bash
  aws cloudwatch get-metric-statistics --namespace AWS/ApiGateway --metric-name 5xx \
    --dimensions Name=ApiId,Value=<API_ID> --statistics Sum --period 300 \
    --start-time <início-ISO8601> --end-time <fim-ISO8601>
  ```

  Logs Insights em `/aws/vendedlogs/apigateway/<prefixo>-http-api` (campos no README de `infra/modules/http-api`):

  ```
  fields @timestamp, routeKey, status, integrationError, errorMessage, responseLatency
  | filter status >= 500
  | sort @timestamp desc
  | limit 20
  ```

  `integrationError` ou `errorMessage` preenchidos apontam o gateway; `integrationLatency` perto de 30000 ms indica timeout da função.
- **Mitigar:** siga a função da rota em `routeKey` (`/estimates` e `/quota` vão ao `llm-proxy`, o resto à `api`). Se não houver erro nem throttle na função, o problema é do gateway: rollback com o SHA anterior (ADR-0001, ver pendências acima), se houve deploy ou `apply` recente, e abra Issue com os `requestId` do log.

## Depois de mitigar

Confirme que o alarme voltou a `OK` com o comando de "Conferir o estado" (leva alguns períodos de 5 minutos). Como não há aviso de volta a OK, essa conferência é manual. Registre a causa em Issue se for nova.
