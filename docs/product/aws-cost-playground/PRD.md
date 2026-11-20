# PRD — AWS Cost Playground

- **Status:** aprovado pelo autor no Gate 2 em 2026-11-18
- **Data:** 2026-11-18
- **Entradas:** [discovery](../../discovery/aws-cost-playground.md) e [ADR-0001](../../architecture/aws-cost-playground/ADR-0001-stack.md)

## Objetivo

Dar a quem está começando um projeto na AWS uma primeira estimativa de custo mensal, montando a arquitetura num canvas com serviços reais e descrevendo a carga em linguagem natural. É uma ferramenta de orçamento: o número vem de SKUs reais da Price List API e separa custo fixo de custo variável.

O autor é o único usuário no lançamento. O produto sai completo e com cadastro aberto, pronto para receber outros usuários sem retrabalho.

## Métricas de sucesso

| Métrica | Alvo |
|---|---|
| Template dos 20 blocos | Abre e mostra um total calculado, sem login e sem LLM |
| Precisão | Nos 3 cenários de referência (API serverless, app clássico, pipeline de filas), estimativa dentro de ±15% da AWS Pricing Calculator |
| Export | O Terraform gerado para cada cenário de referência passa em `terraform validate` |
| Comparação | 2 designs com a mesma carga lado a lado, com a diferença por bloco |
| Custo de hospedagem | Até US$ 20/mês em qualquer cenário; perto de US$ 0,50 com um usuário |
| Custo da LLM | Até cerca de US$ 13/mês com a quota global cheia |
| Isolamento | Nenhum teste de acesso cruzado entre usuários passa |

Gatilho de revisão de arquitetura e de cobrança: 100 estimativas por mês feitas por não-autores, ou quota global atingida em 5 dias do mesmo mês.

## Escopo do MVP

Lista fechada. O que não está aqui está fora.

### Editor

- F1. Canvas com blocos e arestas: arrastar da paleta, conectar, mover, apagar, desfazer e refazer.
- F2. Paleta com os 20 blocos: Route 53, CloudFront, WAF, ALB, EC2, ECS, Lambda, ElastiCache, RDS, DynamoDB, S3, SQS, Cognito, IAM, Secrets Manager, CloudWatch, CloudTrail, CodePipeline, CloudFormation e NAT Gateway.
- F3. Inspetor de bloco: atributos do SKU (tipo de instância, memória, classe de armazenamento, AZ) e valores de uso.
- F4. Arestas tipadas: `data` (tráfego cobrado), `runs-on` (ECS sobre EC2) e `logs` (bloco para CloudWatch). Nó fixo `client` para a internet.
- F5. Template inicial com os 20 blocos, uma descrição de carga de exemplo e uso padrão, de modo que um design novo já abre calculado.
- F6. Uma região por design: us-east-1 ou sa-east-1.
- F7. Baixar o design como arquivo JSON e abrir um arquivo JSON, com validação e mensagem clara quando o arquivo é inválido ou de versão antiga.

### Estimativa de custo

- F8. Catálogo de preços estático por região e serviço, gerado da Price List API por um workflow semanal que abre um PR.
- F9. Motor de preço determinístico no navegador: recalcula a cada mudança de bloco, atributo, aresta ou uso.
- F10. Blocos de nível A: EC2, Lambda, RDS, DynamoDB, ElastiCache, S3, SQS, CloudFront, ALB, CloudWatch, NAT Gateway.
- F11. Blocos de nível B: WAF, Cognito, Secrets Manager, CloudTrail, Route 53, CodePipeline.
- F12. Blocos de nível C, de custo zero: IAM, CloudFormation e ECS (o custo vem do EC2 em que roda).
- F13. Custos de aresta: egress para a internet, tráfego entre AZs, processamento do NAT Gateway e ingestão de logs no CloudWatch.
- F14. Free tier e mínimos de cobrança aplicados como regras do catálogo.
- F15. Painel de custo: total mensal, custo por bloco e por aresta, e separação entre fixo e variável.
- F16. Aviso permanente de que o valor é uma estimativa, não uma cotação oficial, com a data do catálogo de preços. O mesmo aviso vai em todo export.

### Carga por linguagem natural (só logado)

- F17. Campo de descrição de carga e botão "Re-estimar carga", que preenche o uso de cada bloco e de cada aresta.
- F18. Marcação de origem de cada valor: estimado pela LLM, padrão ou alterado à mão.
- F19. Override manual de qualquer valor de uso, que vence a LLM e sobrevive a novas estimativas.
- F20. Indicador de estimativa desatualizada quando o diagrama muda depois da última estimativa.
- F21. Quota de 20 estimativas por dia por usuário e 300 por dia no total, com mensagem clara quando esgota e contador do que resta.

### Conta e designs (só logado)

- F22. Cadastro aberto com verificação de e-mail, login, logout e recuperação de senha, pelo login gerenciado do Cognito.
- F23. Salvar, listar, abrir, renomear, duplicar e apagar designs. Cada usuário vê só os seus.
- F24. Aviso de conflito quando o mesmo design foi salvo em outra aba.
- F25. Excluir a conta, apagando designs, contadores e o usuário.
- F26. Páginas de política de privacidade e de termos de uso.

