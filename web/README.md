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
- `**/application/**` e `**/model/**` não importam `react`, `react-dom`, `@xyflow/*` nem `shared/lib/http` (motor de preço puro).

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
- `src/features/<feature>/` — uma pasta por funcionalidade (`editor`, `pricing`, `designs`, `compare`, `auth`, `account`, `workload`, `export`, `legal`). Uma feature só importa outra pelo `index.ts`. O motor de preço (`pricing/{application,model}`) é TypeScript puro, sem React, React Flow nem `fetch`. O lint que cobra essas fronteiras (`eslint-plugin-boundaries` + `no-restricted-imports`) entra na #85.
- `src/shared/` — `config/` (schema e carga do `/config.json`) e `ui/`.
- `src/test/` — setup dos testes (Vitest + Testing Library).
