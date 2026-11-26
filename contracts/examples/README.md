# Exemplos de contrato

`design/valid/` e `design/invalid/`: documentos crus do design (o JSON que o `designDocumentSchema` recebe).

- Um arquivo = um caso, em JSON compacto. Cada inválido parte de um documento válido mínimo e quebra uma regra só; o nome em kebab-case diz qual.
- Fonte da verdade: o schema zod em `web/src/shared/lib/design/designDocument.ts`.
- Lidos pelos dois lados, que precisam dar o mesmo veredito: `web/src/shared/lib/design/designExamples.test.ts` e `api/tests/test_design_document.py`.
- Limites grandes (101 blocos, 401 arestas, 2.001 caracteres, 350 KB) não têm arquivo: cada teste os gera.
- Casos de borda do parser também têm arquivo, porque é onde zod e Pydantic divergem por padrão: chave repetida (vale a última), `1.0` como inteiro, inteiro acima de 64 bits, `-0`, `1e400`, `"__proto__"`, texto em pontos de código. Divergência nova entre os lados vira exemplo aqui antes da correção.
- `NaN`, `Infinity` e substituto UTF-16 solto não têm arquivo: o primeiro par não é JSON e o último é a única divergência de veredito aceita (ver `api/README.md`).
