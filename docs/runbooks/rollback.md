# Runbook — rollback de produção

Rollback é publicar de novo, em produção, um commit anterior que já esteve no ar. Usa o mesmo workflow do deploy, [`deploy-production.yml`](../../.github/workflows/deploy-production.yml), disparado à mão (`workflow_dispatch`) com o SHA anterior. Nada é reconstruído: o workflow baixa o artefato `release-<sha>` que o deploy de staging daquele commit guardou. O pipeline está descrito em [`docs/infra.md`](../infra.md).

Só um humano dispara este workflow. Agentes não fazem deploy nem rollback.

## Quando usar

- O smoke test de produção falhou, ou o deploy parou no meio.
- Um alarme disparou logo depois de um deploy ([`alarmes.md`](alarmes.md)).
- Um erro visível para o usuário apareceu na versão nova.

Se o problema é só a LLM, desligue-a antes de pensar em rollback ([`guardrails-de-custo.md`](guardrails-de-custo.md)).

## 1. Achar o SHA anterior

O SHA anterior é o do último deploy de produção que terminou verde antes do atual. O resumo de cada run mostra o "Commit publicado".

```bash
gh run list --workflow deploy-production.yml --status success --limit 5 \
  --repo henriqueluza/aws-cost-playground
gh run view <id do run> --repo henriqueluza/aws-cost-playground   # o resumo traz o commit publicado
```

Use o SHA completo, com 40 caracteres. SHA curto, tag ou nome de branch são recusados.

## 2. Disparar o workflow

Pela interface: **Actions → Deploy production → Run workflow**, branch `main`, campo `sha` com o SHA anterior. Ou pela linha de comando:

```bash
gh workflow run deploy-production.yml --ref main -f sha=<SHA anterior> \
  --repo henriqueluza/aws-cost-playground
gh run watch --repo henriqueluza/aws-cost-playground
```

O job `check` confere o SHA, o deploy de staging e os preços sem credencial da AWS. O job `deploy` só começa depois, no Environment `production`.

## 3. Conferir

- O run terminou verde e o resumo mostra o SHA anterior em "Commit publicado".
- O passo `smoke` passou: o site responde, o `/config.json` e o `/prices/manifest.json` servidos são os do release e `GET /quota` sem token devolve 401.
- Os alarmes voltaram a OK ([`alarmes.md`](alarmes.md), "Conferir o estado").

## O que o rollback desfaz e o que não desfaz

| Item | Efeito |
|---|---|
| Código das funções | Volta para `functions/<SHA anterior>.zip`, que já está no bucket de artefatos de produção |
| Site | O `index.html` e os arquivos do SHA anterior são enviados de novo e o CloudFront é invalidado. Os assets com hash nunca são apagados |
| Preços | Voltam para os do SHA anterior, porque fazem parte do site |
| Infraestrutura | O Terraform aplicado é o de `infra/envs/production` no SHA anterior. Mudanças que só alteram recursos voltam; ver o plan-guard abaixo |
| Dados | Nada. Designs no DynamoDB e usuários no Cognito ficam como estão. O formato do design é compatível com a versão anterior (`schemaVersion` com leitura tolerante, ADR-0001) |

## Quando o workflow recusa

| Mensagem | Causa | O que fazer |
|---|---|---|
| SHA fora do formato, ou commit que não pertence a `main` | SHA curto, errado ou de outro branch | Repita com o SHA completo de um commit de `main` |
| Nenhum deploy de staging com sucesso para o SHA | O commit nunca foi publicado em staging, ou o deploy de staging falhou ou foi pulado | Escolha outro SHA. Só vai para produção o que passou por staging |
| Artefato não encontrado | O artefato `release-<sha>` dura 90 dias | Faça o rollback por PR de `git revert` (abaixo) |
| `manifest.json` de preços com `source: seed` | O SHA é de antes dos preços gerados | Escolha um SHA mais novo, ou faça o rollback por `git revert` |
| plan-guard reprovou o plano | Voltar a infraestrutura para o SHA anterior apagaria ou substituiria um recurso | Não force. Faça o rollback por `git revert` só do código, mantendo a infraestrutura |
| Faltam variáveis | Environment `production` sem configuração | Cadastre as variáveis de [`docs/infra.md`](../infra.md) |

## Rollback por `git revert`

Quando o workflow recusa o SHA anterior, o caminho é para a frente: abra um PR com o `git revert` do commit com problema, faça o merge depois da revisão, espere o deploy de staging terminar verde e dispare o workflow de produção com o SHA novo de `main`. Leva mais tempo, mas passa pelas mesmas verificações.

## Se o rollback falhar no meio

O workflow não desfaz passos já feitos. Dispare de novo com o mesmo SHA: o pacote não é regravado (a chave já existe com o mesmo conteúdo), o Terraform parte do estado atual e o site é enviado outra vez. Se a falha se repetir, leia o passo que falhou no log do run antes de tentar outro SHA.
