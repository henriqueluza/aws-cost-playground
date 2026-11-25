# Módulo `alarms`

Alarmes de um ambiente: um tópico SNS que envia e-mail ao autor e 5 alarmes do CloudWatch que publicam nele. Partes 1 (#148, tópico) e 2 (#149, alarmes) da Issue #20. O que fazer quando um alarme chega: [`docs/runbooks/alarmes.md`](../../../docs/runbooks/alarmes.md).

## O que cria

- **Tópico SNS** `<name_prefix>-alarms`, sem SSE (ver "Decisões e riscos aceitos").
- **Política do tópico** (`aws_sns_topic_policy`), que substitui a padrão e tem só duas regras:
  - `Allow` de `sns:Publish` ao serviço `cloudwatch.amazonaws.com`, limitado à conta (`aws:SourceAccount`) e a alarmes com ARN `arn:aws:cloudwatch:<região>:<conta>:alarm:<name_prefix>-*` (`aws:SourceArn`).
  - `Deny` de `sns:Publish` para qualquer principal sem TLS (`aws:SecureTransport = false`).
- **Assinatura por e-mail** (`aws_sns_topic_subscription.email`), com o endpoint vindo de `alarm_email`.
- **5 alarmes** (`aws_cloudwatch_metric_alarm.this`, um por chave), nomeados `<name_prefix>-<chave>`:

| Chave | Namespace | Métrica | Dimensão |
|---|---|---|---|
| `api-errors` | `AWS/Lambda` | `Errors` | `FunctionName` = `function_names.api` |
| `api-throttles` | `AWS/Lambda` | `Throttles` | `FunctionName` = `function_names.api` |
| `llm-proxy-errors` | `AWS/Lambda` | `Errors` | `FunctionName` = `function_names.llm-proxy` |
| `llm-proxy-throttles` | `AWS/Lambda` | `Throttles` | `FunctionName` = `function_names.llm-proxy` |
| `http-api-5xx` | `AWS/ApiGateway` | `5xx` | `ApiId` = `api_id` |

Todos iguais no resto: estatística `Sum`, período de 300 s, 1 período, limiar 0, `GreaterThanThreshold` (qualquer erro em 5 minutos alarma) e `treat_missing_data = notBreaching` (sem tráfego não há dado, e isso conta como OK). A descrição de cada alarme aponta para o runbook.

## Variáveis

| Nome | Tipo | Padrão | Descrição |
|---|---|---|---|
| `name_prefix` | `string` | obrigatória | Prefixo do ambiente; aceita só `acp-stg` ou `acp-prod`. Nomeia o tópico e delimita os alarmes que podem publicar. |
| `function_names` | `object({ api = string, llm-proxy = string })` | obrigatória | Nome das duas funções; vem da saída `function_names` do módulo `functions`. As duas chaves são obrigatórias. |
| `api_id` | `string` | obrigatória | Id da HTTP API; vem da saída `api_id` do módulo `http-api`. Validado como 10 caracteres minúsculos ou dígitos. |
| `alarm_email` | `string` | obrigatória | E-mail que recebe os alarmes. Sensível; validado como endereço de e-mail. Vem de `TF_VAR_alarm_email` e nunca fica no repositório. |

## Outputs

| Nome | Descrição |
|---|---|
| `topic_arn` | ARN do tópico, para conferir a confirmação da assinatura. Também é o alvo das `alarm_actions`. |
| `alarm_names` | Mapa chave => nome do alarme (`api-errors`, `api-throttles`, `llm-proxy-errors`, `llm-proxy-throttles`, `http-api-5xx`). |

## Exemplo (`envs/<env>/main.tf`)

```hcl
module "alarms" {
  source = "../../modules/alarms"

  name_prefix    = "acp-stg"
  function_names = module.functions.function_names
  api_id         = module.http_api.api_id
  alarm_email    = var.alarm_email
}

variable "alarm_email" {
  type      = string
  sensitive = true
}
```

O valor entra por `TF_VAR_alarm_email` no ambiente de quem roda o Terraform. Não escreva o endereço real em `.tf`, `.tfvars` versionado, teste ou documentação; o teste usa um endereço fictício em `exemplo.com`.

## Confirmar a assinatura

A AWS só entrega e-mails depois que o link de confirmação, enviado ao endereço assim que a assinatura é criada, é clicado. Para conferir:

```bash
aws sns list-subscriptions-by-topic --topic-arn <topic_arn> \
  --query 'Subscriptions[].[Protocol,SubscriptionArn]'
```

`SubscriptionArn` igual a `PendingConfirmation` significa que a assinatura ainda não foi confirmada. Se a mensagem não chegar, procure no spam; se o link expirar, é preciso recriar a assinatura.

## Decisões e riscos aceitos

- **Sem SSE no tópico** (`#trivy:ignore:AVD-AWS-0095`): uma CMK custa US$ 1/mês fixo, e o ADR proíbe custo fixo além da zona do Route 53. A chave gerenciada `alias/aws/sns` não serve, porque o CloudWatch não consegue usá-la e a entrega dos alarmes falharia.
- **Política restrita ao prefixo**: só alarmes `<name_prefix>-*` da própria conta publicam. Um alarme com outro nome não notifica, mesmo que aponte para o tópico.
- **Só e-mail**: sem outros protocolos de assinatura.
- **Só `alarm_actions`, sem `ok_actions`**: com limiar 0 o alarme volta a OK logo depois do pico, e avisar também a volta dobraria os e-mails. A conferência de que voltou a OK é manual (runbook).
- **Limiar 0 em 1 período**: com tráfego de um usuário, qualquer erro ou throttle já interessa. Se virar ruído, ajustar é PR com decisão registrada.

## Custo

O tópico não tem custo fixo. SNS por e-mail inclui 1.000 notificações por mês no nível gratuito, muito acima do volume esperado de alarmes.

O nível gratuito do CloudWatch cobre 10 alarmes padrão por conta. São 5 por ambiente e 2 ambientes: 10, exatamente a franquia, custo US$ 0. Um 11º alarme custaria US$ 0,10/mês e exige decisão humana (`needs-human`). A franquia é da conta inteira: um alarme criado à mão no console ou por outro projeto na mesma conta conta junto. Por isso o módulo só usa métricas padrão: sem alarme de alta resolução, métrica customizada, dashboard nem anomaly detection, que são cobrados fora da franquia.

## Validar e testar

```bash
terraform -chdir=infra/modules/alarms init -backend=false \
  && terraform -chdir=infra/modules/alarms validate \
  && terraform -chdir=infra/modules/alarms test
```

`tests/alarms.tftest.hcl` usa provider simulado e só faz `plan`, sem credenciais. São 7 execuções: o nome do tópico sem KMS, a assinatura por e-mail, a política (as duas regras e suas condições), os 5 alarmes com chaves e dimensões exatas, a restrição a métricas padrão do nível gratuito, a rejeição de `name_prefix`, `alarm_email` e `api_id` inválidos e a aceitação de `acp-prod`. O `.terraform.lock.hcl` gerado no módulo não deve ser commitado. O CI roda tflint e trivy em todo `infra/`, mas `validate` só nos ambientes, e não roda `terraform test`.
