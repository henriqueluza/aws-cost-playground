# C4 — Contexto: AWS Cost Playground

Nível 1 (contexto). Decisões em [ADR-0001](ADR-0001-stack.md).

```mermaid
C4Context
    title AWS Cost Playground — diagrama de contexto

    Person(anon, "Visitante anônimo", "Monta diagramas, vê a estimativa, baixa e abre o JSON do design")
    Person(user, "Usuário logado", "Tudo do anônimo, mais salvar designs e pedir a estimativa de carga à LLM")
    Person(author, "Autor / operador", "Paga a conta, faz merge, dispara deploy de produção, recebe alertas")

    System(acp, "AWS Cost Playground", "Editor visual de arquiteturas AWS com estimativa de custo mensal por SKU real")

    System_Ext(claude, "Claude API (Anthropic)", "Traduz descrição de carga + diagrama em uso numérico por bloco")
    System_Ext(pricelist, "AWS Price List Query API", "Fonte dos preços por SKU; consultada só pelo CI")
    System_Ext(github, "GitHub Actions", "CI, build dos preços, deploy de staging e de produção")
    System_Ext(budgets, "AWS Budgets", "Alertas de gasto e ação de corte, configurados à mão pelo autor")

    Rel(anon, acp, "Usa o editor", "HTTPS")
    Rel(user, acp, "Usa o editor, salva designs, re-estima carga", "HTTPS + JWT")
    Rel(acp, claude, "Envia descrição e diagrama; recebe usage", "HTTPS, chave no SSM")
    Rel(github, pricelist, "GetProducts semanal", "HTTPS, OIDC")
    Rel(github, acp, "Publica artefatos e preços", "OIDC")
    Rel(budgets, acp, "Bloqueia o proxy da LLM no limite", "Política IAM")
    Rel(budgets, author, "Alertas de gasto", "E-mail")
    Rel(author, github, "Merge e disparo manual de produção", "HTTPS")
```

## Fronteiras que importam

| Fronteira | O que cruza | Controle |
|---|---|---|
| Navegador → API | designs do usuário, pedido de estimativa | JWT do Cognito validado no API Gateway; identidade vem só do claim `sub` |
| API → Claude API | descrição de carga (texto livre) e diagrama | única fronteira que gasta dinheiro do autor; quotas, limite de tamanho, limite de gasto do workspace |
| CI → conta AWS | artefatos, Terraform, preços | OIDC com papel por ambiente; nenhuma chave estática |
| Arquivo JSON → navegador | design aberto por um anônimo | entrada não confiável; validada por schema antes de entrar no estado do editor |
