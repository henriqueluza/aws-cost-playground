# Runbook — exclusão de conta

Procedimentos para `DELETE /me` (Issue #55). Comportamento da rota: `api/README.md`, seção "Exclusão de conta".

O log da aplicação não tem `sub`, `username`, e-mail nem hash: o evento se localiza só pelo `request_id`. `<função>` é o nome da função `api` (`terraform output function_names`).

## Conferir uma exclusão pelo `request_id`

O usuário informa o `requestId` do corpo da resposta (ou ele vem do log de acesso).

```bash
aws logs filter-log-events --log-group-name /aws/lambda/<função> \
  --filter-pattern '{ $.request_id = "<request_id>" }' \
  --query 'events[].message' --output text
```

- `account deleted` com `deleted_items`: dados e usuário foram apagados.
- `account deletion incomplete`: veja `stage` (`config`: `USER_POOL_ID` ausente na função; `data`: falha no DynamoDB; `identity`: falha no Cognito) e `error_type` (código da AWS ou classe do erro).

## 503 repetido

1. Peça ao usuário para tentar de novo; a operação é idempotente e cada repetição continua de onde parou.
2. `stage = config`: confirme que a função `api` recebe `USER_POOL_ID` (`aws lambda get-function-configuration --function-name <função> --query 'Environment.Variables.USER_POOL_ID'`). Correção é por Terraform, feita pelo autor.
3. `stage = data` com `ProvisionedThroughputExceededException`/`ThrottlingException`, ou `stage = identity` com `TooManyRequestsException`: limite temporário da AWS; aguarde e repita.
4. `AccessDeniedException`: o papel da `api` perdeu `dynamodb:Query`, `dynamodb:BatchWriteItem` ou `cognito-idp:AdminDeleteUser`; revise o IAM em `infra/`.
5. Persistindo, escale ao autor. Não apague itens ou o usuário à mão sem registrar a decisão.

## Restauração por PITR (procedimento manual)

Restaurar a tabela de produção por PITR traz de volta os itens de contas já excluídas. Depois de qualquer restauração:

1. Não restaure por cima da tabela de produção: restaure para uma tabela nova e copie só os itens necessários. O log não identifica o usuário (de propósito), então não há como reexecutar automaticamente as exclusões feitas depois do ponto restaurado; copiar a tabela inteira traria de volta dados de contas excluídas. Como tratar esse caso é decisão pendente do autor.
2. Registre a restauração e as contas reprocessadas na Issue do incidente.

O PITR guarda dados por 35 dias (padrão do DynamoDB: `infra/modules/database` liga o PITR sem definir `recovery_period_in_days`); um dado apagado continua recuperável nesse prazo e some sozinho ao fim dele. A política de privacidade precisa citar esse período (marcador `[CONFERIR: PERÍODO DE RECUPERAÇÃO DO BANCO]`, PR #199, pendente do autor).

## Retenção de logs

Os logs da aplicação e o log de acesso do API Gateway têm retenção de 7 dias (padrão de `log_retention_days` em `infra/modules/functions` e `infra/modules/http-api`) O log da aplicação não tem e-mail nem `sub`. O log de acesso do API Gateway (`infra/modules/http-api/stage.tf`) registra o `sub` de toda requisição autenticada, inclusive do `DELETE /me`: depois da exclusão, esse pseudônimo ainda aparece ali até a retenção vencer.
