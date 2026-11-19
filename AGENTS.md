# Projeto da AI Software House

Regras deste repositório (somam-se a `~/.codex/AGENTS.md`; os padrões detalhados estão em `.agents/skills/engineering-standards`).

## Fluxo
- Toda tarefa vem de uma Issue com critérios de aceite. Uma Issue = uma branch = um PR.
- Implementação: skill `implement-issue`. Revisão: skill `review-pr` (no Codex, execute as revisões de código, segurança e QA em sequência).
- Revisão em rodadas, como em um time: `changes-requested` → o autor corrige com a skill `address-review` e aplica `re-review` → nova revisão → `review:approved`. `needs-human` é só para decisão que o agente não pode tomar. Autor nunca aplica `review:approved`.
- Padrões de código: skill `engineering-standards` + guia da stack. Arquitetura e nível (`simple`/`clean`/`clean+ddd`) estão no ADR em `docs/architecture/`.
- Ao terminar uma etapa, escreva `docs/handoff/<issue>.md` (estado, decisões, próximo passo, testes pendentes).

## Stack deste projeto

Monorepo. Decisões em `docs/architecture/aws-cost-playground/ADR-0001-stack.md`; escopo em `docs/product/aws-cost-playground/PRD.md`.

| Pasta | Stack | Nível |
|---|---|---|
| `web/` | React + TypeScript + Vite (SPA), React Flow, Zustand, TanStack Query, zod | `clean` |
| `api/` | Python + FastAPI + Pydantic v2 em AWS Lambda; DynamoDB (boto3); SDK `anthropic` | `simple` |
| `pricing/` | Script Python que gera o catálogo de preços a partir da Price List API | `simple` |
| `infra/` | Terraform (AWS, us-east-1, 100% serverless, nada em VPC) | — |

- Banco: DynamoDB on-demand, tabela única. Auth: Cognito (JWT validado no API Gateway).
- Hospedagem: S3 + CloudFront (site), API Gateway HTTP API + Lambda (API). Ambientes `staging` e `production`.
- Guias: `.claude/skills/engineering-standards/references/stacks/react-nextjs.md` (adaptado para SPA Vite) e `fastapi.md` (adaptado para DynamoDB).

### Comandos de qualidade

```bash
# web/
npx prettier --check . && npx eslint . && npx tsc --noEmit && npm test -- --run && npm run build
# api/ e pricing/
uv run ruff format --check . && uv run ruff check . && uv run mypy app && uv run lint-imports && uv run pytest -q --cov
# infra/
terraform fmt -check -recursive infra && tflint --recursive && trivy config infra
```

### Regras deste projeto

- **Segurança primeiro.** Identidade do usuário vem só do claim `sub` do JWT. Toda entrada é validada (zod no `web/`, Pydantic na `api/`). A resposta da LLM é revalidada e nenhum texto livre dela é exibido. Nenhum segredo em código, log, teste ou commit.
- **Motor de preço é TypeScript puro.** `web/src/features/pricing/{application,model}` não importa React, React Flow nem `fetch`.
- **Custo.** O teto de hospedagem é US$ 20/mês e não há custo fixo além da zona do Route 53. Qualquer decisão que envolva valores (serviço pago novo, troca de modelo ou de quota da LLM, custo fixo) ou algo não previsto no ADR vai para a seção "Decisões tomadas sem humano" do PR; se criar custo, aplique `needs-human` e não siga.
- **Infra.** Agentes nunca aplicam nem destroem infra, não importam recursos, não mexem no estado do Terraform e não tocam em `infra/bootstrap/`. Recurso com dado ou identidade leva `prevent_destroy`. Plano com `delete` ou `replace` é `needs-human`. A configuração de custo na AWS (Budgets, limites, concorrência) é feita à mão pelo autor: não a automatize.
- **Prazo.** O produto completo é apresentado em 08/12/2026.

## Proibido
- Merge em main, deploy, `git push --force`, remover/pular testes para o CI passar, editar `.github/workflows` sem autorização explícita, ler `.env`/segredos.
