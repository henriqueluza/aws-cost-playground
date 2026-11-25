# web — aws-cost-playground

SPA em React 19 + TypeScript + Vite. Stack e decisões: `docs/architecture/aws-cost-playground/ADR-0001-stack.md`.

## Pré-requisitos

- Node 26 (veja `.nvmrc`; com nvm: `nvm use`).
- npm. O `.npmrc` fixa versões exatas (`save-exact`) e exige 7 dias de idade mínima nos pacotes (`min-release-age=7`).

## Uso

```bash
npm ci        # instala conforme o package-lock.json
npm run dev   # servidor de desenvolvimento do Vite
```

## Qualidade

```bash
npx prettier --check . && npx eslint . && npx tsc --noEmit && npm test -- --run && npm run build
```

### Lint de arquitetura

As regras de import do ADR-0001 são verificadas pelo `npx eslint .` (config em `eslint.config.js`) e pelo teste `src/architecture.test.ts`:

- Uma feature só importa outra feature pelo `index.ts` dela.
- `app/` e as features podem importar `shared/`; `shared/` não importa feature nem `app/`.
- `**/application/**`, `**/model/**`, `src/shared/lib/design/**` e `src/shared/lib/money.ts` não importam `react`, `react-dom`, `@xyflow/*` nem módulo `http` (padrão `**/http`, que inclui `shared/lib/http`). O motor de preço, o contrato do design e o dinheiro ficam em TypeScript puro.

## Configuração de runtime (`/config.json`)

O build é o mesmo em todos os ambientes. O que muda por ambiente é o arquivo `/config.json`, buscado na inicialização (sem cache) e validado com zod. O deploy sobrescreve o arquivo de cada ambiente; `public/config.json` traz só valores de desenvolvimento.

```json
{
  "apiBaseUrl": "https://api.example.com",
  "cognitoAuthority": "https://cognito-idp.us-east-1.amazonaws.com/<pool-id>",
  "cognitoClientId": "<client-id>"
}
```

| Campo              | Regra                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `apiBaseUrl`       | URL da API; `https`, ou `http` apenas em `localhost`/`127.0.0.1` |
| `cognitoAuthority` | URL do emissor OIDC do Cognito; mesma regra de URL               |
| `cognitoClientId`  | 1 a 128 caracteres: letras, números, `_` e `-`                   |

Se o arquivo faltar, não for JSON ou violar o schema, o app mostra uma tela de erro e não carrega. Não coloque segredos nele: é público.

## Estrutura

- `src/app/` — composition root: bootstrap (carga da config e providers) e rotas (`/`, `/designs`, `/comparar`, `/conta`, `/privacidade`, `/termos`, `/auth/callback`; as páginas ainda estão vazias).
- `src/features/<feature>/` — uma pasta por funcionalidade (`editor`, `pricing`, `designs`, `compare`, `auth`, `account`, `workload`, `export`, `legal`). Uma feature só importa outra pelo `index.ts`. O motor de preço (`pricing/{application,model}`) é TypeScript puro, sem React, React Flow nem `fetch`. `pricing/model/catalog.ts` guarda o contrato do catálogo de preços (schemas zod do arquivo de preço e do `manifest.json`, `CATALOG_LIMITS` e tipos); regras em `docs/architecture/aws-cost-playground/price-catalog.md`. `pricing/model/engine.ts` expõe `estimate(design, catalog)`, que devolve o `CostEstimate` (custo mensal por bloco, aresta e total); por ora provisório, com zeros; contrato em `docs/architecture/aws-cost-playground/cost-estimate.md`. O lint que cobra essas fronteiras (`eslint-plugin-boundaries` + `no-restricted-imports`) já está ativo desde o PR #88; veja "Lint de arquitetura".
- `src/shared/` — `config/` (schema e carga do `/config.json`), `lib/design/` e `ui/` (tokens e estilo base, veja abaixo). `lib/design/` guarda o contrato do documento do design: schema zod, tipos, limites (`DESIGN_LIMITS`) e `effectiveUsage`. Fica em `shared` porque várias features o usam. Importe pelo `index.ts`. Regras de validação: `docs/architecture/aws-cost-playground/design-document.md`. `lib/money.ts` guarda dinheiro e quantidades sem ponto flutuante: `Decimal` é um `bigint` escalado em 10^-12 USD, com `decimal`, `add`, `sub`, `mul`, `div`, `compare`, `sum` e `toFixed`. `decimal`, `mul` e `div` arredondam meio-para-par na 12ª casa. Entrada inválida (não finita, fora do formato, mais de 64 caracteres ou expoente além de ±40) e divisão por zero lançam `RangeError`. `Decimal` não entra em JSON nem em estado persistido; sai por `toFixed`.
- `src/test/` — setup dos testes (Vitest + Testing Library).

