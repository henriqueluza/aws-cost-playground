# Módulo `alarms`

Canal de alarmes de um ambiente: um tópico SNS que envia e-mail ao autor. Esta é a parte 1 da Issue #20 (#148); os alarmes chegam na parte 2 (#149).

## O que cria

- **Tópico SNS** `<name_prefix>-alarms`, sem SSE (ver "Decisões e riscos aceitos").
- **Política do tópico** (`aws_sns_topic_policy`), que substitui a padrão e tem só duas regras:
  - `Allow` de `sns:Publish` ao serviço `cloudwatch.amazonaws.com`, limitado à conta (`aws:SourceAccount`) e a alarmes com ARN `arn:aws:cloudwatch:<região>:<conta>:alarm:<name_prefix>-*` (`aws:SourceArn`).
  - `Deny` de `sns:Publish` para qualquer principal sem TLS (`aws:SecureTransport = false`).
- **Assinatura por e-mail** (`aws_sns_topic_subscription.email`), com o endpoint vindo de `alarm_email`.

## O que ainda não cria

Os 5 alarmes do CloudWatch e o runbook de resposta chegam na parte 2 (#149). Até lá o tópico existe e recebe a assinatura, mas nada publica nele.

## Variáveis

| Nome | Tipo | Padrão | Descrição |
|---|---|---|---|
| `name_prefix` | `string` | obrigatória | Prefixo do ambiente; aceita só `acp-stg` ou `acp-prod`. Nomeia o tópico e delimita os alarmes que podem publicar. |
| `alarm_email` | `string` | obrigatória | E-mail que recebe os alarmes. Sensível; validado como endereço de e-mail. Vem de `TF_VAR_alarm_email` e nunca fica no repositório. |

## Outputs

| Nome | Descrição |
|---|---|
| `topic_arn` | ARN do tópico, para conferir a confirmação da assinatura (e, na parte 2, alvo das `alarm_actions`). |

## Exemplo (`envs/<env>/main.tf`)

```hcl
module "alarms" {
  source = "../../modules/alarms"

  name_prefix = "acp-stg"
  alarm_email = var.alarm_email
}

variable "alarm_email" {
  type      = string
  sensitive = true
}
```

O valor entra por `TF_VAR_alarm_email` no ambiente de quem roda o Terraform. Não escreva o endereço em `.tf`, `.tfvars` versionado, teste ou documentação.

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

## Custo

O tópico não tem custo fixo. SNS por e-mail inclui 1.000 notificações por mês no nível gratuito, muito acima do volume esperado de alarmes.

## Validar e testar

```bash
terraform -chdir=infra/modules/alarms init -backend=false \
  && terraform -chdir=infra/modules/alarms validate \
  && terraform -chdir=infra/modules/alarms test
```

`tests/alarms.tftest.hcl` usa provider simulado e só faz `plan`, sem credenciais. Cobre o nome do tópico sem KMS, a assinatura por e-mail, a política (as duas regras e suas condições) e a rejeição de `name_prefix` e `alarm_email` inválidos. O `.terraform.lock.hcl` gerado no módulo não deve ser commitado. O CI roda tflint e trivy em todo `infra/`, mas `validate` só nos ambientes, e não roda `terraform test`.
