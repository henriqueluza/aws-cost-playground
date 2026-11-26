# Runbooks

Procedimentos que o autor executa à mão. Agentes escrevem e revisam estes documentos, mas não executam nenhum passo deles.

| Runbook | Quando usar |
|---|---|
| [Configuração da AWS pelo autor](setup-aws.md) | Uma vez, do domínio ao primeiro staging no ar (Issues #74, #75 e #77). Comece por aqui |
| [Guardrails de custo](guardrails-de-custo.md) | Depois do primeiro deploy de cada ambiente e na revisão mensal (Issue #78) |
| [Rotação de segredos](rotacao-de-segredos.md) | Para criar o parâmetro da chave da Claude API, a cada 90 dias e em suspeita de vazamento |
| [Alarmes](alarmes.md) | Quando um alarme do CloudWatch chega por e-mail |