## Tokens e estilo base

- `src/shared/ui/tokens.css` é cópia literal dos blocos `css` do `DESIGN.md` (raiz do repositório), a fonte da verdade visual. Os nomes e valores dos tokens não se inventam aqui.
- Para mudar um token, edite o `DESIGN.md` e o `tokens.css` juntos, no mesmo PR. O teste `src/shared/ui/tokens.test.ts` compara os dois nos dois sentidos e falha se divergirem.
- O Prettier ignora o `tokens.css` (`.prettierignore`) para não reformatar a cópia; não o formate à mão.
- `base.css` (estilo base) e `global.css` (importa tokens e base) ficam em `src/shared/ui/`; o `global.css` é importado em `src/main.tsx`. Componentes usam `var(--token)`, sem cores ou medidas fixas.
- `public/theme.js` escolhe o tema antes da primeira pintura: script clássico no `<head>` de `index.html`, sem `defer` e nunca inline (a CSP não ganha `unsafe-inline`). Grava `data-theme` (`light` ou `dark`) no `<html>` a partir de `localStorage['acp-theme']` ou de `prefers-color-scheme`. Fica em `public/`, então o Vite o copia para `dist/theme.js` sem hash e sem passar pelo bundler; o hosting deve servi-lo com `Cache-Control` curto. Regra completa em "Como o tema é escolhido" no `DESIGN.md`.
- `fonts.css` declara 10 `@font-face` (IBM Plex Sans 400/500/600 e Mono 400/500, subconjuntos latin e latin-ext, só woff2, `font-display: swap`, `unicode-range` do `unicode.json` do pacote). Os arquivos vêm de `@fontsource/ibm-plex-sans` e `@fontsource/ibm-plex-mono` (versão exata) e saem em `dist/assets`; nenhuma fonte vem de CDN. `tooling/fontLicenses.ts` emite a licença SIL OFL 1.1 de cada pacote em `dist/fonts/OFL-*.txt`.
- O build proíbe URI `data:`: `build.assetsInlineLimit: 0` e o plugin `tooling/noDataUri.ts`, que falha o build se um chunk ou asset de texto contiver `data:<tipo>/<subtipo>[;,]`. Assim a CSP não precisa liberar `data:`.

## Componentes de `shared/ui` e testes de acessibilidade

