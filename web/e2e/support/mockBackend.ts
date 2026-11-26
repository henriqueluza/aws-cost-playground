import type { Page, Route } from '@playwright/test';

/**
 * Login e API simulados para os fluxos de conta. Nada sai da máquina: o `/config.json` aponta para
 * origens `https` fictícias (`*.e2e.test`) e toda requisição a elas é atendida aqui, no contexto do
 * navegador. O Cognito simulado faz o Authorization Code + PKCE de verdade do lado do app (o
 * `state` e o `nonce` da URL de autorização voltam no callback e no ID token); a API guarda os
 * designs em memória e imita as respostas do backend (409, 429, 204).
 */

const AUTH = 'https://auth.e2e.test';
const AUTHORITY = `${AUTH}/pool`;
const API = 'https://api.e2e.test';
const CLIENT_ID = 'e2e-client';
const ACCESS_TOKEN = 'e2e-access-token';

export const E2E_EMAIL = 'pessoa@example.com';
export const DAILY_LIMIT = 20;

type DesignDoc = { region: string; blocks: unknown[] } & Record<string, unknown>;
type StoredDesign = {
  id: string;
  name: string;
  doc: DesignDoc;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type EstimateBody = { blocks: { id: string; type: string }[] };

/** Estado e gatilhos do backend simulado, para o teste ler e provocar situações. */
export type MockBackend = {
  readonly designs: StoredDesign[];
  readonly estimateBodies: EstimateBody[];
  readonly accountDeleted: () => boolean;
  readonly revoked: () => number;
  /** O teste simula outro dispositivo gravando o design: a versão do servidor sobe. */
  bumpVersion(id: string): void;
  /** Daqui em diante `POST /estimates` responde 429 de quota do escopo dado. */
  exhaustQuota(scope: 'user' | 'global'): void;
};

/** ULID fictício e único: prefixo fixo e contador em dígitos (todos válidos no base32 de Crockford). */
function ulid(counter: number): string {
  return `01ARZ3NDEKTSV4RRFF${String(counter).padStart(8, '0')}`;
}

const base64Url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

export async function mockBackend(page: Page, siteUrl: string): Promise<MockBackend> {
  const siteOrigin = new URL(siteUrl).origin;
  const cors = {
    'Access-Control-Allow-Origin': siteOrigin,
    'Access-Control-Allow-Headers': 'authorization, content-type, accept',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
  const designs: StoredDesign[] = [];
  const estimateBodies: EstimateBody[] = [];
  let counter = 0;
  let deleted = false;
  let revoked = 0;
  let exhausted: 'user' | 'global' | null = null;
  let nonce = '';
  let used = 0;

  const json = (route: Route, status: number, body?: unknown, type = 'application/json') =>
    route.fulfill({
      status,
      headers: cors,
      ...(body === undefined ? {} : { contentType: type, body: JSON.stringify(body) }),
    });
  const resetsAt = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
  const summary = ({ doc, ...rest }: StoredDesign) => ({
    ...rest,
    region: doc.region,
    schemaVersion: 1,
    blockCount: doc.blocks.length,
    sizeBytes: JSON.stringify(doc).length,
  });

  // O app aceita a configuração só se as URLs forem https (ou localhost): as daqui são fictícias.
  await page.route('**/config.json', (route) =>
    route.fulfill({
      json: { apiBaseUrl: API, cognitoAuthority: AUTHORITY, cognitoClientId: CLIENT_ID },
    }),
  );

  await page.route(`${AUTH}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      return json(route, 200, {
        issuer: AUTHORITY,
        authorization_endpoint: `${AUTH}/oauth2/authorize`,
        token_endpoint: `${AUTH}/oauth2/token`,
        revocation_endpoint: `${AUTH}/oauth2/revoke`,
        end_session_endpoint: `${AUTH}/logout`,
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/oauth2/authorize') {
      nonce = url.searchParams.get('nonce') ?? '';
      const callback = new URL('/auth/callback', siteOrigin);
      callback.search = new URLSearchParams({
        code: 'e2e-code',
        state: url.searchParams.get('state') ?? '',
      }).toString();
      return route.fulfill({ status: 302, headers: { Location: callback.toString() } });
    }
    if (url.pathname === '/oauth2/token') {
      const idToken = [
        base64Url({ alg: 'none' }),
        base64Url({
          iss: AUTHORITY,
          aud: CLIENT_ID,
          sub: 'e2e-user-sub',
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce,
          token_use: 'id',
          email: E2E_EMAIL,
          email_verified: true,
        }),
        'assinatura',
      ].join('.');
      return json(route, 200, {
        access_token: ACCESS_TOKEN,
        id_token: idToken,
        refresh_token: 'e2e-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    if (url.pathname === '/oauth2/revoke') {
      revoked += 1;
      return json(route, 200, {});
    }
    if (url.pathname === '/logout') {
      return route.fulfill({ status: 302, headers: { Location: `${siteOrigin}/` } });
    }
    return route.fulfill({ status: 404 });
  });

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.headers()['authorization'] !== `Bearer ${ACCESS_TOKEN}`) return json(route, 401);
    const segments = new URL(request.url()).pathname.split('/').filter(Boolean);
    const [resource, id, action] = segments;
    const method = request.method();
    const body = (request.postData() ? JSON.parse(request.postData() ?? '{}') : {}) as Record<
      string,
      unknown
    >;
    const found = designs.find((design) => design.id === id);

    if (resource === 'designs') {
      if (id === undefined && method === 'GET') {
        return json(route, 200, [...designs].reverse().map(summary));
      }
      if (id === undefined && method === 'POST') {
        const now = new Date().toISOString();
        counter += 1;
        const design: StoredDesign = {
          id: ulid(counter),
          name: String(body.name),
          doc: body.doc as DesignDoc,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        designs.push(design);
        return json(route, 201, { ...summary(design), doc: design.doc });
      }
      if (found === undefined) return json(route, 404);
      if (method === 'GET') return json(route, 200, { ...summary(found), doc: found.doc });
      if (method === 'PATCH') {
        if (body.expectedVersion !== found.version) return json(route, 409);
        found.name = typeof body.name === 'string' ? body.name : found.name;
        found.doc = (body.doc as DesignDoc | undefined) ?? found.doc;
        found.version += 1;
        found.updatedAt = new Date().toISOString();
        return json(route, 200, { ...summary(found), doc: found.doc });
      }
      if (method === 'DELETE') {
        designs.splice(designs.indexOf(found), 1);
        return json(route, 204);
      }
      if (method === 'POST' && action === 'duplicate') {
        const now = new Date().toISOString();
        counter += 1;
        const copy = { ...found, id: ulid(counter), name: String(body.name), version: 1 };
        copy.createdAt = now;
        copy.updatedAt = now;
        designs.push(copy);
        return json(route, 201, { ...summary(copy), doc: copy.doc });
      }
    }

    if (resource === 'quota' && method === 'GET') {
      return json(route, 200, {
        limit: DAILY_LIMIT,
        remaining: DAILY_LIMIT - used,
        resetsAt: resetsAt(),
      });
    }

    if (resource === 'estimates' && method === 'POST') {
      if (exhausted !== null) {
        return json(
          route,
          429,
          { scope: exhausted, resetsAt: resetsAt() },
          'application/problem+json',
        );
      }
      const sent = body as EstimateBody;
      estimateBodies.push(sent);
      used += 1;
      // Só o que o contrato do tipo aceita: o S3 ganha armazenamento e o Lambda, requisições.
      const values: Record<string, Record<string, number>> = {
        'aws.s3': { storageGb: 777 },
        'aws.lambda': { requestsPerMonth: 4_000_000 },
      };
      return json(route, 200, {
        blocks: sent.blocks.flatMap(({ id: blockId, type }) =>
          values[type] ? [{ id: blockId, values: values[type], source: 'llm' }] : [],
        ),
        edges: [],
        quota: { limit: DAILY_LIMIT, remaining: DAILY_LIMIT - used, resetsAt: resetsAt() },
      });
    }

    if (resource === 'me' && method === 'DELETE') {
      deleted = true;
      designs.length = 0;
      return json(route, 204);
    }
    return json(route, 404);
  });

  return {
    designs,
    estimateBodies,
    accountDeleted: () => deleted,
    revoked: () => revoked,
    bumpVersion(designId) {
      const design = designs.find((candidate) => candidate.id === designId);
      if (design) design.version += 1;
    },
    exhaustQuota(scope) {
      exhausted = scope;
    },
  };
}
