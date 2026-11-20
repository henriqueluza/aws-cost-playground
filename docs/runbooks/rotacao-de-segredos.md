# Runbook — rotação de segredos

Como trocar a chave da Claude API de um ambiente e o que fazer se ela vazar. É o único segredo de aplicação do projeto: o CI entra na AWS por OIDC, sem chave estática ([ADR-0001](../architecture/aws-cost-playground/ADR-0001-stack.md), "Hospedagem e ambientes" e ameaça T5).

## Antes de começar

- **Quem:** o autor. Agentes não leem, não escrevem e não pedem o valor de nenhum segredo.
- **Onde fica a chave:** SSM Parameter Store, `SecureString`, em `/acp/<env>/anthropic-api-key` (`<env>` é `staging` ou `production`). O Terraform cria o parâmetro com valor de placeholder e ignora mudanças de valor, então trocar a chave não gera diferença no plano.
- **Quem lê:** só o papel do `llm-proxy` de cada ambiente tem `ssm:GetParameter` nesse caminho.
- **Uma chave por ambiente**, cada uma no workspace do Console da Anthropic do próprio ambiente (`acp-staging`, `acp-production`), com limite de gasto próprio (ver [guardrails de custo](guardrails-de-custo.md), passo 8).
- **Placeholders:** tudo entre `< >` é substituído na hora. O valor da chave nunca vai para arquivo, Issue, PR, commit, log, chat ou histórico do shell.

## Quando rotacionar

- A cada 90 dias.
- Quando alguém com acesso ao Console da Anthropic ou à conta AWS deixar de precisar dele.
- Em qualquer suspeita de vazamento: siga direto a seção "Vazamento".

Rotacione **staging primeiro**, confirme, e só então produção.

## Rotação planejada (sem indisponibilidade)

A ordem importa: a chave antiga só é revogada depois que a nova está em uso.

1. **Crie a chave nova.** Console da Anthropic → workspace `acp-<env>` → API keys → Create key. Nome `acp-<env>-<aaaa-mm>`, para saber depois qual é a corrente. Copie o valor uma única vez.
2. **Grave no SSM pelo console da AWS.** Systems Manager → Parameter Store → `/acp/<env>/anthropic-api-key` → Edit → cole o valor → Save. Mantenha o tipo `SecureString` e a chave KMS padrão.

   Prefira o console à CLI: `aws ssm put-parameter --value ...` deixa o valor no histórico do shell e na lista de processos.

3. **Faça o proxy ler a chave nova.** O proxy pode manter a chave em memória enquanto o ambiente de execução estiver quente. Para descartar os ambientes antigos, publique uma mudança de configuração inócua:

   ```bash
   aws lambda update-function-configuration --function-name <função-llm-proxy-<env>> \
     --description "rotacao <aaaa-mm-dd>"
   aws lambda wait function-updated --function-name <função-llm-proxy-<env>>
   ```

   A descrição volta ao valor do Terraform no próximo `apply`, sem efeito.

4. **Confira que a nova está em uso.** Faça uma estimativa com uma conta de teste do ambiente. No Console da Anthropic, a chave nova passa a mostrar uso.
5. **Revogue a antiga.** Console da Anthropic → API keys → chave anterior → desative e depois exclua.
6. **Confira de novo:** outra estimativa de teste funciona, e a chave antiga não registra uso novo.
7. **Registre** a data da rotação na Issue de operação do mês (sem nenhum valor).

Se o passo 4 falhar, **não revogue a antiga**. Confira se a chave nova é do workspace certo e foi colada inteira; se preciso, crie outra e repita do passo 2. O Parameter Store guarda as versões anteriores do parâmetro (aba History), caso precise voltar.

## Vazamento

Trate como incidente. Velocidade importa mais que disponibilidade: o proxy pode ficar fora enquanto você troca a chave.

1. **Revogue a chave vazada já.** Console da Anthropic → workspace do ambiente → API keys → desative a chave. Não espere ter a nova pronta.
2. **Desligue o proxy de forma limpa:** `LLM_ENABLED=false` no ambiente afetado ([guardrails de custo](guardrails-de-custo.md), "Interruptor manual"). Assim o usuário recebe 503 em vez de erro de autenticação.
3. **Contenha o gasto:** baixe temporariamente o limite de gasto do workspace e confira, no uso do Console, se houve consumo que não veio do proxy (horário, modelo, volume).
4. **Crie e instale a chave nova:** passos 1 a 4 da rotação planejada. Religue com `LLM_ENABLED=true` e faça uma estimativa de teste.
5. **Ache a origem do vazamento:**
   - Repositório: `gitleaks git` (ou `gitleaks detect` em versões antigas) no histórico local. Se a chave entrou num commit, a rotação já resolve o risco; reescrever o histórico exige `push --force`, que é decisão só do autor e não de agente.
   - Logs: busque nos grupos `acp-` do CloudWatch (Logs Insights) pelo começo fixo que toda chave da Anthropic tem, sem colar nenhuma chave inteira no terminal.
   - Acesso ao parâmetro: CloudTrail → Event history, filtro por nome de evento `GetParameter`, e confira se algum principal além do papel do `llm-proxy` leu `/acp/<env>/anthropic-api-key`.
   - CI: logs dos workflows recentes do GitHub Actions.
6. **Se algum principal estranho leu o parâmetro**, o problema é maior que a chave: trate como credencial AWS comprometida (revogar sessões do papel, revisar quem pode assumi-lo) antes de religar.
7. **Escreva o pós-incidente** numa Issue: quando, como foi descoberto, origem, gasto indevido, ações tomadas e o que muda para não repetir. Sem nenhum valor de segredo.

Se a chave vazada for a de staging, produção não é afetada, porque usa outra chave em outro workspace. Rotacione produção também se a origem do vazamento puder ter exposto as duas (por exemplo, a mesma máquina ou o mesmo log).

## Verificação

- [ ] Cada ambiente usa uma chave do próprio workspace, criada há menos de 90 dias.
- [ ] Nenhuma chave antiga ativa no Console da Anthropic.
- [ ] O parâmetro de cada ambiente é `SecureString`, e só o papel do `llm-proxy` tem `ssm:GetParameter` nele.
- [ ] Nenhum valor de chave em repositório, Issue, log ou histórico do shell.