- `Button` e `IconButton` (`Button.tsx` + `Button.module.css`) seguem "Botões" e "Estados" do `DESIGN.md`. Variantes `primary`, `secondary` (padrão), `tertiary` e `destructive`; o `IconButton` não tem a terciária e exige `aria-label` (erro de tipo sem ele), que também vira o tooltip. `type` é `button` por padrão. Não aceitam `className` nem `style`: o visual vem só dos tokens. O texto entra como filho React, nunca como HTML.
- `Panel` (`Panel.tsx` + `Panel.module.css`) é o bloco "Section" do `DESIGN.md`: uma região rotulada pelo próprio título (`headingLevel` 2 a 4, padrão 2), com `font-variant-numeric: tabular-nums` em todo o conteúdo. Não aceita `className` nem `style`.
- `TextField`, `NumberField` e `SelectField` (+ `Field.module.css`) seguem "Campos" e "Estados" do `DESIGN.md` e usam a estrutura comum de `Field.tsx` (`Field` e `useFieldControl`, fora do `index.ts`): `<label>` visível acima, que é o nome acessível (o placeholder nunca o substitui); `error` é uma frase com ícone decorativo, ligada por `aria-describedby` e `aria-invalid`; `density` `panel` (padrão, `--control-height`) ou `form` (`--control-height-form`); desabilitado usa `--raised`, `--border` e `--faint`, e o motivo vai em `title`. O `NumberField` é um `<input type="text">` com algarismos tabulares e `inputMode` `decimal` (padrão) ou `numeric`: o valor é texto e a validação fica com a feature; a `unit` aparece dentro da caixa, à direita, em `--faint`, e entra na descrição acessível; clicar em qualquer ponto da caixa (unidade ou margem) foca o input. O `SelectField` é um `<select>` nativo com as opções como filhos `<option>` e seta SVG decorativa. O erro não é anunciado sozinho (sem `role="alert"`): a feature que valida decide quando mostrá-lo e leva o foco ao primeiro campo inválido. Não aceitam `className` nem `style`.
- `Notice` (`Notice.tsx` + `Notice.module.css`) é o aviso do `DESIGN.md`: `tone` `negative`, `warning` ou `neutral` e `message` (uma frase em `string`, nunca HTML). O papel ARIA segue o tom: `alert` no erro, `status` no aviso, `note` no neutro. Um `status` só é anunciado quando a frase muda com o aviso já montado; o que precisa ser ouvido ao aparecer é erro (`alert`). O ícone tem forma própria por tom (a cor não é o único sinal) e nome acessível `Erro` ou `Atenção` no erro e no aviso; no neutro o ícone é decorativo (`aria-hidden`). O fundo e o texto vêm do par `--pill-*` do tom. A frase é texto próprio da interface, escolhido pela feature, nunca `error.message`, detalhe do servidor nem texto da LLM; o aviso não tem ação nem botão de fechar. Não aceita `className` nem `style`.
- `EmptyState` (`EmptyState.tsx` + `EmptyState.module.css`) é o estado vazio: `title`, `description` e `action` (obrigatória), com contorno tracejado de 1px em `--control`. O título é um cabeçalho `headingLevel` 2 a 4 (padrão 3), escolhido pela feature conforme a hierarquia da página. O vazio sempre mostra a próxima ação (um `Button` passado pela feature); título e frase são texto próprio da interface, como no `Notice`. Não aceita `className` nem `style`.
- `ToastProvider` e `useToast` (`Toast.tsx` + `Toast.module.css`): o provider envolve a aplicação e renderiza, depois dos filhos, a caixa do toast no canto inferior esquerdo (flutuante: `--shadow-float`, `--radius-card`; no escuro, `--raised` com borda `--border`). `useToast().show(mensagem)` mostra uma frase de tom neutro; um toast por vez, e o novo substitui o atual. `useToast` fora do provider lança erro. A região `role="status"` fica sempre montada e contém só o texto; o botão de fechar (`IconButton` "Fechar mensagem") fica fora dela. O toast não move o foco, fecha com Esc quando o foco está dentro e, ao fechar, devolve o foco a quem o tinha antes. Some depois de 5 s (`TOAST_DURATION_MS`), com pausa enquanto o ponteiro está em cima ou o foco está dentro. A entrada usa só `opacity`/`transform` em `--t-ui`, e com `prefers-reduced-motion` não anima. Nunca leve no toast uma informação que só exista nele: erro fica no bloco que falhou (DESIGN.md, "Estados").
- Cada componente usa um CSS Module (`X.module.css`) só com `var(--…)`; um teste por arquivo confere que não há hex nem `px` literal.
- `src/test/axe.ts` exporta `expectNoAxeViolations(elemento)`, que roda o `axe-core` (versão exata, devDependency) e falha com a lista de violações. A regra `color-contrast` fica desligada: o jsdom não calcula cores, e o contraste dos pares de tokens já está verificado no `DESIGN.md`. Todo componente de `shared/ui` tem um teste que o usa, além do teste de teclado.
