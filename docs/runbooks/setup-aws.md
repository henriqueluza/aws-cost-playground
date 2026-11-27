# Runbook: configuração da AWS pelo autor

Guia único da parte que só o autor faz, do domínio ao primeiro staging no ar, na ordem de execução. Nenhum agente executa estes passos: agentes não aplicam infra, não leem segredos e não tocam em `infra/bootstrap/` ([ADR-0001](../architecture/aws-cost-playground/ADR-0001-stack.md), "Hospedagem e ambientes" e "Travas contra destruição da infra").

Cada passo cita o arquivo do repositório de onde saiu. Se o arquivo e este runbook divergirem, vale o arquivo: abra uma Issue para corrigir o runbook.

## Antes de começar

- **Quem:** o autor, com credencial temporária de administrador da conta AWS (SSO ou sessão curta, nunca chave de acesso gravada em arquivo) e permissão de administrador no repositório do GitHub.
- **Região:** `us-east-1` em tudo.
- **Ferramentas:** Terraform 1.16 (`infra/bootstrap/versions.tf` exige `~> 1.16.0`), AWS CLI v2, `gh` autenticado, `jq`, `dig` e, para o passo de preços, uv 0.13.8 ou superior e Python 3.14 (`pricing/README.md`).
- **Marcadores:** tudo entre `< >` é trocado na hora de rodar e nunca é escrito de volta neste arquivo, em Issue, PR ou commit.

