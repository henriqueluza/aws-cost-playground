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
- `**/application/**`, `**/model/**` e `src/shared/lib/design/**` não importam `react`, `react-dom`, `@xyflow/*` nem módulo `http` (padrão `**/http`, que inclui `shared/lib/http`). O motor de preço e o contrato do design ficam em TypeScript puro.

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
- `src/features/<feature>/` — uma pasta por funcionalidade (`editor`, `pricing`, `designs`, `compare`, `auth`, `account`, `workload`, `export`, `legal`). Uma feature só importa outra pelo `index.ts`. O motor de preço (`pricing/{application,model}`) é TypeScript puro, sem React, React Flow nem `fetch`. O lint que cobra essas fronteiras (`eslint-plugin-boundaries` + `no-restricted-imports`) já está ativo desde o PR #88; veja "Lint de arquitetura".
- `src/shared/` — `config/` (schema e carga do `/config.json`), `lib/design/` e `ui/` (tokens e estilo base, veja abaixo). `lib/design/` guarda o contrato do documento do design: schema zod, tipos, limites (`DESIGN_LIMITS`) e `effectiveUsage`. Fica em `shared` porque várias features o usam. Importe pelo `index.ts`. Regras de validação: `docs/architecture/aws-cost-playground/design-document.md`.
- `src/test/` — setup dos testes (Vitest + Testing Library).

## Tokens e estilo base

- `src/shared/ui/tokens.css` é cópia literal dos blocos `css` do `DESIGN.md` (raiz do repositório), a fonte da verdade visual. Os nomes e valores dos tokens não se inventam aqui.
- Para mudar um token, edite o `DESIGN.md` e o `tokens.css` juntos, no mesmo PR. O teste `src/shared/ui/tokens.test.ts` compara os dois nos dois sentidos e falha se divergirem.
- O Prettier ignora o `tokens.css` (`.prettierignore`) para não reformatar a cópia; não o formate à mão.
- `base.css` (estilo base) e `global.css` (importa tokens e base) ficam em `src/shared/ui/`; o `global.css` é importado em `src/main.tsx`. Componentes usam `var(--token)`, sem cores ou medidas fixas.
- `public/theme.js` escolhe o tema antes da primeira pintura: script clássico no `<head>` de `index.html`, sem `defer` e nunca inline (a CSP não ganha `unsafe-inline`). Grava `data-theme` (`light` ou `dark`) no `<html>` a partir de `localStorage['acp-theme']` ou de `prefers-color-scheme`. Fica em `public/`, então o Vite o copia para `dist/theme.js` sem hash e sem passar pelo bundler; o hosting deve servi-lo com `Cache-Control` curto. Regra completa em "Como o tema é escolhido" no `DESIGN.md`.
- `fonts.css` declara 10 `@font-face` (IBM Plex Sans 400/500/600 e Mono 400/500, subconjuntos latin e latin-ext, só woff2, `font-display: swap`, `unicode-range` do `unicode.json` do pacote). Os arquivos vêm de `@fontsource/ibm-plex-sans` e `@fontsource/ibm-plex-mono` (versão exata) e saem em `dist/assets`; nenhuma fonte vem de CDN. `tooling/fontLicenses.ts` emite a licença SIL OFL 1.1 de cada pacote em `dist/fonts/OFL-*.txt`.
- O build proíbe URI `data:`: `build.assetsInlineLimit: 0` e o plugin `tooling/noDataUri.ts`, que falha o build se um chunk ou asset de texto contiver `data:<tipo>/<subtipo>[;,]`. Assim a CSP não precisa liberar `data:`.