### Export e comparação

- F27. Export do design para Terraform, gerado no navegador, sem LLM.
- F28. Comparação lado a lado de 2 designs: total, fixo e variável, e diferença por tipo de bloco.

### Entrega e operação

- F29. Ambientes de staging e de produção com o mesmo artefato; produção só por disparo manual.
- F30. Infraestrutura como código Terraform no repositório, escrita pelos agentes e revisada por PR.
- F31. Runbooks: rollback, rotação de segredos e guardrails de custo (lista do que o autor configura à mão na AWS e no Console da Anthropic).
- F32. Logs estruturados sem dado pessoal e alarmes de erro e de throttle do proxy.

### Requisitos transversais

- Segurança conforme o threat model do ADR: identidade só pelo JWT, entrada validada, saída da LLM revalidada, CSP, segredo só no SSM, CI por OIDC.
- Interface em português do Brasil, com nomes de serviço e de SKU em inglês. Valores em dólar.
- Uso em desktop. As páginas de texto (privacidade, termos) funcionam em celular; o editor avisa que precisa de tela maior.
- Acessibilidade WCAG 2.2 AA fora do canvas; no canvas, seleção e edição de blocos pelo teclado.
- Toda tela segue o protocolo de design da casa (`rules/10-ui-design.md`).

## Prazo e entrega

O produto completo (F1 a F32) é apresentado em **8 de dezembro de 2026**. Não há releases parciais: todas as Issues são liberadas de uma vez e rodam em paralelo depois do esqueleto.

| Data | Marco |
|---|---|
| 20/11 | Repositório, Issues e sprint-planning concluídos; tarefas do autor iniciadas (domínio, conta AWS, créditos da Claude API) |
| 25/11 | Conta AWS e `infra/bootstrap/` prontos, para o staging existir |
| 30/11 | Todas as funcionalidades em staging |
| 01 a 04/12 | Calibração dos 3 cenários contra a AWS Pricing Calculator, correções, revisão de segurança |
| 05/12 | Produção publicada e congelada |
| 06 e 07/12 | Folga |
| 08/12 | Apresentação |

Ordem de prioridade se algo atrasar, do que se protege primeiro ao que se corta por último: editor e motor de preço com os blocos de nível A; estimativa por LLM; conta e designs; blocos de nível B e C; export Terraform; comparação.

Plano de contingência da apresentação: o modo anônimo roda inteiro no navegador, então editor, cálculo, export e comparação podem ser demonstrados em desenvolvimento local mesmo que domínio ou produção atrasem.

## Fora de escopo

- Colaboração e compartilhamento de designs entre usuários.
- Multi-cloud, simulação de latência ou de erros.
- Cobrança por uso e planos pagos.
- Mais de uma região no mesmo design; tráfego entre regiões.
- Export para CDK. O discovery cita "Terraform/CDK", mas o critério de MVP pronto só exige Terraform.
- Blocos de expansão: EKS, Fargate, Glacier, EBS, KMS, SNS, EventBridge, Step Functions, Config, API Gateway e VPC como bloco.
- Fórmulas de uso por serviço: o uso vem da LLM, do padrão ou do usuário.
- Outras regiões além de us-east-1 e sa-east-1.
- Conversão para real, outros idiomas e aplicativo mobile.
- Savings Plans, instâncias reservadas, Spot e descontos de contrato: o cálculo é on-demand.
- Login social.
- Configuração de custo na conta AWS (Budgets, limites, concorrência): feita à mão pelo autor, com apoio do runbook.

## Épicos

| # | Épico | Funcionalidades |
|---|---|---|
| 1 | Fundação: esqueleto, CI, sistema visual e contratos (schema do design, formato do catálogo de preços) | base de tudo |
| 2 | Editor visual | F1 a F7 |
| 3 | Catálogo e motor de preço | F8 a F16 |
| 4 | Conta, designs e conformidade | F22 a F26 |
| 5 | Estimativa de carga por LLM | F17 a F21 |
| 6 | Export Terraform e comparação | F27, F28 |
| 7 | Infraestrutura, deploy e operação | F29 a F32 |

## Riscos

| Risco | Tratamento |
|---|---|
| Precisão de ±15% difícil em serviços com muitos SKUs (EC2, RDS) | Atributos limitados a um conjunto fechado por bloco; os 3 cenários são testes automatizados |
| Haiku 5.5 estimar uso pior que o esperado | Faixas plausíveis por campo, override manual e marcação de origem; trocar de modelo é configuração e passa pelo autor |
| Chamada à LLM passar de 30 s | Medição na primeira Issue do proxy; fila com polling só por ADR novo |
| Tarefas que dependem do autor atrasarem o deploy (domínio, conta, créditos) | Issues `needs-human` separadas; todo o resto roda em desenvolvimento local e no CI sem elas |
| Prazo de 08/12 | Caminho crítico são as tarefas do autor e os merges, não o código; marcos acima e ordem de prioridade definida |