| Marcador | Significado |
|---|---|
| `<ACCOUNT_ID>` | Id da conta AWS |
| `<DOMINIO>` | Domínio do produto, igual ao nome da zona pública do Route 53 |
| `<EMAIL_DE_TESTE>` | E-mail de uma conta de teste de staging |
| `<USER_POOL_ID>` | Id do User Pool de staging |
| `<BUCKET_DE_ARTEFATOS_STAGING>` | Bucket de artefatos de staging, criado pelo bootstrap (#209): `acp-artifacts-stg-<ACCOUNT_ID>`, lido da saída `github_environment_variables` |
| `<RUN_ID>` | Id de uma execução do GitHub Actions |

### Ordem e Issues do autor

| Seção | Issue do autor |
|---|---|
| 1. Verificações na conta | #77 |
| 2. Domínio e zona | #74 |
| 3. Bootstrap | #77 |
| 4. GitHub Environments, variáveis e segredo | #77 |
| 5. Chave da Claude API no SSM | #75 (criar a chave) e #77 (gravar) |
| 6. Primeiro deploy de staging | #77 |
| 7. Contas de teste no Cognito e a sua conta em produção | #77 e #383 |
| 8. Catálogo de preços | #77 |
| Guardrails de custo | #78 |
| Validação completa e produção | #80 (fora deste runbook) |

### O que precisa estar em `main` antes

Em 26/11/2026 o código de `main` ainda não deixa o primeiro deploy passar. Confira cada Issue antes do passo indicado; com alguma aberta, pare nesse passo.

| Issue | O que falta | Trava o passo |
|---|---|---|
| #338 | Ações de escrita dos papéis `acp-ci-apply-<env>` que não se delimitam por ambiente. Decisão do autor em 26/11/2026: a entrega de log do HTTP API e o `cloudfront:UpdateDistribution` do domínio do Cognito entram como risco aceito; alterar política de cache, de cabeçalhos (CSP) ou OAC e etiquetar no API Gateway são tarefa manual do autor (`infra/bootstrap/README.md`, "Recursos com ARN por ID", com o passo a passo). Com o código em `main`, **reaplique o bootstrap** (6 atualizações no lugar, nenhuma criação); sem isso o deploy para no stage do HTTP API e no domínio do Cognito | 6 |
| #209 | Bucket de artefatos das funções no bootstrap, um por ambiente. É a origem de `TF_VAR_PACKAGE_BUCKET`: a saída `github_environment_variables` traz o nome (`infra/bootstrap/README.md`, "Bucket de artefatos"). Com o código em `main`, **reaplique o bootstrap** (12 criações) antes de cadastrar a variável | 4 e 6 |
| #307 (e #210, mesmo assunto) | Runtime das Lambdas: `python3.13` em `infra/modules/functions/main.tf`, contra o pacote montado para Python 3.14 (`api/.python-version`) | 6 |
| #125 | Papel `prices` do bootstrap (já em `main`; reaplique o bootstrap se ainda não o aplicou) | 8, só para o workflow |

```bash
for n in 167 169 209 307 210 125; do gh issue view "$n" --repo henriqueluza/aws-cost-playground --json number,state --jq '"\(.number) \(.state)"'; done
```

O bootstrap (passo 3) pode ser aplicado antes e reaplicado depois de cada uma dessas Issues: reaplicar é o mesmo roteiro (`infra/bootstrap/README.md`, "Como aplicar").

## 1. Verificações na conta

Só leitura. Nada aqui altera a conta.

1. Confirme a conta e a identidade em uso.

   ```bash
   aws sts get-caller-identity --query '[Account,Arn]' --output text
   ```

   Como conferir: o id é o da conta do projeto e o ARN é de uma sessão temporária (`assumed-role`), não de um usuário com chave fixa.

2. Confira o plano da conta e as condições do Free Tier. Console → Billing and Cost Management → Free Tier (e a página da conta, que mostra o plano). O repositório não registra essas condições: é a pendência "Condições do Free Tier" do ADR ("Pendências do discovery"). Anote na #77:
   - se a conta está no plano gratuito ou no pago, e se o plano gratuito tem prazo ou limite de créditos;
   - se o plano permite os serviços que o projeto usa: Route 53 (zona e registro de domínio), CloudFront, S3, API Gateway HTTP API, Lambda, DynamoDB, Cognito, ACM, SSM Parameter Store, CloudWatch, SNS e AWS Budgets com ação;
   - até quando valem as franquias de 12 meses, se a conta tiver alguma.

   Como conferir: a página Free Tier lista o uso por serviço sem alerta de limite, e o plano anotado permite todos os serviços da lista. Se o plano bloquear algum, pare e decida na #77: é decisão de custo, do autor.

3. Leia a quota de concorrência do Lambda. É o comando do passo 1 de [guardrails de custo](guardrails-de-custo.md).

   ```bash
   aws lambda get-account-settings --query 'AccountLimit.[ConcurrentExecutions,UnreservedConcurrentExecutions]'
   ```

   Como conferir: anote os dois números na #77. Com `ConcurrentExecutions` menor que 103 não dá para reservar concorrência no `llm-proxy`, e a contenção é o limite de taxa do API Gateway (ADR, "Guardrails de custo"). O deploy funciona nos dois casos. Reservar ou pedir aumento é da #78, não deste passo.

4. Veja se a conta já tem um provedor OIDC do GitHub. Só pode haver um por conta.

   ```bash
   aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn'
   ```

   Como conferir: lista vazia, ou sem `token.actions.githubusercontent.com`. Se ele já existir, o passo 3 começa pela importação descrita em `infra/bootstrap/README.md` ("Como aplicar").

5. Saiba dos dois limites que não custam nada, mas acabam: o remetente padrão do Cognito envia no máximo 50 e-mails por dia por conta (`infra/modules/auth/README.md`, "Limites conhecidos"), e o nível gratuito do CloudWatch cobre 10 alarmes, que os dois ambientes usam inteiros ([alarmes](alarmes.md), "Antes do primeiro alarme").

## 2. Domínio e zona no Route 53 (#74)

A zona é o único custo fixo do projeto, cerca de US$ 0,50 por mês, mais a anuidade do domínio (ADR, "Consequências"). O Terraform não cria a zona: o módulo `dns` só a lê (`infra/modules/dns/README.md`, "O que não cria").

1. Registre o domínio. Se o registro for no Route 53 (Console → Route 53 → Registered domains → Register domains), a zona pública é criada junto. Se for em outro registrador, crie a zona pública (Route 53 → Hosted zones → Create hosted zone, tipo Public) e aponte os servidores de nome do registrador para os quatro `NS` da zona.

2. Confira que existe uma única zona pública com esse nome. O módulo `dns` falha se houver duas.

   ```bash
   aws route53 list-hosted-zones-by-name --dns-name <DOMINIO> --query 'HostedZones[].[Name,Config.PrivateZone]' --output text
   ```

   Como conferir: uma linha só, com `<DOMINIO>.` e `False`.

3. Confira a delegação.

   ```bash
   dig +short NS <DOMINIO>
   ```

   Como conferir: os quatro servidores são os mesmos do registro `NS` da zona no console. Sem a delegação certa, a validação dos certificados do ACM no passo 6 não termina.

4. Não crie registros à mão na zona. Um registro manual com o nome do CNAME de validação faz o deploy falhar (`infra/modules/dns/README.md`, "Observações"). Os nomes que o Terraform vai criar em staging são `staging.<DOMINIO>`, `api.staging.<DOMINIO>` e `auth.staging.<DOMINIO>`.

O único valor desta seção que vai para o GitHub é o nome do domínio (variável `TF_VAR_ZONE_NAME`, passo 4). O id da zona não é usado por nenhum workflow.

## 3. Aplicar `infra/bootstrap/` (#77)

O roteiro completo, com os comandos, está em `infra/bootstrap/README.md`, seções "Como aplicar (autor)" e "Estado deste diretório". Siga-o de lá. Aqui ficam a ordem e a conferência.

Antes do bootstrap, de [guardrails de custo](guardrails-de-custo.md) só vale a leitura da quota (passo 1 deste runbook). O resto daquele runbook exige a infra do ambiente já aplicada e fica para depois do passo 6.

0. Confira o formato do `sub` que o repositório emite (#366). Os trusts esperam o formato imutável, conferido em 27/11/2026 com um token real: o repositório emite `repo:henriqueluza@60079862/aws-cost-playground@1463554125:<contexto>`.

   ```bash
   gh api repos/henriqueluza/aws-cost-playground/actions/oidc/customization/sub
   ```

   Esperado: `use_default: true`, `use_immutable_subject: true` e `sub_claim_prefix` igual a `repo:henriqueluza@60079862/aws-cost-playground@1463554125`. Se vier diferente, **não aplique**: os papéis seriam criados com um trust que nenhum job casa. Abra uma Issue `area:infra-bootstrap` com a resposta (são dados públicos do repositório) para ajustar `infra/bootstrap/oidc.tf` e os testes antes. A tabela papel → `sub` está em `infra/bootstrap/README.md`, "Formato do `sub`".

1. Na raiz do repositório, em `main` atualizada, inicialize.

   ```bash
   terraform -chdir=infra/bootstrap init -lockfile=readonly
   ```

2. Gere o plano.

   ```bash
   export TF_VAR_zone_name="<DOMINIO>"
   terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
   ```

   O bootstrap lê a zona pública do passo 2 para delimitar os registros DNS de cada papel `apply` (`infra/bootstrap/by_id.tf`): o domínio vai em minúsculas e sem ponto final, igual à variável `TF_VAR_ZONE_NAME` do passo 4. Se a conta já tiver o papel `AWSServiceRoleForAPIGateway`, importe-o antes (`infra/bootstrap/README.md`, "Como aplicar").

   Como conferir: o plano só cria recursos. Nenhum `delete` e nenhum `replace`. O estado é local (`infra/bootstrap/terraform.tfstate`, fora do git).

3. Aplique o plano salvo.

   ```bash
   terraform -chdir=infra/bootstrap apply bootstrap.tfplan
   ```

   Como conferir: a última linha da saída é `Apply complete!`, com zero recursos alterados e zero destruídos na primeira aplicação. Os itens 4 a 7 conferem recurso por recurso.

4. Confira os buckets de estado (`infra/bootstrap/state.tf`). Repita com `acp-prod-tfstate-<ACCOUNT_ID>`.

   ```bash
   aws s3api get-bucket-versioning --bucket acp-stg-tfstate-<ACCOUNT_ID> --query Status --output text
   ```

   Como conferir: `Enabled`.

5. Confira os papéis de CI (`infra/bootstrap/plan.tf` e `apply.tf`).

   ```bash
   aws iam list-roles --query "Roles[?starts_with(RoleName, 'acp-ci-')].RoleName" --output text
   ```

   Como conferir: `acp-ci-plan`, `acp-ci-apply-staging`, `acp-ci-apply-production` e `acp-ci-prices`.

6. Confira o limite de permissões (`infra/bootstrap/boundary.tf`).

   ```bash
   aws iam list-policies --scope Local --query "Policies[?starts_with(PolicyName, 'acp-ci-boundary-')].PolicyName" --output text
   ```

   Como conferir: `acp-ci-boundary-staging` e `acp-ci-boundary-production`. Sem elas, o deploy falha ao criar os papéis das funções (`infra/modules/functions/README.md`, "Limite de permissões").

7. Confira as saídas que viram variáveis do GitHub (`infra/bootstrap/outputs.tf`).

   ```bash
   terraform -chdir=infra/bootstrap output -json github_variables | jq 'keys'
   ```

   Como conferir: `AWS_PLAN_ROLE_ARN`, `AWS_PRICES_ROLE_ARN`, `TF_STATE_BUCKET_PRODUCTION` e `TF_STATE_BUCKET_STAGING`. A saída `github_environment_variables` tem as chaves `staging` e `production`, cada uma com `AWS_APPLY_ROLE_ARN`.

8. Guarde uma cópia de `infra/bootstrap/terraform.tfstate` fora do repositório, em local cifrado, e apague o `bootstrap.tfplan`. O arquivo de estado não tem segredo, mas tem o id da conta e os ARNs.

   Como conferir: `git status --short infra/bootstrap` não lista nenhum arquivo, e a cópia abre no local onde você a guardou.

## 4. GitHub Environments, variáveis e segredo (#77)

A lista abaixo foi conferida nos workflows de `main`. Só `terraform.yml` e `deploy-staging.yml` leem variáveis ou segredos de infra; `validate.yml` não lê nenhum.

| Nome | Tipo | Onde cadastrar | Valor | Quem lê |
|---|---|---|---|---|
| `TF_VAR_ZONE_NAME` | variável | repositório | `<DOMINIO>` (passo 2) | `terraform.yml` (job `plan`) e `deploy-staging.yml` |
| `TF_VAR_ALARM_EMAIL` | segredo | repositório | E-mail que recebe os alarmes | `terraform.yml` (job `plan`) e `deploy-staging.yml` |
| `TF_STATE_BUCKET_STAGING` | variável | repositório | Saída `github_variables` do bootstrap | `terraform.yml` (job `plan`) e `deploy-staging.yml` |
| `TF_STATE_BUCKET_PRODUCTION` | variável | repositório | Saída `github_variables` do bootstrap | `terraform.yml` (job `plan`) |
| `AWS_PLAN_ROLE_ARN` | variável | repositório | Saída `github_variables` do bootstrap | `terraform.yml` (liga o job `plan`) |
| `TF_VAR_PACKAGE_BUCKET` | variável | Environment `staging` | Saída `github_environment_variables` do bootstrap (#209) | `deploy-staging.yml` |
| `AWS_APPLY_ROLE_ARN` | variável | Environment `staging` | Saída `github_environment_variables` do bootstrap | `deploy-staging.yml` (liga o deploy) |
| `AWS_APPLY_ROLE_ARN` | variável | Environment `production` | Saída `github_environment_variables` do bootstrap | `deploy-production.yml` (só por disparo manual do autor) |

Os cinco valores de repositório precisam ficar no repositório, e não no Environment: o job `plan` roda sem `environment:` e não enxerga variável de Environment (`infra/README.md`, "Variáveis do job plan"). O workflow de produção (`deploy-production.yml`) também pede `TF_VAR_PACKAGE_BUCKET` no Environment `production` e falha fechado sem ela; as variáveis de produção estão em `docs/infra.md`, "Variáveis de produção que o autor cria", e o rollback em [`rollback.md`](rollback.md).

A ordem importa. `AWS_PLAN_ROLE_ARN` liga o job `plan`, que falha fechado se faltar domínio ou e-mail. `AWS_APPLY_ROLE_ARN` liga o deploy, que falha fechado se faltar qualquer outro valor (`docs/infra.md`, "Ordem para ligar o pipeline").

1. Crie os Environments `staging` e `production`. GitHub → Settings → Environments → New environment.

   ```bash
   gh api repos/henriqueluza/aws-cost-playground/environments --jq '.environments[].name'
   ```

   Como conferir: a lista traz `staging` e `production`.

2. Restrinja os dois ao branch `main`, antes de cadastrar qualquer variável neles. Em cada Environment: Deployment branches and tags → Selected branches and tags → Add deployment branch or tag rule → `main`. O trust dos papéis `apply` já fixa `refs/heads/main` no IAM; esta regra é a segunda camada (`infra/bootstrap/README.md`, "Papéis `apply`"). Repita a conferência com `production`.

   ```bash
   gh api repos/henriqueluza/aws-cost-playground/environments/staging/deployment-branch-policies --jq '.branch_policies[].name'
   ```

   Como conferir: a única linha é `main`.

3. Cadastre o domínio.

   ```bash
   gh variable set TF_VAR_ZONE_NAME --body "<DOMINIO>" --repo henriqueluza/aws-cost-playground
   ```

4. Cadastre o e-mail dos alarmes. O comando pede o valor: não o passe na linha de comando. Use sempre o mesmo e-mail; outro valor depois do primeiro deploy vira `replace` da assinatura do SNS, e o plan-guard reprova (`infra/README.md`, "Variáveis do job plan").

   ```bash
   gh secret set TF_VAR_ALARM_EMAIL --repo henriqueluza/aws-cost-playground
   ```

5. Cadastre as variáveis de repositório que saem do bootstrap. Isto liga o job `plan`.

   ```bash
   terraform -chdir=infra/bootstrap output -json github_variables | jq -r 'to_entries[] | "\(.key) \(.value)"' |
     while read -r name value; do
       gh variable set "$name" --body "$value" --repo henriqueluza/aws-cost-playground
     done
   ```

6. Confira o nível do repositório.

   ```bash
   gh variable list --repo henriqueluza/aws-cost-playground --json name --jq '.[].name'
   ```

   ```bash
   gh secret list --repo henriqueluza/aws-cost-playground --json name --jq '.[].name'
   ```

   Como conferir: as quatro variáveis de repositório da tabela e o segredo `TF_VAR_ALARM_EMAIL`. A prova do papel `plan` é o próximo PR que tocar `infra/`: os jobs `plan + plan-guard (staging)` e `plan + plan-guard (production)` rodam, em vez de pulados, e ficam verdes. É o primeiro teste real do trust do papel (`docs/handoff/13.md`).

7. Cadastre o bucket de artefatos no Environment `staging`. O nome vem da saída `github_environment_variables` do bootstrap (#209); se a saída não trouxer `TF_VAR_PACKAGE_BUCKET`, o bootstrap aplicado é anterior à #209: reaplique-o e pare aqui até lá.

   ```bash
   terraform -chdir=infra/bootstrap output -json github_environment_variables | jq -er '.staging.TF_VAR_PACKAGE_BUCKET'
   gh variable set TF_VAR_PACKAGE_BUCKET --env staging --body "<BUCKET_DE_ARTEFATOS_STAGING>" --repo henriqueluza/aws-cost-playground
   ```

   O bucket nasce sem regra de lifecycle. Aplique nele o guardrail 7 de [`guardrails-de-custo.md`](guardrails-de-custo.md) (e no de produção, quando chegar a vez): é configuração de custo, manual.

8. Por último, e só com as Issues da tabela "O que precisa estar em `main` antes" fechadas, cadastre `AWS_APPLY_ROLE_ARN` nos dois Environments. Isto liga o deploy de staging. O laço abaixo grava todas as variáveis da saída, então também põe `TF_VAR_PACKAGE_BUCKET` no Environment `production`.

   ```bash
   terraform -chdir=infra/bootstrap output -json github_environment_variables |
     jq -r 'to_entries[] | .key as $env | .value | to_entries[] | "\($env) \(.key) \(.value)"' |
     while read -r env name value; do
       gh variable set "$name" --env "$env" --body "$value" --repo henriqueluza/aws-cost-playground
     done
   ```

9. Confira o Environment `staging`.

   ```bash
   gh variable list --env staging --repo henriqueluza/aws-cost-playground --json name --jq '.[].name'
   ```

   Como conferir: `AWS_APPLY_ROLE_ARN` e `TF_VAR_PACKAGE_BUCKET`.

10. Confira o Environment `production`.

    ```bash
    gh variable list --env production --repo henriqueluza/aws-cost-playground --json name --jq '.[].name'
    ```

    Como conferir: `AWS_APPLY_ROLE_ARN`.

## 5. Chave da Claude API no SSM (#75 e #77)

O parâmetro `/acp/<env>/anthropic-api-key` é criado à mão, fora do Terraform (decisão da #126). O procedimento está em [rotação de segredos](rotacao-de-segredos.md), seção "Criar o parâmetro pela primeira vez". Não o repita de memória: siga aquela seção.

1. Tenha a chave do workspace `acp-staging`, criada na #75, com o limite de gasto do workspace já definido.

2. Crie o parâmetro de staging pelo console, como manda a seção citada. Ele pode existir antes ou depois do primeiro deploy: o papel do `llm-proxy` aponta para ele pelo nome.

3. Confira sem ler o valor.

   ```bash
   aws ssm describe-parameters --parameter-filters "Key=Name,Values=/acp/staging/anthropic-api-key" --query 'Parameters[].[Name,Type,Tier]' --output text
   ```

   Como conferir: uma linha com o nome, `SecureString` e `Standard`. Nunca use `get-parameter --with-decryption` para conferir.

4. Deixe a LLM desligada. `llm_enabled` é `false` nos dois `terraform.tfvars` e só muda por PR (`infra/README.md`, "Primeiro apply"). Ligar gasta dinheiro: faça depois dos guardrails da #78.

5. O parâmetro de produção segue o mesmo roteiro, com a chave do workspace `acp-production`. [Guardrails de custo](guardrails-de-custo.md) pede os guardrails de produção antes de gravar a chave real de produção.

   Como conferir: o comando do item 3, com `production` no lugar de `staging`.

## 6. Primeiro deploy de staging (#77)

O deploy é o workflow `deploy-staging.yml`, disparado por `push` em `main`. O que cada passo dele faz está em `docs/infra.md`. O caminho recomendado é deixar o próprio pipeline fazer o primeiro apply: ele sobe o zip das funções para `functions/<sha>.zip` antes do Terraform. Um zip posto à mão nessa chave, com outro conteúdo, faz o deploy desse commit falhar fechado (`docs/infra.md`, passo `package`).

**Se um job falhar em `AssumeRoleWithWebIdentity`** (`Not authorized to perform sts:AssumeRoleWithWebIdentity` no passo de credenciais da AWS): é falha fechada, ninguém ganhou acesso. Só o `sub` de `pull_request` foi visto num token real; os de `environment:<env>` e de `ref:refs/heads/main` vêm da documentação do GitHub e se confirmam na primeira execução de cada workflow. Confira, nesta ordem: (a) a variável com o ARN do papel é a do papel certo (`AWS_ROLE_ARN` do Environment, `AWS_PLAN_ROLE_ARN`, `AWS_PRICES_ROLE_ARN`); (b) o job roda em `main` e declara o `environment:` esperado; (c) o comando do passo 3.0 ainda devolve o prefixo esperado; (d) o `sub` que o job recebeu (procure o evento `AssumeRoleWithWebIdentity` negado no CloudTrail, se ele aparecer; senão, peça um passo temporário de conferência como o do PR #388), comparado com a tabela de `infra/bootstrap/README.md`, "Formato do `sub`". Se o `sub` real for outro, o ajuste é em `infra/bootstrap/` (Issue `area:infra-bootstrap`) e exige reaplicar o bootstrap; não afrouxe o trust à mão no console.

1. Confira de novo a tabela "O que precisa estar em `main` antes". Com #338, #209 ou #307 aberta, o deploy falha por permissão, por falta do bucket ou sobe uma função que não importa.

2. Dispare o deploy. O workflow não tem disparo manual: ele roda no próximo merge em `main`. Para não esperar um merge, reexecute a última execução, que terminou verde só com o aviso de deploy pulado.

   ```bash
   gh run list --workflow deploy-staging.yml --branch main --limit 1 --repo henriqueluza/aws-cost-playground --json databaseId,headSha,conclusion
   ```

   ```bash
   gh run rerun <RUN_ID> --repo henriqueluza/aws-cost-playground
   ```

3. Acompanhe.

   ```bash
   gh run watch <RUN_ID> --repo henriqueluza/aws-cost-playground --exit-status
   ```

   A validação dos certificados do ACM e o domínio do Cognito podem levar até cerca de uma hora (`infra/README.md`, "Primeiro apply"), e o job `deploy` tem limite de 45 minutos. Se ele falhar por tempo, use "Re-run failed jobs", que reaproveita o artefato. Não use "Re-run all jobs" depois que o zip já subiu: ele reconstrói o zip com outros bytes. Nunca rode `import` nem comandos de estado.

   ```bash
   gh run rerun <RUN_ID> --failed --repo henriqueluza/aws-cost-playground
   ```

   Se o plano falhar porque o nome `acp-stg-site-aws-cost-playground` já existe no S3 (nome global), o nome muda por PR antes de tentar de novo (`infra/envs/staging/main.tf`, módulo `site`).

4. Confirme a assinatura do SNS: abra o e-mail de confirmação que chega no endereço dos alarmes e clique no link. Sem isso nenhum alarme chega. A conferência por comando está em [alarmes](alarmes.md), "Antes do primeiro alarme".

5. Confira o resultado do pipeline.

   ```bash
   gh run view <RUN_ID> --repo henriqueluza/aws-cost-playground --json conclusion --jq .conclusion
   ```

   Como conferir: `success`, e o resumo da execução mostra o commit, a chave do pacote e o `code_sha256`. O smoke test do próprio workflow já conferiu que o site responde, que o `/config.json` servido é o publicado e que `GET /quota` sem token devolve 401.

6. Confira por fora.

   ```bash
   curl --silent --output /dev/null --write-out '%{http_code}\n' https://staging.<DOMINIO>/
   ```

   ```bash
   curl --silent https://staging.<DOMINIO>/config.json | jq 'keys'
   ```

   ```bash
   curl --silent --output /dev/null --write-out '%{http_code}\n' https://api.staging.<DOMINIO>/quota
   ```

   Como conferir: `200`; as chaves `apiBaseUrl`, `cognitoAuthority` e `cognitoClientId`; e `401`.

7. Para ler as saídas do ambiente na sua máquina (nomes de função, papéis, API), inicialize o backend e leia. São comandos de leitura.

   ```bash
   terraform -chdir=infra/envs/staging init -lockfile=readonly -backend-config="bucket=acp-stg-tfstate-<ACCOUNT_ID>"
   ```

   ```bash
   terraform -chdir=infra/envs/staging output
   ```

   Como conferir: aparecem `function_names`, `function_role_names`, `api_id`, `llm_api_key_parameter_name` (igual ao nome do passo 5) e `alarm_topic_arn` (`infra/envs/staging/outputs.tf`).

O smoke test não invoca nenhuma Lambda (`docs/infra.md`, "Limites conhecidos"). Deploy verde ainda não prova que a API funciona: siga os passos 7 e a seção "O que conferir no primeiro staging".

## 7. Contas de teste no Cognito de staging (#77)

O cadastro é fechado nos dois ambientes (`self_signup_enabled = false` em `infra/envs/<ambiente>/terraform.tfvars`; em produção desde a #383, decisão do autor de 26/11/2026): só o administrador cria contas, o site não mostra "Criar conta" e ninguém se cadastra pelo login gerenciado. Os passos abaixo são os de staging; a sua conta de produção está em "Sua conta em produção", logo depois. O pool se chama `acp-stg-users` e o login é por e-mail (`infra/modules/auth/README.md`). O CI não cria usuários: o papel `apply` tem negação de `cognito-idp:Admin*`.

1. Descubra o id do pool.

   ```bash
   aws cognito-idp list-user-pools --max-results 20 --query "UserPools[?Name=='acp-stg-users'].Id" --output text
   ```

2. Crie a conta. O Cognito manda a senha temporária para o e-mail, válida por 3 dias. Cada conta gasta um dos 50 e-mails diários do remetente padrão.

   ```bash
   aws cognito-idp admin-create-user --user-pool-id <USER_POOL_ID> --username <EMAIL_DE_TESTE> --user-attributes Name=email,Value=<EMAIL_DE_TESTE> Name=email_verified,Value=true
   ```

3. Confira a criação.

   ```bash
   aws cognito-idp admin-get-user --user-pool-id <USER_POOL_ID> --username <EMAIL_DE_TESTE> --query UserStatus --output text
   ```

   Como conferir: `FORCE_CHANGE_PASSWORD`.

4. Entre em `https://staging.<DOMINIO>` com o e-mail e a senha temporária e defina a senha nova, de 15 caracteres ou mais. Guarde-a num cofre de senhas, nunca no repositório.

   Como conferir: o comando do item 3 passa a responder `CONFIRMED`, e o navegador volta para o site já autenticado.

5. Crie pelo menos duas contas. A validação da #80 exclui uma delas pelo próprio produto.

Use dados fictícios em staging (ADR, tabela de ambientes). Não anote e-mail nem senha de conta de teste em Issue, PR ou commit.

### Sua conta em produção (#383)

Faça depois do primeiro deploy de produção (#80). Os comandos rodam na sua sessão de administrador; o CI não cria usuários. Use o seu e-mail real só no terminal: ele não vai para Issue, PR, commit nem para este arquivo.

1. Descubra o id do pool de produção.

   ```bash
   aws cognito-idp list-user-pools --max-results 20 --query "UserPools[?Name=='acp-prod-users'].Id" --output text
   ```

2. Confira que o cadastro está fechado.

   ```bash
   aws cognito-idp describe-user-pool --user-pool-id <USER_POOL_ID> --query "UserPool.AdminCreateUserConfig.AllowAdminCreateUserOnly" --output text
   ```

   Como conferir: `True`. O site (`https://<DOMINIO>`) mostra só "Entrar" na barra do editor, e `https://<DOMINIO>/config.json` traz `"selfSignupEnabled": false`.

3. Crie a conta. O Cognito manda a senha temporária para o e-mail, válida por 3 dias, e gasta um dos 50 e-mails diários do remetente padrão.

   ```bash
   aws cognito-idp admin-create-user --user-pool-id <USER_POOL_ID> --username <SEU_EMAIL> --user-attributes Name=email,Value=<SEU_EMAIL> Name=email_verified,Value=true
   ```

   Pelo console, o mesmo: Cognito → User pools → `acp-prod-users` → Users → Create user, com convite por e-mail, o e-mail como nome de usuário, "Mark email address as verified" marcado e senha gerada.

4. Entre em `https://<DOMINIO>` → "Entrar", com o e-mail e a senha temporária. O login gerenciado pede a senha definitiva (15 caracteres ou mais) antes de voltar ao site. Guarde-a num cofre de senhas.

   Como conferir: o site volta autenticado, com o seu e-mail na barra, e o comando abaixo responde `CONFIRMED`.

   ```bash
   aws cognito-idp admin-get-user --user-pool-id <USER_POOL_ID> --username <SEU_EMAIL> --query UserStatus --output text
   ```

Vale saber:

- **Senha temporária vencida** (3 dias sem o primeiro acesso): repita o comando do passo 3 acrescentando `--message-action RESEND`.
- **"Esqueci a senha"** continua na tela do login gerenciado e funciona com o cadastro fechado, mas só para conta `CONFIRMED` com e-mail verificado. Antes do primeiro acesso (`FORCE_CHANGE_PASSWORD`), use o reenvio acima.
- **Conta para outra pessoa** (um avaliador, por exemplo): os mesmos passos 3 e 4, com o e-mail dela. Cada conta volta a expor os riscos de usuário logado que o cadastro fechado tirou de alcance (ADR, "Cadastro fechado"); as quotas da LLM continuam valendo.

### Reabrir o cadastro

Não é só trocar a variável. Antes, precisam estar em `main` a opção a da #277 e a opção b da #284 (ADR, "Cadastro fechado"). Depois, por PR com revisão normal: `self_signup_enabled = true` em `infra/envs/production/terraform.tfvars`. O plano mostra uma atualização in-place do pool (`allow_admin_create_user_only: true → false`), sem substituição, e o deploy seguinte publica `"selfSignupEnabled": true` no `/config.json`: o site volta a mostrar "Criar conta" sem novo build.

## 8. Catálogo de preços (#77)

O catálogo versionado em `web/public/prices/` é a semente. O gerador (`pricing/`) consulta a Price List API e regrava os arquivos; o PR com o catálogo real é revisado e mergeado por um humano. O workflow `.github/workflows/prices.yml` (#222) faz isso toda segunda-feira, 09:17 UTC, e também por disparo manual. Ele só roda em `main`.

### Primeira execução do workflow

1. O papel `prices` sai do bootstrap (#125, passo 3). Cadastre a variável de repositório `AWS_PRICES_ROLE_ARN` com o valor da saída `github_variables` (`infra/bootstrap/README.md`, "Saídas que viram variáveis do GitHub"). Sem ela o workflow só avisa (`::warning::`), termina verde e o job `publish` é pulado.

   ```bash
   gh variable list --repo henriqueluza/aws-cost-playground
   ```

   Como conferir: a lista traz `AWS_PRICES_ROLE_ARN`.

2. Ligue "Allow GitHub Actions to create and approve pull requests" em Settings → Actions → General. Sem isso o `gh pr create` falha com 403 (`scripts/prices-pr.sh`, mensagem de erro de `create_pr`). Essa opção também permite que workflows aprovem PR: é decisão de segurança do autor. Opcional: ligue "Automatically delete head branches", para que o PR seguinte não liste commits antigos da branch `prices/catalogo` depois de um squash merge (a árvore continua certa; é só ruído).

   Como conferir: a opção aparece marcada em Settings → Actions → General.

3. Dispare o workflow à mão em `main` e acompanhe.

   ```bash
   gh workflow run prices.yml --repo henriqueluza/aws-cost-playground --ref main
   gh run list --workflow prices.yml --repo henriqueluza/aws-cost-playground --limit 1
   ```

   Como conferir: os jobs `generate` e `publish` terminam verdes. O resumo do run traz o corpo do PR. O passo "Publicar PR" imprime `pr criado` (ou `sem mudança`, se o catálogo já for igual ao de `main`). Um aviso `Nenhum serviço com consulta` significa que o gerador não gravou nada (nenhum serviço consulta a Price List ainda): nesse caso o job `publish` é pulado, e um PR já aberto fica como está.

4. Faça a validação do PR (próxima subseção), revise e decida o merge.

### Como o PR do catálogo é validado e juntado

O workflow tem dois jobs, para que nenhum passo tenha ao mesmo tempo credencial da AWS e token de escrita: `generate` (papel `prices` por OIDC, só `pricing:GetProducts`, sessão de 900 s, `contents: read`) entrega o catálogo e o corpo do PR num artefato de 1 dia; `publish` (sem AWS, `contents: write` e `pull-requests: write`) aplica o artefato em `web/public/prices/` e roda `scripts/prices-pr.sh` com o `GITHUB_TOKEN`.

**Passo manual: o PR do bot não roda o CI.** PR aberto ou atualizado pelo `GITHUB_TOKEN` não dispara os workflows de `pull_request` (`validate`, `security`, `pr-size`, `review-pr`). Antes de juntar:

- feche e reabra o PR com a sua conta: o evento `reopened` feito por uma pessoa dispara todos, inclusive a revisão automática; ou
- empurre um commit vazio na branch `prices/catalogo` com a sua conta.

Cada atualização semanal feita pelo bot (push novo na branch) também não dispara o CI: repita o passo antes de juntar. Não usamos token pessoal nem GitHub App para evitar isso, porque seria um segredo novo; a decisão é do autor e não está implementada.

Como o PR é revisado e juntado:

- O workflow não aplica label nenhuma (nem `skip-review`, nem aprovação) e não junta o PR. O merge é humano (ADR-0001, ameaça dos preços).
- `web/public/prices/**` não conta no `pr-size` (`.github/pr-size-ignore`). O CODEOWNERS é o autor.
- Confira o corpo (SKUs adicionados, removidos e variações acima de 30%), que o diff só mexe em `web/public/prices/` e que o CI ficou verde depois do reabrir. Então decida o merge.
- Se o catálogo gerado voltar a ser igual ao de `main`, o script fecha o PR sozinho, com um comentário.

Como conferir:

```bash
gh pr list --head prices/catalogo --repo henriqueluza/aws-cost-playground --json number,state,url
```

O PR só mexe em `web/public/prices/` e o CI está verde. Depois do merge, `web/public/prices/manifest.json` em `main` traz `"source": "price-list"`. Enquanto algum serviço registrado for provisório (sem consulta), o gerador grava `"source": "seed"` (`pricing/README.md`, "Serviço provisório e gravação"): nesse caso, anote na #77 quais serviços faltam.

### Contingência: rodar na sua máquina

Use se o workflow estiver indisponível. Na raiz do repositório, com `HEAD` igual a `origin/main`, a árvore limpa e sessão da AWS com `pricing:GetProducts`:

```bash
(cd pricing && uv sync && uv run python -m app generate > report.txt && uv run python -m app.summary < report.txt > body.md)
bash scripts/prices-pr.sh pricing/body.md
rm pricing/report.txt pricing/body.md
```

Como conferir: `git status --short web/public/prices` lista os arquivos regravados e o script imprime uma linha entre `pr criado`, `pr atualizado`, `sem mudança` e `pr fechado`. Se a última linha de `pricing/report.txt` for `nenhum serviço com consulta: nada a gravar`, nada foi atualizado. O PR vem do seu `gh`, então o CI roda sozinho, sem fechar e reabrir.

## O que conferir no primeiro staging

Riscos já registrados no projeto que nenhum teste com provider simulado prova. Só a conta real responde. Para ler log, use a sua sessão de administrador: os papéis de CI não leem eventos de log.

| Risco | Onde está | Como testar | Se falhar |
|---|---|---|---|
| A condição `lambda:SourceFunctionArn` do limite de permissões vale para os papéis das funções | `infra/bootstrap/boundary.tf` (`TableItems`, `DeleteOwnAccount`, `ClaudeApiKey`); `infra/bootstrap/README.md`, "Limite de permissões"; `docs/handoff/166.md` | Com uma conta de teste logada, abra o site: a leitura da quota (`GET /quota`, função `llm-proxy`) responde 200. Depois procure negações no log, com o comando abaixo da tabela | A falha é fechada: `AccessDenied` no dado e resposta 503. A correção é no bootstrap, por Issue que o autorize, e o autor reaplica |
| A transação de quota passa com as permissões atuais | `api/app/quotas/repository.py` (`increment`, `transact_write_items`); o papel só tem `dynamodb:GetItem` e `dynamodb:UpdateItem` (`infra/modules/functions/iam.tf`, política `access` do `llm-proxy`) | Só dá para testar com a chave no SSM e `llm_enabled = true` (com `false`, o consumo responde 503 antes de tocar a tabela). Faça uma estimativa e confira que o restante da quota diminui em 1 | 503 com `error_type` `AccessDeniedException` no log do `llm-proxy`. Abra Issue no módulo `functions` e no limite do bootstrap |
| Login real no Cognito | `infra/modules/auth/README.md`, "Conferir no primeiro apply de staging"; `web/src/features/auth/infrastructure/cognitoProvider.ts`; `web/src/app/router.tsx` (`/auth/callback`); `docs/handoff/52.md` | Passo 7, item 4: o login gerenciado em `auth.staging.<DOMINIO>` oferece e-mail e senha, o retorno cai em `/auth/callback` e o site abre autenticado. Saia e entre de novo | Se a página não oferecer usuário e senha, o plano B é acrescentar `ALLOW_USER_SRP_AUTH` por PR (nunca `ALLOW_USER_PASSWORD_AUTH`) |
| A identidade é o claim `sub` | `api/app/auth.py` (`_CLAIM_PATH`); regra do projeto | No log do `llm-proxy`, os eventos de quota trazem `sub` em formato UUID, e duas contas de teste têm quotas separadas | Qualquer outro claim como identidade é achado de segurança: abra Issue `security:sensitive` |
| CORS do API Gateway | `infra/modules/http-api/main.tf` (bloco de CORS: origem do site, cabeçalhos `authorization` e `content-type`); `infra/envs/staging/main.tf` (`cors_allowed_origins`) | Comando de preflight abaixo da tabela. No navegador, o console não mostra erro de CORS ao carregar a quota | Ajuste por PR no módulo `http-api` |
| Resposta 401 do authorizer | `docs/handoff/51.md` ("CORS"); `.github/workflows/deploy-staging.yml`, passo `smoke` | Passo 6, item 6, devolve 401. No navegador, com a sessão expirada (15 minutos de token), veja se o site pede login de novo ou mostra erro de rede: um 401 sem cabeçalhos de CORS chega ao navegador como falha de rede | Registre o comportamento numa Issue do `web/`; não é falha de segurança |
| Runtime das Lambdas diferente do pacote | `infra/modules/functions/main.tf` (`runtime`); `api/.python-version`; Issue #307 | Comando de runtime abaixo da tabela, e uma chamada autenticada qualquer responde sem 5xx. O alarme `acp-stg-api-errors` fica em OK | Não siga com a #307 aberta: o smoke não invoca a função e o deploy fica verde com um zip que não importa |

Negações de acesso no log de uma função (repita com `acp-stg-api`):

```bash
aws logs filter-log-events --log-group-name /aws/lambda/acp-stg-llm-proxy --filter-pattern AccessDenied --max-items 5 --query 'events[].message'
```

Como conferir: lista vazia.

Preflight de CORS a partir da origem do site:

```bash
curl --silent --include --request OPTIONS https://api.staging.<DOMINIO>/quota --header "Origin: https://staging.<DOMINIO>" --header "Access-Control-Request-Method: GET" --header "Access-Control-Request-Headers: authorization"
```

Como conferir: a resposta traz `access-control-allow-origin: https://staging.<DOMINIO>`. Repetindo com outra origem no cabeçalho `Origin`, esse cabeçalho não vem.

Runtime em uso:

```bash
aws lambda get-function-configuration --function-name acp-stg-api --query Runtime --output text
```

Como conferir: `python3.14`, a versão de `api/.python-version`. Enquanto a #307 estiver aberta, o comando responde `python3.13`.

O roteiro completo de validação do produto (salvar design, re-estimar, exportar, excluir a conta) é da #80.

## Guardrails de custo

A configuração de custo na conta (AWS Budgets com alertas e ação de corte, limite de taxa, concorrência reservada, retenção de logs, lifecycle do S3 e limite de gasto dos workspaces da Anthropic) é manual, do autor, por decisão do Gate 1 (ADR, "Guardrails de custo"). Ela não é automatizada e este runbook não define nenhum valor.

- O teto de hospedagem é US$ 20 por mês (ADR, "Contexto" e "Custo de infra em três cenários"). O único custo fixo é a zona do Route 53.
- O que fazer e em que ordem está na Issue #78, que segue [guardrails de custo](guardrails-de-custo.md). Faça depois do passo 6 e antes de mudar `llm_enabled` para `true`.
- Qualquer valor novo (orçamento, limite, serviço pago) é decisão do autor, registrada na #78 ou no ADR. Agentes não propõem nem aplicam valores de custo.

## Verificação final

- [ ] Plano da conta, condições do Free Tier e quota de concorrência anotados na #77.
- [ ] Uma zona pública para `<DOMINIO>`, com a delegação conferida.
- [ ] Bootstrap aplicado; cópia do estado local guardada fora do repositório.
- [ ] Environments `staging` e `production` restritos a `main`; variáveis e segredo da tabela do passo 4 cadastrados.
- [ ] Parâmetro `/acp/staging/anthropic-api-key` criado como `SecureString`; `llm_enabled` ainda `false`.
- [ ] Deploy de staging verde, assinatura do SNS confirmada e as três conferências por `curl` corretas.
- [ ] Contas de teste criadas e com login feito.
- [ ] PR do catálogo real mergeado.
- [ ] Seção "O que conferir no primeiro staging" percorrida, com Issue aberta para cada falha.
- [ ] Nenhum id de conta, ARN, e-mail ou segredo escrito em Issue, PR, commit ou neste arquivo.
