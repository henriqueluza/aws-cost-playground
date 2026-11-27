# Revisão de segurança antes da produção

Issue #73, em duas rodadas. A primeira (#73) fez a auditoria do repositório inteiro contra o threat model do ADR (`docs/architecture/aws-cost-playground/ADR-0001-stack.md`, seção "Segurança", ameaças T1 a T6).

- **Data:** 26/11/2026. **Commit auditado:** `4f2a233` (`main` no início da revisão). Durante a revisão `main` avançou até `86442c2`; esse delta não foi auditado (ver "Fora desta rodada"), mas os testes novos rodam verdes sobre ele.
- **Resultado:** nenhum achado crítico. Um achado **alto**, no CI (agente revisor de PR, #364). Um médio, doze baixos e três informativos, cada um com Issue ou corrigido neste PR. Nenhum segredo no repositório nem no histórico. Nenhuma dependência com vulnerabilidade conhecida.
- **Segunda rodada (#375), 26/11/2026, sobre `6801232`:** auditou o delta `4f2a233..6801232`, que inclui a API e a tela de alterar, duplicar e apagar designs, as rotas de designs no API Gateway, os designs salvos na comparação e o `export-validate.yml`. Não há achado crítico nem alto. Há um médio (DSN-1, que amplia a #277) e um informativo (INP-1, #381). As cinco conferências foram refeitas no estado final. Ver "Segunda rodada: o delta".

O repositório é público. O achado alto está descrito aqui em termos gerais; o caminho de exploração foi entregue ao autor fora do repositório.

## Método

| Etapa | Como |
|---|---|
| Revisão manual por área (api, web, infra, CI) | Skills `security-review` e `owasp-security` (Top 10:2025 e Top 10 de LLM), um revisor por área, leitura dos arquivos inteiros |
| Agente em workflow | Skill `agentic-actions-auditor` em `review-pr.yml` |
| Análise estática | Semgrep 1.182.0 com `p/default`, `p/owasp-top-ten`, `p/security-audit`, `p/python`, `p/typescript`, `p/react`, `p/javascript`, `p/terraform`, `p/github-actions`, `p/secrets`: 784 arquivos, 24 achados (0 ERROR) |
| Segredos | gitleaks 8.30.1 no histórico de todas as refs e no estado atual, mais busca dirigida por padrões. O CI usa a 8.21.2, só sobre o checkout do PR |
| Dependências | Skill `supply-chain-risk-auditor`, `npm audit` (com e sem dev), `pip-audit` 2.10.1 e consulta à OSV com todos os pacotes dos dois `uv.lock` |
| Padrões inseguros | Categorias da skill `insecure-defaults`, por leitura dirigida dos pontos de configuração (ver "O que não rodou") |
| Falsos positivos | Cada achado candidato passou pela skill `fp-check`, com um verificador que não participou da descoberta e tinha a tarefa de refutar |

As provas são de leitura do código e dos testes, e da execução das suítes locais. Nada foi executado contra a AWS, a Anthropic ou um ambiente publicado.

## Resultado por ameaça

Caminhos relativos à raiz do repositório. "Teste" traz o arquivo e o nome do teste.

### T1. Abuso de custo da LLM

**Veredito: mitigada na aplicação, com uma ressalva (API-1).** Os guardrails da conta (Budgets, limite do workspace da Anthropic) são manuais e não são verificáveis pelo repositório.

| Mitigação | Onde | Teste |
|---|---|---|
| Ordem: tamanho e interruptor, depois quota, depois LLM | `api/app/estimates/service.py:61-64` | `api/tests/test_estimates_route.py::test_sucesso_segue_a_ordem_e_devolve_so_ids_numeros_e_quota` |
| Quota do usuário e global numa transação, sem leitura antes | `api/app/quotas/repository.py:23-24,52-62,89-94` | `api/tests/test_quotas.py::test_transacao_unica_com_dois_updates_condicionais`, `::test_consumos_simultaneos_nunca_passam_dos_limites` |
| Quota esgotada responde 429 sem chamar a LLM | `api/app/quotas/service.py:101-104` | `test_estimates_route.py::test_quota_esgotada_responde_429_e_a_llm_nao_e_chamada` |
| Erro ou dúvida do DynamoDB responde 503 sem chamar a LLM | `api/app/quotas/repository.py:65-76` | `test_estimates_route.py::test_quota_indisponivel_responde_503_e_a_llm_nao_e_chamada` |
| Falha da LLM não devolve quota; sem nova tentativa | `api/app/estimates/service.py:71-73,85-86` | `test_estimates_route.py::test_falha_da_llm_depois_do_consumo_e_logada_e_a_quota_nao_volta`, `::test_o_codigo_da_rota_nao_tem_devolucao_de_quota_nem_nova_tentativa` |
| Descrição até 2.000, 100 blocos, 400 arestas | `api/app/design_document.py:33-35,120`, `api/app/estimates/prompt.py:95-100` | `test_estimates_route.py::test_entrada_invalida_nao_consome_quota_nem_chama_a_llm`, `api/tests/test_estimate_revalidation.py::test_limites_do_adr_sao_conferidos_de_novo_antes_da_chamada` |
| Corpo até 1 MiB; `doc` até 100.000 bytes; 10 designs (#386; eram 350.000 e 50) | `api/app/routing.py:11,28-30`, `api/app/designs/schemas.py:18,30-33`, `api/app/designs/service.py:53,73-79` | `api/tests/test_routes.py::test_corpo_acima_do_teto_responde_413_antes_de_validar`, `::test_limite_de_bytes_do_doc`, `api/tests/test_designs.py::test_criacoes_simultaneas_nao_passam_do_limite` |
| `max_tokens` fixo (4096) | `api/app/estimates/prompt.py:16`, `api/app/estimates/claude_client.py:134` | `api/tests/test_claude_client.py::test_chamada_tem_system_fixo_dado_na_mensagem_do_usuario_e_nenhuma_ferramenta` |
| Timeout de 20 s e `max_retries=0` no SDK | `api/app/estimates/claude_client.py:42,45,76` | `test_claude_client.py::test_cliente_do_processo_le_modelo_e_chave_da_configuracao` |
| `LLM_ENABLED` nasce desligada; desligada responde 503 sem quota, sem SSM e sem LLM | `api/app/config.py:34`, `api/app/estimates/claude_client.py:113-114` | `test_estimates_route.py::test_interruptor_desligado_responde_503_sem_quota_e_sem_llm`, `::test_sem_a_variavel_llm_enabled_a_rota_nasce_desligada` |
| Quotas padrão de 5 por usuário e 30 globais por dia (#384; eram 20 e 300) e tetos no código (100 e 1.000) | `api/app/config.py:13-14,21-22,42-47` | `test_quotas.py::test_limites_padrao_sao_os_do_adr_e_vem_do_ambiente`, `::test_configuracao_invalida_ou_acima_do_teto_impede_a_funcao_de_subir` |
| Limite de taxa: 10 rps no stage, 1 rps em `POST /estimates` | `infra/modules/http-api/stage.tf:37-51`, `infra/envs/*/terraform.tfvars` | `infra/modules/http-api/tests/http_api.tftest.hcl` (`limite_de_taxa_por_rota`); ligação no ambiente: `infra/tools/tests/test_security_review.py::ApiEdge::test_toda_rota_usa_o_authorizer_jwt_do_pool_do_ambiente` (novo) |
| Timeout de 29 s (proxy) e 10 s (api); sem URL de função | `infra/modules/functions/main.tf:20,28` | `infra/modules/functions/tests/functions.tftest.hcl` (`funcoes_logs_e_ambiente`); `test_security_review.py::ModulesAndEnvs::test_nada_proibido_em_modulos_e_ambientes` (novo) |

Só `estimate_usage` chama a LLM (`messages.create` aparece uma vez, em `claude_client.py:132`). Não há caminho até a LLM sem passar pela quota.

### T2. Prompt injection

**Veredito: mitigada.**

| Mitigação | Onde | Teste |
|---|---|---|
| Prompt de sistema constante; nenhuma ferramenta | `api/app/estimates/prompt.py:22-42`, `api/app/estimates/claude_client.py:132-142` | `test_claude_client.py::test_chamada_tem_system_fixo_dado_na_mensagem_do_usuario_e_nenhuma_ferramenta` |
| À LLM só vão tipo, atributos de conjunto fechado, arestas por posição e a descrição. Rótulo, id, região e `sub` não vão | `api/app/estimates/prompt.py:107-131` | `test_estimate_revalidation.py::test_so_o_minimo_vai_para_a_llm` |
| A descrição não fecha o delimitador (`<` e `>` escapados) | `api/app/estimates/prompt.py:83-86,134-136` | `test_estimate_revalidation.py::test_descricao_nao_fecha_o_delimitador` |
| Saída por schema só numérico, com chaves em enum | `api/app/estimates/prompt.py:55-80` | `test_estimate_revalidation.py::test_schema_de_saida_so_tem_numeros_e_chaves_de_conjunto_fechado` |
| Revalidação: posição fora do diagrama, chave não aceita e número fora de faixa são descartados | `api/app/estimates/revalidation.py:34-79` | `test_estimate_revalidation.py::test_id_fora_do_diagrama_e_descartado`, `::test_chave_que_o_tipo_nao_aceita_e_campo_extra_sao_descartados`, `test_claude_client.py::test_injecao_nunca_produz_campo_fora_do_schema_nem_valor_fora_de_faixa` |
| `stop_reason` diferente de `end_turn` vira erro, sem usar a resposta | `api/app/estimates/claude_client.py:150-152` | `test_claude_client.py::test_stop_reason_diferente_de_end_turn_vira_erro_sem_usar_a_resposta` |
| A resposta HTTP só tem ids do pedido, números e enum | `api/app/estimates/service.py:48-49,66-68`, `api/app/estimates/schemas.py:44-61` | `test_estimates_route.py::test_texto_devolvido_pela_llm_nao_chega_a_resposta` |
| Exceção do SDK não chega ao cliente nem ao log | `api/app/estimates/claude_client.py:143-148` | `test_claude_client.py::test_erro_da_anthropic_vira_erro_de_mensagem_fixa` |
| No site: a resposta só tem ids, números e enum; o cliente revalida | `web/src/shared/lib/api/ports.ts:61-70`, `web/src/features/workload/model/estimateModel.ts:69-86,113-138` | `ports.test.ts` "aceita só números com a quota"; `estimateModel.test.ts` "aceita as chaves boas de um item e descarta as ruins; vale a primeira repetição" |
| No site: erro HTTP vira só um código; texto do servidor é ignorado e a frase exibida é do cliente | `web/src/shared/lib/http/transport.ts:96-109,163-167`, `web/src/features/workload/model/messages.ts:11-56` | `transport.test.ts` "%i vira %s, sem texto do servidor"; `messages.test.ts` "toda falha tem frase própria, sem marcação" |

O que o modelo pode fazer com uma descrição maliciosa: devolver números dentro das faixas do contrato para as posições do pedido. Não tem ferramenta, não vê segredo, e nada do que escreve é exibido.

### T3. Acesso ao design de outro usuário

**Veredito: mitigada no commit auditado.** Atualizar, renomear, duplicar e apagar respondiam 501 nesse commit; a implementação entrou em `main` durante a revisão e fica para a #375.

| Mitigação | Onde | Teste |
|---|---|---|
| Identidade só de `requestContext.authorizer.jwt.claims.sub`; ausente ou fora do formato responde 401 | `api/app/auth.py:14-37` | `api/tests/test_auth.py::test_sem_identidade_valida_responde_401`, `::test_so_auth_le_a_identidade_do_evento` |
| Toda rota exige identidade antes de ler o corpo | `api/app/routing.py:27-31` | `test_routes.py::test_conjunto_exato_de_rotas_e_status_de_sucesso`, `::test_ordem_401_422_501` |
| Corpo, cabeçalho e query não escolhem partição nem id | `api/app/designs/repository.py:46-56` | `test_designs.py::test_corpo_cabecalho_e_query_nao_escolhem_particao_nem_id`, `test_estimates_route.py::test_identidade_vem_so_do_sub_do_jwt`, `api/tests/test_account.py::test_nada_na_requisicao_muda_o_alvo` |
| Ler e listar só a partição do dono; design alheio responde 404 igual a inexistente | `api/app/designs/repository.py:101,121-125` | `test_designs.py::test_acesso_cruzado_e_404_igual_a_inexistente` |
| `designId` validado como ULID; `sub` revalidado antes de virar chave | `api/app/designs/router.py:38`, `api/app/designs/repository.py:48,54`, `api/app/quotas/service.py:57` | `test_routes.py::test_design_id_fora_do_formato_ulid_responde_422`, `test_designs.py::test_repositorio_recusa_sub_fora_do_formato`, `test_quotas.py::test_sub_fora_do_formato_nunca_vira_chave` |
| Exclusão só da partição e do usuário do token; nenhuma rota com usuário no caminho | `api/app/account/router.py:18-26` | `test_account.py::test_apaga_a_particao_inteira_e_o_usuario_e_so_os_de_quem_chama`, `::test_nao_existe_rota_com_usuario_no_caminho` |
| Toda rota do API Gateway com authorizer JWT; `$default`, `ANY` e `OPTIONS` recusados; `execute-api` desligado | `infra/modules/http-api/main.tf:15,62-70`, `infra/modules/http-api/variables.tf:79-84` | `http_api.tftest.hcl` (`toda_rota_exige_jwt`, `rota_default_e_rejeitada`); `test_security_review.py::ApiEdge::test_toda_rota_usa_o_authorizer_jwt_do_pool_do_ambiente` (novo) |
| Papel da `api` só alcança partições `USER#*` | `infra/modules/functions/iam.tf:49-55` | `functions.tftest.hcl` (`papeis_de_menor_privilegio`) |

Nenhum uso de id de usuário vindo de corpo, query, caminho ou cabeçalho em `api/app`. Rotas publicadas hoje: `POST /estimates`, `GET /quota`, `DELETE /me` (`infra/envs/*/main.tf:86-90`); as de designs só existem na aplicação.

### T4. XSS por design importado ou rótulo

**Veredito: mitigada, com uma lacuna de prova (INF-1): nenhum teste roda o app sob a CSP real (#374).**

| Mitigação | Onde | Teste |
|---|---|---|
| Arquivo: tamanho conferido antes de ler, 100 blocos antes do `JSON.parse`, zod antes da store | `web/src/features/editor/model/designFile.ts:77-104`, `web/src/features/editor/ui/DesignFileActions.tsx:88-94` | `designFile.test.ts` "arquivo grande demais é recusado sem ser lido"; `DesignFileActions.test.tsx` "com design vazio, abre direto e usa a store só depois de validar" |
| Limites do documento e ids por regex | `web/src/shared/lib/design/designDocument.ts:16-65,86-87` | `designDocument.test.ts` "aceita até maxBlocks blocos e recusa um a mais" |
| `__proto__` e `constructor` | `designDocument.ts:31-34` | `designFile.test.ts` "__proto__ em qualquer nível não polui o protótipo e é descartado" |
| Rótulo, nome e e-mail só como texto React | `web/src/features/editor/ui/BlockNode.tsx:20-22`, `web/src/features/designs/ui/DesignsPage.tsx:50-51` | `CanvasPanel.test.tsx` "mostra o rótulo com marcação como texto, nunca como HTML"; `web/src/features/compare/ui/CompareTable.test.tsx` "tipo desconhecido e rótulo com HTML saem só como texto" |
| Nenhum sorvedouro de HTML ou de código pelos padrões conhecidos (`dangerouslySetInnerHTML`, `innerHTML`, `eval` e afins; busca textual, não pega forma ofuscada como `window['eval']`) | todo `web/src` | `web/src/security.test.ts` "nenhum arquivo usa %s" (novo) |
| Bundle sem `data:` e sem script ou estilo inline | `web/vite.config.ts:16`, `web/tooling/noDataUri.ts` | `tooling/noDataUri.test.ts` "falha o build com URI data: em chunk" |
| CSP no CloudFront, nos dois comportamentos de cache | `infra/modules/site/headers.tf:2-15,27-30`, `infra/modules/site/cloudfront.tf:56,66` | `test_security_review.py::ContentSecurityPolicy::test_csp_inteira_e_fixada_diretiva_a_diretiva` (novo; o teste do módulo só conferia trechos) |
| Export de Terraform: rótulo só vira comentário e, saneado, nome de recurso | `web/src/features/export/model/hcl.ts:67-122`, `web/src/features/export/model/names.ts:11-23` | `web/src/features/export/model/hcl.test.ts` (carga `%s` fica presa dentro de um literal de uma linha); `web/src/features/export/application/exportDesign.test.ts` (a carga `%s` no rótulo não cria nem altera linha de código). As 16 cargas estão em `web/src/features/export/test/injectionPayloads.ts`; nos nomes reais dos testes o `%s` vem entre aspas |

### T5. Vazamento da chave ou de credencial de CI

**Veredito: mitigada na aplicação e no IAM. No CI há um achado alto (CI-1) e um médio (CI-2).**

| Mitigação | Onde | Teste |
|---|---|---|
| Chave lida do SSM em execução, uma vez por processo; não aparece em `repr` nem em log | `api/app/estimates/claude_client.py:162-178,185-195` | `test_claude_client.py::test_chave_e_lida_do_ssm_uma_vez_e_nao_aparece_em_repr_nem_em_log` |
| Erro do SSM não vaza | `claude_client.py:173-176` | `test_claude_client.py::test_parametro_ausente_ou_vazio_vira_indisponivel_sem_vazar_o_erro_da_aws` |
| A função recebe só o nome do parâmetro; só o `llm-proxy` tem `ssm:GetParameter` | `infra/modules/functions/main.tf:8-9,32`, `infra/modules/functions/iam.tf:74-75` | `functions.tftest.hcl` (`papeis_de_menor_privilegio`, `parametro_da_chave_fica_fora_do_terraform`) |
| Limite de permissões com `lambda:SourceFunctionArn` | `infra/bootstrap/boundary.tf:42-68` | `infra/bootstrap/tests/boundary.tftest.hcl` (`limite_de_permissoes`) |
| `plan` nega `ssm:GetParameter*`; `apply` nega `ssm:*` | `infra/bootstrap/plan.tf:66-69`, `infra/bootstrap/apply.tf:89-96` | `infra/bootstrap/tests/bootstrap.tftest.hcl` (`papel_plan_somente_leitura`), `apply.tftest.hcl` (`negacoes_do_papel_apply`) |
| Log por allowlist: sem cabeçalho, corpo, query nem e-mail; rota por template | `api/app/logs.py:14-19,53,105-113` | `api/tests/test_logs.py::test_request_log_has_id_and_no_sensitive_data`, `::test_formatter_drops_fields_outside_allowlist` |
| 422 sem eco do corpo; 500 sem detalhe; `/docs` desligado | `api/app/errors.py:47-62`, `api/app/main.py:18` | `api/tests/test_errors.py::test_validation_error_never_echoes_input`, `api/tests/test_main.py::test_documentacao_automatica_desligada` |
| Tokens do usuário só em memória; ID token não é guardado | `web/src/features/auth/infrastructure/memorySessionStore.ts:9-26` | `memorySessionStore.test.ts` "não grava nada em sessionStorage, localStorage nem cookie"; `web/src/security.test.ts` "sessionStorage só na tentativa de login e no rascunho do design" (novo) |
| `Authorization` só para a origem da API; sem cookie; não segue redirecionamento | `web/src/shared/lib/http/transport.ts:113-126,147-158` | `transport.test.ts` "não segue redirecionamento: o token não chega a outra origem" |
| OIDC sem chave estática; trust por igualdade em `aud` e `sub` | `infra/bootstrap/oidc.tf:8-15`, `plan.tf:18-23`, `apply.tf:37-43`, `prices.tf:18-23` | `bootstrap.tftest.hcl` (`trust_do_papel_plan`), `apply.tftest.hcl` (`trust_dos_papeis_apply`); `infra/tools/tests/test_workflow_deploy_staging.py::test_no_static_aws_credentials` |
| Regras da casa em todos os workflows: sem `pull_request_target`, sem expressão em `run:`, OIDC e environment só nos jobs conhecidos, actions por SHA | `.github/workflows/*.yml` | `infra/tools/tests/test_workflows_all.py` (novo; antes só os deploys e o `prices` tinham teste) |
| gitleaks (checkout com o histórico inteiro, `fetch-depth: 0`) e Semgrep em todo PR, falhando fechado | `.github/workflows/security.yml:2-5,16,22-26` | `test_workflows_all.py::EveryWorkflow::test_semgrep_e_gitleaks_rodam_em_todo_pr_e_falham_fechado` (novo). São checks obrigatórios do ruleset de `main` (`validate`, `semgrep`, `gitleaks`, `pr-size`) |

### T6. Adulteração dos preços

**Veredito: parcialmente mitigada.** O caminho técnico está fechado; duas das três mitigações do ADR não estão provadas (TST-1 e CI-4).

| Mitigação | Onde | Teste |
|---|---|---|
| Papel `prices` só tem `pricing:GetProducts` | `infra/bootstrap/prices.tf:36-49` | `infra/bootstrap/tests/prices.tftest.hcl` (`papel_prices_so_le_a_price_list`) |
| Credencial da AWS e token de escrita em jobs separados; o workflow nunca faz merge nem rotula | `.github/workflows/prices.yml:41-43,127-129`, `scripts/prices-pr.sh:124` | `infra/tools/tests/test_workflow_prices.py::test_aws_job_cannot_write_and_publish_job_has_no_oidc`, `::test_no_forbidden_publication_command_in_workflow` |
| Texto da AWS tratado como dado; schema e regressão bloqueiam a gravação | `pricing/app/schema.py:112-170`, `pricing/app/checks.py:39-66` | `pricing/tests/test_generate.py::test_output_outside_the_schema_blocks`, `pricing/tests/test_checks.py::test_regression_blocks_broken_answers` |
| Sem path traversal na gravação | `pricing/app/catalog.py:12-16`, `pricing/app/generate.py:137-145` | `test_generate.py::test_write_only_inside_the_output_directory` |
| Manifest com SHA-256, conferido no navegador | `web/src/features/pricing/application/loadCatalog.ts:47-50,70-75` | `loadCatalog.test.ts` (caso "hash diferente do manifest"); `pricing/tests/test_seed_catalog.py::test_versioned_manifest_matches_the_versioned_files` |
| Produção recusa catálogo que não veio da Price List | `infra/tools/release_gate.py:124-130` | `infra/tools/tests/test_release_gate.py::test_seed_is_refused_naming_the_reason` |
| "Testes de cenário reprovam desvio" (±15%) | não existe | **Sem teste.** É a #81, aberta. Hoje só totais exatos do template e de dois cenários seguram desvio (`ComparePage.test.tsx`, `web/e2e/anonymous-flow.e2e.ts`) |
| "Preço entra por PR revisado" | regra de processo | **Sem garantia técnica.** Ver CI-4 (#368) |

O hash do manifest protege contra deploy parcial e corrupção. Não protege contra quem escreve no bucket, porque manifest e arquivos vêm da mesma origem.

## Perguntas da revisão

| Pergunta | Resposta |
|---|---|
| Identidade só do `sub`? | Sim. Tabela T3. |
| Autorização por dono em toda operação de design? | Sim, em criar, ler e listar (primeira rodada) e em atualizar, renomear, duplicar e apagar (segunda rodada, "T1 a T6 no código novo"). |
| Toda entrada validada? | Sim. Pydantic em todo corpo, com limites; o documento é validado em profundidade. zod no arquivo aberto, no `/config.json`, em toda resposta da API (`web/src/shared/lib/http/httpApi.ts:49-110`) e nos arquivos de preço. Os modelos descartam chave desconhecida em vez de recusar (`extra="ignore"`, `z.object`), por decisão registrada de leitura tolerante; a chave extra não chega ao item nem à LLM. |
| Algum texto livre da LLM é exibido? | Não. Tabela T2. |
| Gasto da LLM | Quota antes da chamada, `max_tokens` fixo, timeout, sem nova tentativa, interruptor desligado por padrão. Tabela T1. |
| Segredos | Chave só no SSM, fora do Terraform, lida em execução. Tokens do usuário só em memória. `localStorage` não é escrito; `sessionStorage` guarda a tentativa de login (state, PKCE, nonce) e o rascunho do design, sem token. |
| Logs | Sem e-mail, cabeçalho, corpo ou descrição de carga. O `sub` (pseudônimo) aparece nos eventos de quota e de estimativa e no log de acesso do API Gateway, por 7 dias. A documentação dizia o contrário e foi corrigida neste PR (DOC-1). O que fazer com o `sub` no log de acesso é decisão pendente (#284). |
| Exclusão de conta | Apaga a partição `USER#<sub>` (designs e contadores) e o usuário no Cognito. Sobram: quota global, PITR por 35 dias (produção), logs por 7 dias e o que já foi à Anthropic. Falha parcial responde 503 e a repetição termina o trabalho. O access token vale até 15 min depois: decisão pendente do autor (#284), não tomada aqui. Ver API-1. |
| Export de Terraform | O rótulo nunca vira código (tabela T4). Recursos gerados com padrão seguro: S3 privado e cifrado, RDS fechado com senha gerenciada, IMDSv2, `0.0.0.0/0` só nas portas 443 e 80 do ALB, IAM sem curinga (`web/src/features/export/model`, testes "nenhuma permissão usa curinga em ação nem em recurso" e "nenhum atributo de senha, segredo ou token recebe literal em lugar nenhum do arquivo"). |
| OIDC do login | PKCE S256 com 64 bytes de `crypto.getRandomValues`; `state` de uso único com validade de 10 min; `nonce`, `iss`, `aud`, `exp` conferidos; descoberta presa ao emissor; `redirect_uri` fixo; destino de retorno por lista de rotas internas. A assinatura do ID token não é verificada no cliente, de propósito e documentado (`web/src/features/auth/model/tokens.ts:47-52`): o token chega por TLS direto do endpoint e o cliente não decide autorização. Risco residual: WEB-1. |
| CloudFront e S3 | Bucket privado com os quatro bloqueios, OAC com SigV4, política presa à distribuição, TLS 1.2 (`TLSv1.2_2021`), `redirect-to-https`, versionamento, `prevent_destroy`. HSTS de 1 ano sem `includeSubDomains` nem `preload` (decisão em `docs/handoff/14.md`). Sem `Permissions-Policy` (informativo, sem Issue: o app não usa nenhuma API de dispositivo). |
| API Gateway | Authorizer JWT em todas as rotas, nenhuma pública; emissor e audiência do pool do ambiente; limite de taxa; endpoint padrão desligado; domínio com TLS 1.2. |
| DynamoDB | Cifrado com chave da AWS, PITR em produção, proteção contra exclusão e `prevent_destroy`. |
| Lambda | Papel mínimo por função, sem segredo em variável de ambiente, sem URL de função, invocação só pelo API Gateway com `source_arn`. Ver INF-2. |
| Cognito | Senha de 15 caracteres ou mais, só o fluxo `code`, sem segredo de cliente, URLs exatas em https, tokens de 15 min, revogação ligada, proteção contra exclusão. Cadastro aberto em produção é risco **aceito pelo autor** no ADR (#139). |
| IAM do bootstrap | Sem caminho de escalada além do limite de permissões: papel novo só com o limite, sem troca de trust nem anexo de política gerenciada, `PassRole` só para os dois papéis das funções. Os limites conhecidos estão em `infra/bootstrap/README.md`. Decisões pendentes: ver "Decisões do autor". |

## As cinco conferências

| Conferência | Resultado |
|---|---|
| **Nenhum segredo no repositório, inclusive histórico** | Limpo. `gitleaks git --redact --log-opts="--all"` em 26/11/2026, sobre todas as refs locais e remotas: 812 commits varridos, 1 achado, falso positivo (FP-1). Estado atual: 0 achados. Nenhum `.env`, `.pem`, `.tfstate` ou chave versionado, hoje ou no histórico. Os `terraform.tfvars` têm só nome de ambiente, booleanos e limites de taxa. |
| **CSP efetiva** | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://api.<domínio> https://auth.<domínio> https://cognito-idp.us-east-1.amazonaws.com; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`. Sem `unsafe-inline` nem `unsafe-eval`. O `connect-src` cobre exatamente o que o app chama (API, token e revogação em `auth.`, descoberta no `cognito-idp`) e nada mais. Agora fixada por teste. Falta a prova com o app rodando (#374). |
| **CORS sem `*`** | API Gateway: uma origem, a do site, por ambiente; sem credenciais; curinga recusado pela validação da variável e por teste. FastAPI: nenhum middleware nem cabeçalho de CORS (teste novo em `api/tests/test_main.py`). |
| **Nenhum papel IAM com `*` em ação e recurso** | Nenhum `Allow` com os dois. Nos módulos, curinga em ação só em negação (`s3:*` sem TLS) e nenhum `Resource = "*"`; fixado por teste. No bootstrap há `Resource = "*"` com ação enumerada onde a AWS não aceita recurso, e a política gerenciada de leitura no papel `plan`. Exceções de scanner abaixo. |
| **Dependências sem vulnerabilidade alta ou crítica** | Nenhuma vulnerabilidade de qualquer severidade em `web/` (360 pacotes), `api/` (62) e `pricing/` (28), em produção e em desenvolvimento. Nenhum pacote abandonado ou arquivado. Único script de instalação: `fsevents` (dev, opcional). |

Exceções de scanner em `infra/` (todas com o motivo na linha de cima; a lista é fixada por `test_security_review.py::ModulesAndEnvs::test_excecoes_de_scanner_sao_so_as_listadas_e_tem_motivo`):

| Arquivo | Regra | Motivo |
|---|---|---|
| `infra/modules/site/cloudfront.tf:34` | AVD-AWS-0011 (WAF) | Custo fixo; risco aceito no ADR |
| `infra/modules/site/s3.tf:35` | AVD-AWS-0132 (chave própria) | Chave do KMS custa US$ 1/mês fixo |
| `infra/modules/alarms/main.tf:27` | AVD-AWS-0095 (SNS cifrado) | Mesmo custo; a chave padrão não serve ao CloudWatch |
| `infra/bootstrap/state.tf:37` | AVD-AWS-0132 | Mesmo custo |
| `infra/bootstrap/prices.tf:35` | AVD-AWS-0057 (curinga) | A Price List não aceita ARN nem condição |
| `infra/bootstrap/boundary.tf:20` | AVD-AWS-0057 | Sufixo de log stream, prefixo do ambiente, ID do pool |
| `infra/bootstrap/named.tf:30` | AVD-AWS-0057 | Prefixo `acp-<ambiente>-*`, objetos do site, listagem de log groups |
| `infra/bootstrap/by_id.tf:59` | AVD-AWS-0057 | Criar e listar não aceitam recurso; escopo por tag |

## Achados confirmados

Cada um passou por `fp-check`. Severidade é a final, depois da verificação.

| Id | Sev. | Achado | Onde | `fp-check` | Issue |
|---|---|---|---|---|---|
| CI-1 | **Alta** | O agente revisor de PR tem ferramentas e permissões mais amplas do que a tarefa exige e trata como confiável parte do conteúdo que lê. Confiança média: a estrutura está demonstrada no repositório; o efeito depende do comportamento da action e do modelo. PR de fork não é afetado | `.github/workflows/review-pr.yml`, `.claude/skills/review-pr/SKILL.md` (linhas no relatório entregue ao autor) | Verdadeiro. Uma sub-alegação refutada (FP-2) | #364 (`needs-human`) |
| CI-2 | Média | Actions por tag móvel em três workflows, uma delas a do agente revisor, que recebe segredo e token de escrita. Imagem do Semgrep sem digest, gitleaks baixado sem checksum, checkouts sem `persist-credentials: false` | `review-pr.yml:44,50`, `pr-size.yml:14`, `security.yml:13,15,21,25` | Verdadeiro (média na action do revisor, baixa no resto) | #365 |
| API-1 | Baixa | A exclusão de conta apaga também o contador diário do usuário; com a janela do token (#284), o teto por usuário deixa de valer para quem exclui a própria conta. O gasto segue limitado pela quota global: reduz de cerca de 15 contas para 1 o esforço que o ADR já aceita (com as quotas da #384, 5 e 30, de 6 contas para 1) | `api/app/account/repository.py:51-55`, `api/app/quotas/repository.py:24`, `api/app/account/service.py:58-61` | Verdadeiro, rebaixado de média | #369 (`needs-human`, depende da #284) |
| CI-3 | Baixa | O job de plano roda o plan-guard a partir do próprio PR, no job que tem a credencial de leitura da AWS e escrita no PR. Latente: a variável do papel não está cadastrada | `.github/workflows/terraform.yml:70-77,94-97,121,129` | Verdadeiro, rebaixado: quem tem push já edita o workflow | #365 |
| CI-4 | Baixa | O catálogo de preços está nos caminhos da revisão seletiva e os testes de hoje conferem schema e hash, não valores | `CLAUDE.md:52`, `review-pr.yml:31`, `.github/pr-size-ignore:37` | Verdadeiro, rebaixado: exige escrita no repositório | #368 (`needs-human`) |
| CI-5 | Baixa | O environment `production` não tem revisor obrigatório e o trust dos papéis `apply` não fixa o arquivo do workflow: a regra "produção só por humano" depende só do conteúdo dos workflows | `infra/bootstrap/apply.tf:37-43` | Verdadeiro, rebaixado: exige merge em `main` | #367 (`needs-human`); teste novo barra `environment: production` em outro workflow |
| CI-6 | Baixa | Os checks obrigatórios vêm de arquivos que o próprio PR altera, e o ruleset não exige code owner; `.claude/**` não conta no tamanho | `validate.yml:3-5`, `scripts/pr-size.py:23-26`, `.github/pr-size-ignore:27-28` | Verdadeiro | #367 |
| INF-1 | Baixa | O teste da CSP só conferia trechos e nenhum teste roda o app sob a CSP real | `infra/modules/site/tests/site.tftest.hcl:63-68` | Verdadeiro, rebaixado: a CSP está correta, faltava a trava | Trava neste PR; app sob a CSP: #374 |
| INF-2 | Baixa | O papel do `llm-proxy` lê e atualiza qualquer item da tabela, embora só use os contadores | `infra/modules/functions/iam.tf:73` | Verdadeiro; só explorável com falha no código do proxy | #372 |
| INF-3 | Baixa | O plan-guard não barra bloco de importação nem plano marcado com erro | `infra/tools/plan_guard.py:64-79` | Verdadeiro (baixa na importação, informativo no erro) | #373 |
| INF-4 | Baixa | Papel `plan`: a leitura alcança o histórico do CloudTrail, não negado nem documentado; o papel não tem `prevent_destroy` | `infra/bootstrap/plan.tf:4-31,41-78` | Parcial: o e-mail de alarme, que constava do candidato, já está no próprio job | #367 |
| WEB-1 | Baixa | Sem allowlist da origem do login gerenciado (risco residual de `docs/handoff/52.md`). Ver avaliação abaixo | `web/src/features/auth/model/endpoints.ts:48-69` | Verdadeiro; baixa é o teto | #370 |
| WEB-2 | Info | O build de produção aceita `http://localhost` na configuração de runtime | `web/src/shared/config/runtimeConfig.ts:14-19` | Verdadeiro; o deploy exige `https://` e a CSP bloqueia | #370 |
| WEB-3 | Info | `oidc-client-ts` instalado e sem uso | `web/package.json:17` | Verdadeiro | #371 |
| DOC-1 | Baixa | A documentação dizia que o log da aplicação não tem `sub`; os eventos de quota e de estimativa têm | `api/README.md` (seção "Exclusão de conta"), ADR linha 162, `docs/runbooks/exclusao-de-conta.md:5,39` | Verdadeiro | Corrigido neste PR |
| DOC-2 | Baixa | O runbook de rotação dizia que os papéis de CI leem o parâmetro da chave; o código nega. Num incidente, uma leitura anômala passaria por normal | `docs/runbooks/rotacao-de-segredos.md:76` | Verdadeiro | Corrigido neste PR |
| OPS-1 | Info (bloqueio de deploy) | Os trusts OIDC esperam o formato antigo do `sub`; o repositório emite o formato imutável, com IDs. Falha fechada: ninguém ganha acesso, mas nenhum papel de CI seria assumido | `infra/bootstrap/oidc.tf:5`, `plan.tf:21`, `apply.tf:41`, `prices.tf:21` | Confirmado pela API e pela documentação do GitHub; não por token real | #366 (`needs-human`) |
| TST-1 | — | T6 sem o teste de cenários de ±15% | — | — | #81 (já existia) |

### WEB-1: avaliação do risco residual do login

- **Caminho:** `/config.json` → `cognitoAuthority` → descoberta OIDC → `authorization_endpoint` → navegação. O código confere que o emissor é o da configuração, que tudo é `https` e que token, revogação e logout ficam na origem do `authorization_endpoint`. Não confere essa origem contra nada.
- **Pré-condição:** escrever o `/config.json` no bucket do site, ou forjar a resposta TLS do endpoint do Cognito. Quem escreve o `config.json` escreve também o `index.html` e o JavaScript do mesmo bucket: o achado não dá capacidade nova a esse atacante.
- **Severidade:** baixa, defesa em profundidade.
- **CSP não resolve:** `connect-src` limita `fetch`, não navegação de página inteira; `form-action` também não cobre; `navigate-to` não é implementada pelos navegadores.
- **Mitigação proposta (#370, cerca de 15 linhas e 25 de teste, sem mudar contrato nem infra):** `parseEndpoints` exige que o host do `authorization_endpoint` seja `auth.` + o host do site, que o app já conhece por `location`. Eleva o custo; não muda a fronteira de confiança.

## Falsos positivos descartados

| Id | Candidato | Por que caiu |
|---|---|---|
| FP-1 | gitleaks `generic-api-key` em `api/app/estimates/claude_client.py:162` (commit `dfe2356`, só em branches antigas) | É a chamada `get_parameter(Name=self._key_parameter, ...)`: nome de atributo, não segredo |
| FP-2 | "O PR reescreve as instruções do próprio revisor" | A action, no commit atual da tag, restaura `.claude/` e afins a partir da base antes de rodar. Depende de a tag continuar móvel ou de fixar um commit recente (CI-2) |
| FP-3 | `AKIA…EXAMPLE`, `ghp_xxxx`, `aws_secret_access_key = "testing"` | Exemplo da documentação da AWS, placeholder de skill, credencial falsa de teste |
| FP-4 | Semgrep: DynamoDB e variáveis de ambiente da Lambda "sem criptografia" | O DynamoDB cifra em repouso por padrão; as variáveis não têm segredo, só o nome do parâmetro |
| FP-5 | Semgrep: log groups sem chave própria | Verdadeiro tecnicamente; chave própria é custo fixo vetado pelo ADR. Risco aceito |
| FP-6 | Semgrep: escalada de privilégio e exposição de recurso em `infra/bootstrap/named.tf` (6 ocorrências) | Recursos de nome fixo, condições e negações (`DenyRoleWithoutBoundary`, limite de permissões) fecham a escalada. Os resíduos reais já estão em "Limites conhecidos" do `infra/bootstrap/README.md` |
| FP-7 | Semgrep em testes do `web/` (7): caracteres bidi, regex dinâmica, `<script>` em string | São as cargas de ataque dos próprios testes |
| FP-8 | Atributos livres de bloco chegariam ao prompt | `api/app/estimates/prompt.py:115-120` só deixa passar chave e valor do conjunto fechado do contrato |
| FP-9 | `httpx2` e `httpcore2` no lock da `api` seriam typosquatting | São dependência declarada do SDK `anthropic` 2.8.0 no PyPI |
| FP-10 | Rotas de designs ausentes no API Gateway | Falha fechada (404), não vulnerabilidade; é a #252 |
| FP-11 | Limite de taxa global, não por usuário | Conhecido e registrado (`docs/handoff/5.md`); o custo segue contido pelas quotas |

## Testes que a primeira rodada acrescentou

| Arquivo | O que trava |
|---|---|
| `infra/tools/tests/test_security_review.py` | CSP inteira, diretiva a diretiva; uma política para os dois comportamentos; `connect-src`, CORS, authorizer e limite de taxa ligados nos dois ambientes; nada de URL de função, parâmetro do SSM no Terraform, rota sem JWT ou curinga; curinga em ação só em negação; `prevent_destroy` na tabela, no pool, no bucket e nos papéis; exceções de scanner só as listadas, com motivo |
| `infra/tools/tests/test_workflows_all.py` | Em todos os workflows: sem gatilho proibido, sem expressão em `run:`, OIDC, environment e escopos de escrita só onde já estão, produção só por disparo manual, actions por SHA. As violações de CI-2 ficam numa lista de pendências que só diminui |
| `web/src/security.test.ts` | Nenhum sorvedouro de HTML ou de código, nenhum `console`, nenhum `localStorage`, IndexedDB ou cookie; `sessionStorage` só nos dois arquivos conhecidos |
| `api/tests/test_main.py` | A aplicação nunca emite cabeçalho de CORS e não tem o middleware |

Limite conhecido: `infra/tools/tests` só roda no CI quando o PR toca `infra/**` ou um dos workflows listados em `paths` de `.github/workflows/terraform.yml`. Um PR que só mexa em outro workflow não dispara `test_workflows_all.py`. A #365 pede que o job rode para qualquer arquivo de `.github/workflows/`. Pela mesma razão, as conferências de segredos no histórico inteiro e de dependências são evidência pontual desta revisão: o CI não roda `npm audit` nem `pip-audit` (a #365 recebeu esse pedido em comentário).

## Segunda rodada: o delta (#375)

Commit auditado: `6801232` (`main` no início da rodada). Escopo: `git diff 4f2a233..6801232` nos diretórios `api/`, `web/src/`, `infra/` e `.github/workflows/`. Por PR:

| PR | Assunto |
|---|---|
| #376 (#54) | API de designs |
| #377 (#57) | Tela de designs |
| #378 (#252) | Rotas de designs no API Gateway |
| #362 (#351) | Designs salvos na comparação |
| #359 | `export-validate.yml` e `infra/tools/export_validate_report.py` |
| #379 | Testes da primeira rodada |

Mesmo método da primeira rodada:

| Etapa | Como |
|---|---|
| Revisão manual | Skills `security-review`, `owasp-security` e `differential-review` |
| Revisor independente | Leu o delta sem as conclusões da revisão manual |
| Padrões inseguros | Skill `insecure-defaults`: dois workflows, um em `api/app/designs` e outro em `.github/workflows/export-validate.yml`, cada um com 6 varreduras de categoria. Resultado nos dois: `no-candidates` |
| Análise estática | Semgrep 1.182.0 nos 43 arquivos de código do delta, com os mesmos conjuntos de regras. Um achado, FP-12 |
| Falsos positivos | Cada candidato passou por um verificador `fp-check` encarregado de refutar |

### T1 a T6 no código novo

**T1. Abuso de custo.**

**Veredito: a LLM segue mitigada (nenhuma rota nova chega a ela). O DynamoDB das rotas de designs não tem teto de custo além da taxa do stage: DSN-1, que amplia a #277.**

| Mitigação | Onde | Teste |
|---|---|---|
| Designs e conta nunca vão para o `llm-proxy`, a única função que lê a chave e grava a quota | `infra/modules/http-api/main.tf:5-7`, `infra/envs/*/main.tf:86-97` | `infra/tools/tests/test_security_review.py::ApiEdge::test_rotas_do_gateway_sao_as_revistas_e_cada_uma_vai_para_a_funcao_esperada` (novo); `http_api.tftest.hcl` (`estimates_e_quota_vao_para_o_llm_proxy`) |
| Limite de 10 designs (#386; eram 50) também em `duplicate`, por usuário | `api/app/designs/service.py:75-108,127-130` | `api/tests/test_designs_changes.py::test_duplicar_respeita_o_limite_de_designs`, `::test_duplicar_abaixo_do_limite_chega_ao_limite_e_para`, `::test_limite_de_um_usuario_nao_conta_designs_de_outro` |
| `doc` até 100.000 bytes (#386) e corpo até 1 MiB também no `PATCH` | `api/app/designs/schemas.py:36,48`, `api/app/routing.py:28-30` | `test_designs_changes.py::test_atualizar_doc_no_teto_grava_e_acima_e_413` |
| Atualizar é uma só escrita condicional, sem leitura antes | `api/app/designs/repository.py:134-167` | `test_designs_changes.py::test_atualizar_e_uma_escrita_condicional_sem_ler_antes` |
| Limite de taxa nas rotas novas | Só o padrão do stage (10 rps, burst 20), sem limite próprio | **Sem mitigação própria.** Ver DSN-1 |

**T2. Prompt injection.**

**Veredito: não se aplica ao delta.** Nenhuma rota nova chama a LLM, e o prompt, o schema de saída e a revalidação não mudaram. O teste novo de rotas fixa que designs não chegam ao `llm-proxy`.

**T3. Acesso ao design de outro usuário.**

**Veredito: mitigada.**

| Mitigação | Onde | Teste |
|---|---|---|
| Toda chave das rotas novas sai do `sub` e do id do caminho, revalidados em `_pk` e `_key` | `api/app/designs/repository.py:52-62` | `test_designs_changes.py::test_rotas_novas_usam_so_a_particao_do_sub` |
| `designId` como ULID no caminho das rotas novas | `api/app/designs/router.py:38` | `api/tests/test_routes.py::test_design_id_fora_do_formato_ulid_responde_422` |
| Atualizar design alheio responde 404, igual a inexistente, com qualquer versão: sem oráculo de existência pelo 409 | `repository.py:146,154,164` (a chave é da partição de quem pede) | `test_designs_changes.py::test_atualizar_design_de_outro_usuario_e_404_sem_gravar_nem_criar` (versões erradas acrescentadas neste PR) |
| `attribute_exists(PK)`: o `UpdateItem` nunca cria item | `repository.py:154` | mesmo teste (nada nasce na partição de B) |
| Nomes de atributo vêm do serviço como `#aN`; chave e `version` não se alteram pelo corpo | `repository.py:144-149`, `api/app/designs/schemas.py:44-54` | `test_designs_changes.py::test_repositorio_recusa_atualizar_chave_ou_versao`, `::test_atualizar_sem_expected_version_e_422_sem_gravar` |
| Duplicar design alheio responde 404 antes do limite | `service.py:127-130` | `test_designs_changes.py::test_duplicar_design_de_outro_usuario_e_404_sem_criar` |
| Apagar é idempotente (sempre 204) e não alcança outra partição | `service.py:133-135`, `repository.py:170-174` | `test_designs_changes.py::test_apagar_e_idempotente`, `::test_apagar_design_de_outro_usuario_nao_o_remove` |
| Erros com status e detalhe fixos; o item de `ALL_OLD` no 409 não chega à resposta | `router.py:22-34`, `api/app/designs/errors.py` | `test_designs_changes.py::test_versao_desatualizada_e_409_sem_gravar` (corpo igual a `CONFLICT`) |
| Papel da `api`: entra só `UpdateItem`, e as partições continuam limitadas a `USER#*` | `infra/modules/functions/iam.tf:49-54` | `functions.tftest.hcl` (`papeis_de_menor_privilegio`) |
| As seis rotas de designs com authorizer JWT, para a função `api`; nenhuma rota fora da lista revista | `infra/envs/*/main.tf:86-97`, `infra/modules/http-api/main.tf:62-70` | `test_security_review.py::ApiEdge::test_rotas_do_gateway_sao_as_revistas_e_cada_uma_vai_para_a_funcao_esperada` e `::test_extrator_de_rotas_ve_rota_nova_e_destino_trocado` (novos); `infra/envs/*/tests/composition.tftest.hcl` (`rotas_de_designs_atras_do_jwt_e_patch_no_cors`) |
| No site, só ULID vira segmento de caminho; o id nunca é concatenado | `web/src/shared/lib/http/httpApi.ts:37-42,87` | `web/src/shared/lib/http/httpApi.test.ts` "o id vai como segmento do transporte, nunca concatenado, com o 409 de cada rota" |
| Comparação: "salvo" só com sessão; ao sair da conta, deixa de valer | `web/src/features/compare/hooks/useSideDocument.ts:19-34` | `web/src/features/compare/ui/ComparePage.test.tsx` "o anônimo não vê a opção de salvos e não chama a API", "ao sair da conta, a origem \"salvo\" deixa de valer: nada de salvo na tela" |

**T4. XSS.**

**Veredito: mitigada.**

| Mitigação | Onde | Teste |
|---|---|---|
| Documento salvo, vindo do servidor, passa por zod antes do cálculo da comparação | `web/src/features/designs/hooks/useSavedDesigns.ts:26-49` | `ComparePage.test.tsx` "documento inválido vindo do servidor é recusado antes de calcular" |
| Nome do design só como texto na lista, no seletor da comparação e na tabela | `web/src/features/designs/ui/DesignsPage.tsx`, `web/src/features/compare/ui/SourcePicker.tsx`, `CompareTable.tsx` | `web/src/features/designs/ui/DesignsPage.test.tsx` "lista nome, região, blocos e data na ordem da API, só como texto"; `ComparePage.test.tsx` "escolhe dois designs salvos, com a região de cada um e o nome só como texto"; `CompareTable.test.tsx` "tipo desconhecido e rótulo com HTML saem só como texto" |
| Arquivo aberto na comparação passa pela mesma validação de "Abrir arquivo" | `SourcePicker.tsx` (`readDesignFile`) | `ComparePage.test.tsx` "arquivo inválido: mesma validação de abrir design, texto próprio e nada comparado", "rótulos do arquivo entram só como texto, nunca como HTML" |
| Nenhum sorvedouro de HTML ou de código em `web/src` | — | `web/src/security.test.ts` (verde no estado final, sem mudança de lista) |

**T5. Vazamento de chave ou de credencial de CI.**

**Veredito: mitigada no delta.** O workflow novo não tem credencial nem segredo, e o script só lê JSON.

| Mitigação | Onde | Teste |
|---|---|---|
| Gatilho só `pull_request` para `main`, com `paths` | `.github/workflows/export-validate.yml:8-15` | `infra/tools/tests/test_workflow_export_validate.py::test_trigger_is_only_pull_request_to_main_with_the_paths`; `infra/tools/tests/test_workflows_all.py::EveryWorkflow::test_nenhum_gatilho_proibido` |
| `permissions: contents: read`, declarado uma vez | `export-validate.yml:17-18` | `infra/tools/tests/test_workflow_export_validate.py::test_permissions_are_read_only_and_set_once`; `test_workflows_all.py::EveryWorkflow::test_permissoes_declaradas_e_escrita_so_onde_ja_existe` |
| Actions por SHA; checkout sem credencial persistida | `export-validate.yml:34-36,37,42` | `infra/tools/tests/test_workflow_export_validate.py::test_every_uses_is_pinned_by_sha_with_version_comment`, `::test_checkout_keeps_no_credentials`; `test_workflows_all.py::EveryWorkflow::test_actions_por_sha_fora_as_pendencias_conhecidas` |
| Nenhuma expressão em `run:` | `export-validate.yml:47-74` | `infra/tools/tests/test_workflow_export_validate.py::test_run_blocks_never_interpolate_expressions`; `test_workflows_all.py::EveryWorkflow::test_nenhuma_expressao_dentro_de_run` |
| Sem segredo, token, OIDC ou credencial da AWS; falha fechada se houver `AWS_*`, imprimindo só os nomes | `export-validate.yml:46-53` | `infra/tools/tests/test_workflow_export_validate.py::test_no_secret_token_or_aws_credential`, `::test_any_aws_variable_fails_and_only_its_name_is_printed`; `test_workflows_all.py::EveryWorkflow::test_oidc_e_environment_so_nos_jobs_conhecidos` |
| `npm ci --ignore-scripts`: sem script de instalação no job | `export-validate.yml:56` | — (leitura; o job não tem segredo a proteger) |
| Só `init -backend=false` e `validate`, nunca `plan` | `export-validate.yml:60-70`, `web/src/features/export/test/terraform.local.test.ts` | `infra/tools/tests/test_workflow_export_validate.py::test_terraform_version_matches_infra_and_never_plans`, `::test_local_test_runs_init_without_backend_and_validate` |
| O relatório falha fechado: ilegível sai com 2; teste pulado, reprovado ou cenário ausente sai com 1 | `infra/tools/export_validate_report.py:29-50,53-68` | `infra/tools/tests/test_workflow_export_validate.py::test_unreadable_report_fails_closed`, `::test_skipped_tests_fail_instead_of_passing_empty`, `::test_a_repeated_title_cannot_hide_a_failure`, `::test_a_scenario_file_without_a_test_fails` |
| O workflow novo está na lista conhecida, e mexer nele dispara estes testes no CI | `.github/workflows/terraform.yml:14` | `test_workflows_all.py::EveryWorkflow::test_a_lista_de_workflows_e_a_conhecida`; `infra/tools/tests/test_workflow_export_validate.py::test_a_change_to_the_workflow_runs_these_tests_in_ci` |
| Log das rotas novas pela allowlist, sem dado do usuário | `api/app/logs.py` (sem mudança) | `api/tests/test_routes.py::test_log_da_rota_nao_traz_dado_do_usuario` |

**T6. Adulteração dos preços.**

**Veredito: sem mudança.** O delta não toca `pricing/`, o catálogo nem `loadCatalog.ts`. TST-1 (#81) e CI-4 (#368) continuam como na primeira rodada.

### As cinco conferências, no estado final

| Conferência | Resultado |
|---|---|
| **Segredos no histórico inteiro** | Limpo. `gitleaks git --redact --log-opts="--all"` (8.30.1): 833 commits, 1 achado, o mesmo FP-1. `gitleaks dir` no estado atual: 0 achados |
| **CSP efetiva** | Sem mudança desde a primeira rodada: o delta não toca `infra/modules/site` nem o `connect-src` dos ambientes. `test_security_review.py::ContentSecurityPolicy` está verde. A prova com o app rodando segue na #374 |
| **CORS sem `*`** | Uma origem, a do site, por ambiente, sem credenciais. Os métodos derivam das rotas: `GET`, `POST`, `PATCH`, `DELETE`. `ANY` e `OPTIONS` são recusados (`http_api.tftest.hcl`: `rota_any_e_rejeitada`, `rota_options_e_rejeitada`). A FastAPI continua sem CORS (`api/tests/test_main.py`) |
| **IAM sem `*` em ação e recurso** | O delta só acrescenta `dynamodb:UpdateItem`, na tabela, com `LeadingKeys` `USER#*`. Os invariantes `test_curinga_em_acao_so_aparece_em_negacao` e `test_nenhum_recurso_curinga_inteiro_nos_modulos` estão verdes |
| **Dependências sem alta ou crítica** | Nenhuma vulnerabilidade de qualquer severidade. `npm audit`, com e sem dev, em 360 pacotes de `web/`. `pip-audit` 2.10.1 nos dois `uv.lock` (62 pacotes em `api/`, 28 em `pricing/`). O delta não muda manifest nem lockfile |

### Achados da segunda rodada

| Id | Sev. | Achado | Onde | `fp-check` | Issue |
|---|---|---|---|---|---|
| DSN-1 | Média | **Custo de escrita nas rotas de designs, que vão a `main` sem a decisão da #277.** O DynamoDB cobra o `UpdateItem` pelo maior tamanho do item, inclusive na escrita condicional recusada. Assim, cada `PATCH` num design de cerca de 350 KB custa cerca de 342 WRU, seja para trocar o `doc`, só renomear ou receber o 409. Não há limite de quantidade, e a única barreira é a taxa do stage. Pior caso de um usuário com conta (cadastro aberto em produção): cerca de US$ 2,25/h num item quente (teto de 1.000 WRU/s da partição) e até cerca de US$ 7,70/h nos 50 itens. A leitura da #277 soma cerca de US$ 1,35/h. O teto de US$ 20/mês estoura em poucas horas. Abaixo do limite da partição, não há 503 nem alarme, e o Budget não corta a função `api` | `api/app/designs/service.py:114-124`, `repository.py:134-167`, `infra/envs/*/main.tf:86-97`, `infra/envs/*/terraform.tfvars` (`default_throttle`) | Verdadeiro na escrita. A amplificação de leitura por `duplicate` e a taxa sem dono são a #277 e FP-11 | #277 (`needs-human`, comentário com os números) |
| INP-1 | Info | `expectedVersion` sem teto: a partir de 10^38 - 1, o boto3 levanta `decimal.Rounded` e a resposta é 500 genérico. Não há eco nem escrita. Único efeito: ruído no alarme de 5xx | `api/app/designs/schemas.py:45` | Verdadeiro, reproduzido | #381 |
| FP-12 | — | Semgrep `non-literal-import` em `api/tests/test_main.py:26` | — | Falso positivo: o `import_module` recebe nomes de uma lista literal do `parametrize` | — |

Premissas do DSN-1:
- Preço on-demand de us-east-1 do fixture de `pricing/`: US$ 0,625 por milhão de WRU e US$ 0,125 por milhão de RRU.
- Limites de throughput por partição do DynamoDB.
- A divisão da partição por SK (split for heat) e o limite por rota do `default_route_settings` só se confirmam no staging (ver "O que só o primeiro staging confirma", "API Gateway").

**A #277 não bloqueia mais nada sozinha.** A primeira rodada a registrou como bloqueio da #252, mas a #252 entrou em `main` (`86442c2`). O próximo `apply` de produção publica as rotas sem a decisão. Das opções da #277, só o limite de taxa por rota cobre leitura, escrita e saída de dados; separar o `doc` não resolve o `PATCH` com `doc`. Nada disso foi corrigido aqui: limite de taxa e configuração de custo são decisão e trabalho do autor.

### Testes que a segunda rodada acrescenta

| Arquivo | O que trava |
|---|---|
| `infra/tools/tests/test_security_review.py` | As rotas do gateway nos dois ambientes são exatamente as revistas, sem repetição, e cada uma vai para a função esperada, calculada pela mesma expressão do módulo. Um teste de controle prova que o extrator vê rota nova e destino trocado |
| `api/tests/test_designs_changes.py` | `PATCH` em design alheio com versão errada também responde 404, nunca 409 |

## Fora desta rodada

Tudo o que ficou de fora da primeira rodada foi auditado na segunda, salvo o item abaixo, que segue com Issue própria.

| Item | Issue | Estado |
|---|---|---|
| Custo do DynamoDB nas rotas de designs (leitura e, desde a segunda rodada, escrita: DSN-1) | #277 | `needs-human`: decisão do autor antes do `apply` de produção |

## O que só o primeiro staging confirma

Riscos que só aparecem com a conta real. Junta `docs/runbooks/setup-aws.md` (tabela nas linhas 476-512 e checklist nas 524-535), os handoffs 52, 62, 167 e 169, e o que esta revisão acrescentou. Em todos os casos conhecidos a falha é fechada (o deploy para ou a rota responde 503), salvo indicação.

**IAM e OIDC**

- **Formato do `sub` do token OIDC (novo, #366).** Se for o imutável, nenhum papel de CI é assumido.
- Trust e negações dos papéis `apply` e `plan`: os testes usam provider simulado (`infra/bootstrap/README.md:175`, `docs/runbooks/setup-aws.md:251`).
- Listas de ações de `acp-ci-apply-named-<env>` e `acp-ci-apply-id-<env>` não testadas contra a AWS; primeiro suspeito, `cloudwatch:DescribeAlarms` (`docs/handoff/167.md:56,72`, `docs/handoff/169.md:83`).
- Tags no API Gateway v2, no CloudFront e no Cognito: herança pelos recursos filhos, `PUT` em `/tags/*`, `aws:ResourceTag` na invalidação, tags preservadas no `UpdateUserPool` (`docs/handoff/169.md:70`).
- Sem a decisão da #338, o deploy para no stage da API e no domínio do Cognito (`docs/handoff/169.md:12`).
- `lambda:SourceFunctionArn` dentro do limite de permissões: se não valer, `AccessDenied` no dado (`docs/runbooks/setup-aws.md:482`).
- **Leitura do SecureString pelo proxy (novo).** O limite de permissões não cita `kms:Decrypt`; a confirmar que a chave gerenciada `aws/ssm` basta. Se não bastar, a estimativa responde 503.
- Leitura do zip das funções com a permissão de quem chama: depende do bucket de artefatos (#209; `docs/handoff/167.md:58`).

**Cognito e login**

- Se o login gerenciado oferece usuário e senha só com `ALLOW_REFRESH_TOKEN_AUTH`; plano B registrado (`docs/handoff/52.md:104`, `docs/runbooks/setup-aws.md:484`).
- Se a descoberta OIDC devolve os endpoints do domínio próprio `auth.<domínio>`: se devolver outro host, a `connect-src` bloqueia o token. Se o endpoint de token e a descoberta aceitam o `fetch` do navegador (CORS). Caminhos `/signup` e `/forgotPassword` (`docs/handoff/52.md:104`).
- Revogação e logout derivados da origem validada (`docs/handoff/52.md:55`).
- Claim `username` no access token e `AdminDeleteUser` de verdade (`docs/handoff/55.md:18,43`).
- **Se o authorizer aceita o token de um usuário já excluído (novo).** É a premissa da #284 e de API-1; afirmada pelo ADR, nunca testada.

**CloudFront e CSP**

- A CSP com o app rodando: estilos do React Flow, chamadas de autenticação, download por `blob:` (`docs/handoff/14.md:49`; #374 antecipa parte disso).
- **Cabeçalhos nas respostas de erro 403 e 404 que viram `index.html` e em `/config.json` (novo).** O smoke test não confere CSP nem HSTS.

**API Gateway**

- CORS: preflight devolve a origem do site e nenhuma outra (`docs/runbooks/setup-aws.md:486,498-504`).
- 401 do authorizer sem cabeçalho de CORS chega ao navegador como falha de rede (`docs/runbooks/setup-aws.md:487`).
- A identidade é o claim `sub` em UUID; duas contas de teste têm quotas separadas (`docs/runbooks/setup-aws.md:485`).
- **Se o limite de taxa por rota é dividido entre todos os chamadores (novo)**, como se supõe em FP-11.

**Lambda, DynamoDB e LLM**

- Runtime e pacote: o smoke não invoca função nenhuma, então o deploy fica verde com um zip que não importa (`docs/runbooks/setup-aws.md:375,488`).
- `contracts/` dentro do zip (`docs/handoff/62.md:103`).
- A transação de quota com o papel que só tem `GetItem` e `UpdateItem` (`docs/runbooks/setup-aws.md:483`).
- Nenhum teste com o DynamoDB real nem com a Claude API real; `max_tokens` e timeouts são estimativas a medir com chave real (`docs/handoff/62.md:102-103,117`).
- Parâmetro do SSM criado à mão como `SecureString` (`docs/runbooks/setup-aws.md:287-301`).

**CI**

- `deploy-staging.yml` nunca rodou de verdade (`docs/handoff/22.md:57`).
- O PR do workflow de preços não dispara o CI até ser reaberto pelo autor (`docs/runbooks/setup-aws.md:423,442-447`).
- Configuração manual que o repositório não mostra: Budgets, concorrência reservada, limite de gasto do workspace da Anthropic, regras dos environments.

## Decisões do autor

Nenhuma foi tomada nesta revisão. O risco de cada opção:

| Issue | Decisão | Opções e risco |
|---|---|---|
| #284 | Janela do token depois da exclusão; `sub` no log de acesso | (a) Aceitar com a mitigação do cliente: a janela continua aberta para quem guardou o token, e API-1 continua valendo. (b) Marcador de conta excluída nas rotas de escrita: fecha a janela e API-1; custa uma leitura por requisição. (c) Reduzir a validade do token: encurta, não fecha. Log: manter o `sub` por 7 dias como pseudônimo, ou tirar o campo e perder a correlação por usuário |
| #338 | Escritas do `apply` que não se delimitam por ambiente | Aceitar: o papel de staging alcança política de logs, distribuição, cabeçalhos (CSP) e tags da API de produção. Recusar: esses itens viram tarefa manual e o primeiro deploy para no stage da API e no domínio do Cognito |
| #327 | Fixar o arquivo do workflow no trust do `prices` | Fixar: fecha o uso por outro workflow em `main`; valor errado tranca o workflow até reaplicar o bootstrap. Manter: qualquer job em `main` sem environment assume o papel, cujo alcance é só leitura de preço público. A mesma pergunta vale para os `apply` (#367), com alcance de escrita |
| #277 | Custo de leitura e escrita da partição de designs (DSN-1) | **Decidido pelo autor em 26/11/2026: limites menores (#386: 10 designs de 100.000 bytes; o `PATCH` no teto cai de cerca de 342 para cerca de 98 WRU) e limite de taxa por rota (manual) agora; separar o `doc` depois do prazo, antes de reabrir o cadastro (ADR-0001, "Custo da listagem de designs").** Registro original: As rotas já estão em `main` (#252). Decidir antes do `apply` de produção. Só o limite de taxa por rota cobre leitura, escrita e saída; separar o `doc` não resolve o `PATCH` com `doc` |
| #364 | Agente revisor (CI-1) | Enquanto aberto: a label de aprovação e outras labels de autorização dependem de o revisor não ser induzido. Mitigação imediata, do autor: a automação de merge conferir quem aplicou a label |
| #366 | Formato do `sub` | Sem corrigir antes do bootstrap, o primeiro deploy falha (fechado) |
| #367, #368, #369 | Environment de produção, code owner, papel `plan`; preços na revisão seletiva; quota na exclusão | Nas Issues |

Risco aceito, apenas citado: cadastro aberto em produção com o remetente padrão do Cognito (ADR, #139); sem WAF; staging e produção na mesma conta.

## O que não rodou

- **`tflint` e `trivy`:** não estão instalados na máquina. O job `terraform` do CI roda os dois (`trivy config` só com severidade alta e crítica).
- **Skills `static-analysis:semgrep-scan` e `insecure-defaults`:** as duas dependem da ferramenta Workflow, que não existe nesta sessão. O Semgrep rodou direto, com os mesmos conjuntos de regras. A varredura de padrões inseguros foi feita por leitura dirigida das categorias da skill em `api/app/config.py`, `infra/**`, `.github/workflows/**`, `web/public/config.json` e `web/src/shared/config`.
- **Nada contra a AWS, a Anthropic ou um ambiente publicado:** sem credencial, sem plano. Ver "O que só o primeiro staging confirma".
- **A automação de merge e de despacho** não está no repositório: o que ela confere (ator da label, caminhos da revisão seletiva, data da regra de sprint) não foi verificado.
- **`terraform validate` do export gerado:** teste opcional, desligado por padrão.
- Regras Pro do Semgrep, CodeQL e `osv-scanner` não foram usados.

Na segunda rodada (#375):
- `tflint` e `trivy` continuam fora da máquina.
- `terraform test` não rodou de novo, porque o PR não altera `.tf`.
- O `insecure-defaults` rodou como workflow nos dois escopos do delta, e o Semgrep nos 43 arquivos.
- Os números de DSN-1 vêm de preço e limite documentados, não de medição numa conta.
