# Runbook — rotação de segredos

Como trocar a chave da Claude API de um ambiente e o que fazer se ela vazar. É o único segredo de aplicação do projeto: o CI entra na AWS por OIDC, sem chave estática ([ADR-0001](../architecture/aws-cost-playground/ADR-0001-stack.md), "Hospedagem e ambientes" e ameaça T5).

## Antes de começar

- **Quem:** o autor. Agentes não leem, não escrevem e não pedem o valor de nenhum segredo.
- **Onde fica a chave:** SSM Parameter Store, `SecureString`, em `/acp/<env>/anthropic-api-key` (`<env>` é `staging` ou `production`). Trocar o valor não pode gerar diferença no plano do Terraform.
- **Quem lê:**
  - em execução, só o papel do `llm-proxy` de cada ambiente tem `ssm:GetParameter` nesse caminho;
  - o Terraform cria o parâmetro com um valor de espera por argumento write-only (`value_wo`) e ignora mudanças nele (`ignore_changes`). O valor, o de espera e o real, não vai para o plano nem para o state;
  - os papéis de CI `plan` e `apply-*` têm `ssm:GetParameter` nesse parâmetro só porque o refresh do provider o lê: o valor passa pela memória do runner e não é gravado. Eles entram na investigação de vazamento (CloudTrail), o bucket de estado não.
- **Uma chave por ambiente**, cada uma no workspace do Console da Anthropic do próprio ambiente (`acp-staging`, `acp-production`), com limite de gasto próprio (ver [guardrails de custo](guardrails-de-custo.md), passo 8).
- **Placeholders:** tudo entre `< >` é substituído na hora. O valor da chave nunca vai para arquivo, Issue, PR, commit, log, chat ou histórico do shell.

## Quando rotacionar

- A cada 90 dias.
- Quando alguém com acesso ao Console da Anthropic ou à conta AWS deixar de precisar dele.
- Em qualquer suspeita de vazamento: siga direto a seção "Vazamento".

Rotacione **staging primeiro**, confirme, e só então produção.

## Rotação planejada (sem indisponibilidade)

A ordem importa: a chave antiga só é excluída depois que a nova está em uso. No Console, **Disable** é reversível e **Delete** é permanente.

1. **Crie a chave nova.** Console da Anthropic (`platform.claude.com`) → API keys → Create key, com **escopo do workspace** `acp-<env>`. Uma chave sem escopo de workspace não fica sob o limite de gasto do ambiente e exigiria o cabeçalho `anthropic-workspace-id` em cada chamada. Nome `acp-<env>-<aaaa-mm>`, para saber depois qual é a corrente. Copie o valor uma única vez.
2. **Grave no SSM pelo console da AWS.** Systems Manager → Parameter Store → `/acp/<env>/anthropic-api-key` → Edit → cole o valor → Save. Mantenha o tipo `SecureString` e a chave KMS que o parâmetro já usa. Trocar a chave KMS pode tirar do proxy a permissão de decifrar.

   Prefira o console à CLI: `aws ssm put-parameter --value ...` deixa o valor no histórico do shell e na lista de processos. Ao terminar, limpe a área de transferência e apague a chave de qualquer gerenciador de clipboard.

3. **Faça o proxy ler a chave nova.** O proxy pode manter a chave em memória enquanto o ambiente de execução estiver quente. Publique uma mudança de configuração inócua na função do ambiente; depois dela, as invocações rodam com a configuração nova:

   ```bash
   aws lambda update-function-configuration --function-name <função-llm-proxy> \
     --description "rotacao <aaaa-mm-dd>"
   aws lambda wait function-updated --function-name <função-llm-proxy>
   ```

   A descrição volta ao valor do Terraform no próximo `apply`, sem efeito.

4. **Teste:** faça uma estimativa com uma conta de teste do ambiente.
5. **Desative a antiga** (Disable, reversível). Console → API keys → chave anterior → Disable.
6. **Teste de novo.** Se a estimativa funciona com a antiga desativada, a nova está em uso. Se falha, reative a antiga, confira se a nova tem o escopo certo e foi colada inteira, e repita do passo 2 (o Parameter Store guarda as versões anteriores na aba History).
7. **Exclua a antiga** (Delete, permanente) e confira nas páginas Usage e Logs do Console que o workspace segue com uso normal. A exclusão é obrigatória: o histórico do parâmetro no SSM continua guardando o valor antigo, que só fica inofensivo depois que a chave deixa de existir.
8. **Registre** a data da rotação numa Issue de operação, sem nenhum valor (crie uma se não houver).

