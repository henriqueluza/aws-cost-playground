# pricing — aws-cost-playground

Script Python executado no CI que vai gerar o catálogo de preços (`web/public/prices/<region>/<service>.json`) a partir da AWS Price List API. Stack e decisões: `docs/architecture/aws-cost-playground/ADR-0001-stack.md`. Nível de arquitetura: `simple`.

O gerador está completo (Issue #28, partes #195, #202, #196 e #214): cliente da Price List Query API (`GetProducts`, região `us-east-1`, credenciais da cadeia padrão do ambiente: variáveis `AWS_*`, perfil ou role do CI), registro dos 17 serviços, serialização, schema em Python, checagens, geração, gravação e CLI. Os filtros reais de cada serviço entram nas Issues de bloco (#30 a #42); o workflow semanal é a #29.

## Pré-requisitos

- Python 3.14 (veja `.python-version`).
- [uv](https://docs.astral.sh/uv/) 0.13.8 ou superior (`required-version` no `pyproject.toml`). O `pyproject.toml` define `exclude-newer = "7 days"`: o uv só resolve versões publicadas há pelo menos 7 dias.

## Uso

```bash
uv sync   # instala conforme o uv.lock (inclui o grupo dev)
```

Os comandos abaixo rodam em `pricing/`.

```bash
uv run python -m app        # ou: uv run python -m app generate
uv run python -m app seed
```

- `generate` (padrão): consulta a Price List com as credenciais do ambiente, confere tudo em memória e só então grava em `web/public/prices/`. Se qualquer checagem falhar, sai com exit 1 e nada é gravado. O relatório (variações, serviços provisórios) vai para o stdout e os erros para o stderr. `--root PATH` troca a raiz do repositório.
- `seed`: não usa AWS nem o relógio. Valida os arquivos versionados `web/public/prices/<region>/<service>.json` dos serviços registrados e regrava só o `web/public/prices/manifest.json` (`source: seed`, `generatedAt` fixo em `SEED_GENERATED_AT`). Mesmos arquivos, mesmos bytes.

## Resumo do PR e publicação do catálogo (#29)

O workflow semanal (parte 2, #222) encadeia dois passos. Esta parte entrega os dois, sem o workflow.

```bash
# em pricing/
uv run python -m app generate > report.txt
uv run python -m app.summary < report.txt > body.md
# na raiz do repositório (HEAD = main, catálogo já regravado)
bash scripts/prices-pr.sh body.md
```

- `app.summary` lê o relatório do `generate` no stdin e escreve o corpo do PR em Markdown: `## SKUs adicionados`, `## SKUs removidos`, `## Variações acima de 30%` e `## Outros`, mais o rodapé (merge humano; o PR do `GITHUB_TOKEN` não dispara o CI, então feche e reabra). Seção vazia mostra `Nenhum.`; mais de 100 itens viram `e mais N`. Nenhuma linha do relatório entra crua: só entram linhas no formato conhecido, com SKU validado por `is_sku` e arquivo por `file_key`; o resto vira contagem em `Outros`. Sempre sai com exit 0.
- `scripts/prices-pr.sh <body-file>` mantém um único PR, da branch `prices/catalogo` para `main`, e precisa de `git` e `gh` autenticado (`GH_TOKEN`). O commit tem a árvore de `main` mais o catálogo novo e, como segundo pai, a ponta anterior da branch: o push é fast-forward, nunca `--force`. O `manifest.json` não entra na comparação (a data muda a cada execução), mas vai no commit quando há mudança nos preços. PR vindo de fork com o mesmo nome de branch é ignorado.
- Saída (uma linha no stdout): `sem mudança`, `pr criado`, `pr atualizado` ou `pr fechado`. Quando o catálogo volta a ser igual ao de `main`, o PR aberto é fechado com um comentário.
- Os testes do script ficam em `infra/tools/tests/test_prices_pr_script.py` e usam um `origin` descartável, sem rede.

## Qualidade

```bash
uv run ruff format --check . && uv run ruff check . && uv run mypy app && uv run lint-imports && uv run pytest -q --cov
```

Os testes não fazem rede nem precisam de credenciais AWS: simulam o `GetProducts` com `botocore.stub.Stubber`, e os de serviço leem respostas reais gravadas em `tests/fixtures/`.

## Estrutura de `app/`

- `catalog.py` — `REGIONS` (`us-east-1` e `sa-east-1`), `file_key(region, service)` (`<region>/<service>.json`, a chave do arquivo no manifest) e `output_path(root, region, service)`, que devolve o caminho do JSON de um serviço em uma região.
- `model.py` — tipos do gerador (`Filter`, `Query`, `Dimension`, `Product`, `Tier`, `FreeTier`, `Price`, `ServiceSpec`), `region_filter`, `PricingError` e `decimal_text`.
- `products.py` — `parse_product` (parse defensivo de um item do PriceList) e `tiers` (faixas de preço de uma dimensão).
- `client.py` — `make_client` (cliente boto3 `pricing` em `us-east-1`) e `fetch_products` (`GetProducts` paginado, com filtros).

- `render.py` — `render_price_file(service, region, prices)` (bytes do arquivo de preço, sempre os mesmos para a mesma entrada), `render_manifest(hashes, generated_at, source)` (bytes do `manifest.json`: `files` em ordem de `path`, data em UTC com `Z` e precisão de segundos) e `sha256_hex(content)`.
- `schema.py` — `validate_price_file(doc)` e `validate_manifest(doc)`: espelho em Python do zod de `web/src/features/pricing/model/catalog.ts`, igual ou mais estrito. Devolvem a lista de erros (`[]` é válido), cada um como `caminho: mensagem fixa`, sem o valor recusado.
- `checks.py` — `blocking` (impede a gravação: nenhum preço, SKU esperado ausente, preço negativo, arquivo de 500 KB ou mais), `regression` (também impede: mais da metade dos SKUs do arquivo anterior sumiu, ou um preço positivo virou zero) e `variation` (só relata: SKU novo, SKU removido, faixa com variação maior que 30%).
- `generate.py` — `generate(specs, fetch, prices_dir, now)` (monta e confere em memória, não grava), `seed(specs, prices_dir)`, `write(prices_dir, files)`, `Result` (`files` e `report`) e `Fetch` (função que atende uma `Query`).
- `__main__.py` — a CLI (`generate` e `seed`, `--root`).
- `summary.py` — `pr_body(report)` e `python -m app.summary`: corpo do PR semanal a partir do relatório (seção abaixo).
- `services/` — registro: um módulo por serviço, cada um exporta `SERVICE = ServiceSpec(...)`; `SERVICES` junta os 17, em ordem de slug.

## Registro de serviços

O registro fica em `app/services/` (e não em `pricing/services/`, como diz o texto da #28 e das Issues de bloco). Motivo: mypy, cobertura e import-linter já cobrem `app`; fora dele o código ficaria sem essas checagens.

Os 17 módulos já existem e já estão em `SERVICES`. Módulo sem consulta é provisório (não consulta a AWS e não gera preço); o implementado consulta a Price List; o docstring diz o que fica de fora e as constantes do módulo dizem o que é consultado e os SKUs gerados. O nome do módulo é o slug com `_` no lugar de `-` (`nat_gateway.py`, `secrets_manager.py`); `lambda` é `lambda_.py`. O slug é o tipo do bloco sem `aws.` e vira o nome do arquivo do catálogo.

A Issue de um bloco edita só o módulo do próprio serviço e cria o teste dele em `tests/test_service_<slug com _>.py`. Não edita `services/__init__.py` nem `tests/test_services.py`: o teste do registro vale para serviço provisório e para serviço implementado.

No módulo do serviço:

1. `queries(region)` devolve as consultas (`Query(service_code, filters)`). Os filtros de uma consulta se combinam por AND; famílias diferentes pedem mais de uma `Query`.
2. `build(region, products)` monta os `Price` com SKU, descrição e unidade do catálogo, usando `tiers(product.dimensions)` para as faixas.
3. `expected_skus` lista os SKUs que não podem faltar no arquivo.

Padrão dos serviços implementados (siga nos próximos blocos; referência: `app/services/lambda_.py`):

- **Consultas estreitas:** só `TERM_MATCH`, uma `Query` por produto: `regionCode` (ou `usagetype`, no produto global) mais o atributo que separa o produto (`group`, `queueType`…). Só entra o conjunto fechado de atributos que o módulo conhece.
- **Franquia do produto global, quando existir:** lida da Price List, não fixada no código. O produto deve ter 1 dimensão, início 0, preço 0 e fim finito (o fim é a franquia); senão, `PricingError`.
- **Recusa:** produto duplicado, unidade AWS fora do conjunto esperado ou 1ª faixa do produto regional com preço 0 dão `PricingError`. Exceção: SKU com franquia embutida (DynamoDB), em que a AWS põe a franquia como 1ª faixa grátis do próprio produto regional; esse SKU precisa ter exatamente 2 faixas (0 a F com preço 0, F sem fim paga), a 1ª vira `freeTier` (sem pool) e outro formato dá `PricingError`. Com erro, nada é gravado e o arquivo versionado continua.
- **Testes:** `tests/test_service_<slug com _>.py` lê fixtures reais em `tests/fixtures/<slug>-<região>.jsonl` (formato PriceList, um item por linha, tirado do bulk offer file público da AWS, com a data no docstring do teste). O teste de `generate()` compara com a semente só `sku`, `description`, `unit` e `freeTier.pool`, não as faixas nem a quantidade da franquia: o workflow semanal (#29) atualiza números da AWS sem quebrar teste. Faixas e franquia são conferidas contra as fixtures.
- **Price List global e franquia fora dela** (ex.: CloudFront, cobrado pela borda e não pela região): serviço sem `regionCode` tem uma fixture só, `tests/fixtures/<slug>.jsonl`. A franquia permanente que a Price List não publica fica numa constante do módulo, com o motivo no docstring, e o `build` recusa qualquer faixa com preço 0, que contaria a franquia duas vezes.
- **`usagetype` regional com prefixo** (ex.: ElastiCache, em que o `usagetype` separa o nó do Extended Support e do Outposts): o prefixo vem de uma tabela fechada do módulo, com as chaves de `catalog.REGIONS` (`""` em us-east-1, `SAE1-` em sa-east-1); região fora dela dá `PricingError`. A consulta usa `regionCode` + `usagetype` completo + o atributo que separa o produto (`operation`, no ElastiCache).

## Serviço provisório e gravação

No `generate`, serviço provisório (sem consulta) não gera arquivo: o arquivo já versionado é exigido (ausente é erro), validado, mantido e entra no manifest, que então sai com `source: seed`. O manifest só sai `price-list` quando todos os serviços registrados têm consulta. Sem nenhum serviço com consulta, nada é gravado.

O `write` passa as chaves pela allowlist de `file_key`, grava tudo primeiro em arquivo temporário no mesmo diretório e depois troca com `os.replace`, com o manifest por último. Se algum temporário falhar, nada é trocado. Diretório de região que seja link para fora de `prices/` é recusado. Se um `os.replace` falhar no meio, o manifest antigo permanece e o `web/` recusa pelo `sha256` o arquivo já trocado (erro `integrity`), em vez de mostrar preço sem manifest; rodar o comando de novo conserta.

## Catálogo semente e manifest

Os arquivos `web/public/prices/us-east-1/<slug>.json` e `web/public/prices/sa-east-1/<slug>.json` já existem: o serviço ainda provisório tem `prices: []` e a Issue do bloco preenche os seus com os preços da Price List pública do dia. As Issues de bloco (#30 a #42) rodam em paralelo; para os PRs fazerem merge sem conflito, cada bloco:

1. edita só `app/services/<slug com _>.py`;
2. cria `tests/test_service_<slug com _>.py`;
3. preenche os dois arquivos semente do seu serviço (`source: seed` é do manifest; o arquivo segue o formato de `price-catalog.md`);
4. roda `uv run python -m app seed`.

O `manifest.json` nunca é editado à mão. O comando reescreve só as linhas de `sha256` dos arquivos alterados (cada entrada ocupa 4 linhas e a data do manifest `seed` é fixa), então dois blocos não mudam a mesma linha. `tests/test_seed_catalog.py` falha no CI se o manifest versionado não bater com os arquivos.

O bloco não edita `services/__init__.py`, `tests/test_services.py` nem arquivo de outro serviço. O nome de `pool` começa com o slug do serviço, porque o `pool` é global no catálogo.

## Teste de contrato com o `web/`

`web/src/features/pricing/api/__fixtures__/generator/` guarda um arquivo de preço e um manifest com os bytes exatos que o `render.py` produz. `tests/test_seed_catalog.py` confere os bytes. `web/src/features/pricing/api/generatorContract.test.ts` passa esses arquivos e o catálogo versionado pelo carregador real (zod e sha256).

## Validação de caminho

`file_key` e `output_path` só aceitam região da lista fechada `REGIONS` e serviço no formato `[a-z][a-z0-9-]{0,39}` (o mesmo slug do zod do `web/`). Qualquer outra entrada levanta `ValueError`, o que impede que `..` ou separadores de caminho façam a escrita escapar de `web/public/prices/`.

## Lint de arquitetura

O `import-linter` (`uv run lint-imports`, contrato `forbidden` em `pyproject.toml`) proíbe que `app` importe `fastapi`, `anthropic` ou `mangum`. Esses pacotes pertencem à `api/`; o script de preços usa só `boto3`.