## Vazamento

Trate como incidente. Velocidade importa mais que disponibilidade: o proxy pode ficar fora enquanto você troca a chave.

1. **Desative a chave vazada já.** Console da Anthropic → API keys → Disable. Não espere ter a nova pronta. Se o aviso veio por e-mail da Anthropic porque a chave apareceu num repositório público do GitHub, ela já foi desativada automaticamente: siga do passo 2.
2. **Desligue o proxy de forma limpa:** `LLM_ENABLED=false` no ambiente afetado ([guardrails de custo](guardrails-de-custo.md), "Interruptor manual"). Assim o usuário recebe 503 em vez de erro de autenticação. Até a chave nova estar instalada, não faça merge em `main` nem dispare o deploy de produção: o `apply` volta `LLM_ENABLED` para `true`. Se a investigação passar de um dia, abra o PR da variável (mesma seção, "Por quanto tempo vale").
3. **Contenha o gasto:** baixe temporariamente o limite de gasto do workspace e confira, nas páginas Usage e Logs do Console, se houve consumo que não veio do proxy (horário, modelo, volume).
4. **Crie e instale a chave nova:** passos 1 a 3 da rotação planejada. Religue com `LLM_ENABLED=true`, faça uma estimativa de teste e então exclua (Delete) a chave vazada. Nunca use o histórico do parâmetro para voltar a ela.
5. **Ache a origem do vazamento:**
   - Repositório: `gitleaks git` (ou `gitleaks detect` em versões antigas) no histórico local. Se a chave entrou num commit, a rotação já resolve o risco; reescrever o histórico exige `push --force`, que é decisão só do autor e não de agente.
   - Logs: busque nos grupos `acp-` do CloudWatch (Logs Insights) pelo começo fixo que toda chave da Anthropic tem, sem colar nenhuma chave inteira no terminal.
   - Acesso ao parâmetro: CloudTrail → Event history, com fonte do evento `ssm.amazonaws.com`. Olhe todos os eventos que leem o valor (`GetParameter`, `GetParameters`, `GetParametersByPath`, `GetParameterHistory`) e, com fonte `kms.amazonaws.com`, os eventos `Decrypt`. Confira se algum principal além do papel do `llm-proxy` (e dos papéis de CI `plan` e `apply-*`, que leem no refresh) leu `/acp/<env>/anthropic-api-key`. Sem trail próprio, o Event history guarda só 90 dias; vazamento mais antigo que isso fica sem essa evidência.
   - CI e estado: logs dos workflows recentes do GitHub Actions, inclusive a saída dos `plan`. O valor não está no state (argumento write-only), então o bucket de estado não precisa ser investigado por causa da chave.
6. **Se algum principal estranho leu o parâmetro**, o problema é maior que a chave: trate como credencial AWS comprometida (revogar sessões do papel, revisar quem pode assumi-lo) antes de religar.
7. **Escreva o pós-incidente** numa Issue: quando, como foi descoberto, origem, gasto indevido, ações tomadas e o que muda para não repetir. Sem nenhum valor de segredo.

Se a chave vazada for a de staging, produção não é afetada, porque usa outra chave em outro workspace. Rotacione produção também se a origem do vazamento puder ter exposto as duas (por exemplo, a mesma máquina ou o mesmo log).

## Verificação

- [ ] Cada ambiente usa uma chave do próprio workspace, criada há menos de 90 dias.
- [ ] Nenhuma chave antiga ativa no Console da Anthropic, e toda chave do projeto com escopo de workspace.
- [ ] O parâmetro de cada ambiente é `SecureString`. Em execução, só o papel do `llm-proxy` tem `ssm:GetParameter` nele; os papéis de CI `plan` e `apply-*` o leem apenas no refresh, e o valor não está no state.
- [ ] Nenhum valor de chave em repositório, Issue, log ou histórico do shell.
