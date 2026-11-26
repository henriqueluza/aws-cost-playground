import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createHash } from 'node:crypto';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogError,
  createCatalogLoader,
  createCatalogSession,
  httpPriceFiles,
  priceCatalogKey,
  usePriceCatalog,
  type CatalogErrorKind,
  type PriceCatalogState,
} from '..';
import { designDocumentSchema, type Block, type DesignDocument } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';

type Bytes = Uint8Array<ArrayBuffer>;
type Design = Pick<DesignDocument, 'region' | 'blocks'>;
const SERVER_TEXT = '<img src=x onerror=alert(1)>';
const GENERATED_AT = '2026-11-23T12:00:00Z';

const server = setupServer();
const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
  vi.spyOn(console, method),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});
afterAll(() => server.close());

const encode = (value: unknown): Bytes => new TextEncoder().encode(JSON.stringify(value));
const priceFile = (path: string, extra: object = {}): Bytes => {
  const [region, service] = path.replace('.json', '').split('/');
  return encode({ schemaVersion: 1, service, region, currency: 'USD', prices: [], ...extra });
};
const PATHS = ['lambda', 's3', 'rds'].flatMap((service) =>
  ['us-east-1', 'sa-east-1'].map((region) => `${region}/${service}.json`),
);

/**
 * Publica em `/prices/` da origem do teste um catálogo com lambda, s3 e rds nas duas regiões.
 * `served` troca o que o servidor entrega para um caminho depois de o manifest ter o hash.
 * Devolve os caminhos pedidos, na ordem.
 */
function publish(served: Record<string, Bytes | Response> = {}, source = 'seed'): string[] {
  const listed = Object.fromEntries(PATHS.map((path) => [path, priceFile(path)]));
  const manifest = encode({
    schemaVersion: 1,
    source,
    generatedAt: GENERATED_AT,
    files: Object.entries(listed).map(([path, bytes]) => ({
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
  });
  const files: Record<string, Bytes | Response> = {
    'manifest.json': manifest,
    ...listed,
    ...served,
  };
  const seen: string[] = [];
  server.use(
    http.all(`${location.origin}/prices/*`, ({ request }) => {
      const path = new URL(request.url).pathname.slice('/prices/'.length);
      seen.push(path);
      const file = files[path];
      if (file instanceof Response) return file.clone();
      return file ? new HttpResponse(file) : new HttpResponse(SERVER_TEXT, { status: 404 });
    }),
  );
  return seen;
}

/** Sessão nova por teste: o manifest guardado não passa de um teste para o outro. */
const newSession = () => createCatalogSession(() => createCatalogLoader(httpPriceFiles()));

function render(initial: Design, defaults: object = {}, load = newSession()) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, ...defaults } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const states: PriceCatalogState[] = [];
  const hook = renderHook(
    ({ design }) => {
      const state = usePriceCatalog(design, load);
      states.push(state);
      return state;
    },
    { wrapper, initialProps: { design: initial } },
  );
  const settled = async <S extends PriceCatalogState['status']>(status: S) => {
    await waitFor(() => expect(hook.result.current.status).toBe(status));
    return hook.result.current as Extract<PriceCatalogState, { status: S }>;
  };
  return { ...hook, client, states, settled };
}
const us = (path: string) => `us-east-1/${path}.json`;
const design: Design = designDocumentSchema.parse(adrExampleDesign);
const [lambda, s3] = design.blocks as [Block, Block];
const withRds: Design = {
  ...design,
  blocks: [...design.blocks, { ...lambda, id: 'blk_db', type: 'aws.rds', attributes: {} }],
};

describe('usePriceCatalog', () => {
  it('carrega só os serviços e a região do design e expõe a origem e a data do manifest', async () => {
    const seen = publish();
    // Sem o segundo argumento: a sessão da aplicação, com o adaptador HTTP.
    const { result } = renderHook(() => usePriceCatalog(design), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
      ),
    });
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const state = result.current as Extract<PriceCatalogState, { status: 'ready' }>;
    expect(state).toMatchObject({ source: 'seed', generatedAt: GENERATED_AT, updating: false });
    expect(state.catalog.region).toBe('us-east-1');
    expect([...state.catalog.services.keys()].sort()).toEqual(['lambda', 's3']);
    expect(seen[0]).toBe('manifest.json');
    expect(seen.slice(1).sort()).toEqual([us('lambda'), us('s3')]);
  });

  it('expõe a origem `price-list`', async () => {
    publish({}, 'price-list');
    expect((await render(design).settled('ready')).source).toBe('price-list');
  });

  it('trocar de região carrega o outro conjunto, com o manifest lido uma só vez', async () => {
    const seen = publish();
    const { rerender, result, settled } = render(design);
    await settled('ready');
    seen.length = 0;
    rerender({ design: { ...design, region: 'sa-east-1' } });
    // Enquanto o novo não chega, o catálogo anterior continua no estado, marcado.
    expect(result.current).toMatchObject({ status: 'ready', updating: true });
    await waitFor(() => expect(result.current).toMatchObject({ updating: false }));
    const state = await settled('ready');
    expect(state.catalog.region).toBe('sa-east-1');
    expect(seen.sort()).toEqual(['sa-east-1/lambda.json', 'sa-east-1/s3.json']);
  });

  it('mudar a lista de serviços do design abre uma query nova', async () => {
    const seen = publish();
    const { rerender, result, client, settled } = render(design);
    await settled('ready');
    rerender({ design: withRds });
    await waitFor(() => expect(result.current).toMatchObject({ updating: false }));
    const state = await settled('ready');
    expect([...state.catalog.services.keys()].sort()).toEqual(['lambda', 'rds', 's3']);
    expect(seen.filter((path) => path === 'manifest.json')).toHaveLength(1);
    expect(seen).toContain(us('rds'));
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });

  it('o mesmo conjunto de serviços não busca de novo', async () => {
    const seen = publish();
    const { rerender, client, settled } = render(design);
    await settled('ready');
    const requests = seen.length;
    const more = [s3, { ...lambda, id: 'blk_other', label: 'Outra' }, lambda];
    rerender({ design: { ...design, blocks: more } });
    expect(await settled('ready')).toMatchObject({ updating: false });
    expect(seen).toHaveLength(requests);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  });

  it('design sem blocos não busca nada', async () => {
    const seen = publish();
    const { result, rerender, settled } = render({ ...design, blocks: [] });
    expect(result.current).toEqual({ status: 'idle' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual([]);
    // Bloco de tipo fora do contrato também não pede serviço.
    rerender({ design: { ...design, blocks: [{ ...lambda, type: 'aws.kinesis' }] } });
    expect(result.current).toEqual({ status: 'idle' });
    expect(seen).toEqual([]);
    // Ao ganhar um bloco, busca; ao perder todos, volta a `idle` sem mostrar o catálogo antigo.
    rerender({ design });
    await settled('ready');
    rerender({ design: { ...design, blocks: [] } });
    expect(result.current).toEqual({ status: 'idle' });
  });

  it('a query key leva só a região e os serviços em ordem, sem `Decimal`', async () => {
    publish();
    const { client, settled } = render({ ...design, blocks: [s3, lambda] });
    await settled('ready');
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys).toEqual([['pricing', 'catalog', 'us-east-1', ['lambda', 's3']]]);
    expect(keys).toEqual([priceCatalogKey('us-east-1', ['lambda', 's3'])]);
    // `JSON.stringify` lança com `bigint`: a key é só texto.
    expect(JSON.parse(JSON.stringify(keys))).toEqual(keys);
  });

  it.each<[string, CatalogErrorKind, Bytes | Response]>([
    ['ausente', 'missing', new HttpResponse(SERVER_TEXT, { status: 404 })],
    ['com hash errado', 'integrity', priceFile(us('lambda'), { prices: [], extra: SERVER_TEXT })],
  ])('arquivo %s chega como CatalogError `%s` no estado', async (_case, kind, served) => {
    publish({ [us('lambda')]: served });
    const { states, settled } = render(design);
    const state = await settled('error');
    expect(state.error).toBeInstanceOf(CatalogError);
    expect(state.error.kind).toBe(kind);
    expect(state.error.message).toBe(`Erro do catálogo de preços: ${kind}.`);
    expect(state.error.cause).toBeUndefined();
    expect(JSON.stringify(states)).not.toContain('onerror');
  });

  it('arquivo fora do schema chega como `invalid`', async () => {
    // Manifest com o hash de um arquivo que não passa no schema.
    const bad = encode({ schemaVersion: 1, service: 'lambda', region: 'us-east-1' });
    server.use(
      http.get(`${location.origin}/prices/manifest.json`, () =>
        HttpResponse.json({
          schemaVersion: 1,
          source: 'seed',
          generatedAt: GENERATED_AT,
          files: [{ path: us('lambda'), sha256: createHash('sha256').update(bad).digest('hex') }],
        }),
      ),
      http.get(`${location.origin}/prices/${us('lambda')}`, () => new HttpResponse(bad)),
    );
    expect((await render(design).settled('error')).error.kind).toBe('invalid');
  });

  it('erro de hash relê o manifest uma vez antes de virar erro', async () => {
    const seen = publish({ [us('lambda')]: priceFile(us('lambda'), { prices: [], other: 1 }) });
    await render(design).settled('error');
    expect(seen.filter((path) => path === 'manifest.json')).toHaveLength(2);
    expect(seen.filter((path) => path === us('lambda'))).toHaveLength(2);
  });

  it('erro de rede é repetido duas vezes e chega como `network`; `retry` tenta de novo', async () => {
    const seen = publish({ [us('s3')]: new HttpResponse(SERVER_TEXT, { status: 503 }) });
    const { settled } = render(design);
    const state = await settled('error');
    expect(state.error.kind).toBe('network');
    expect(seen.filter((path) => path === us('s3'))).toHaveLength(3);
    publish();
    state.retry();
    expect((await settled('ready')).catalog.services.has('s3')).toBe(true);
  });

  it('falha de conexão chega como `network`', async () => {
    server.use(http.all(`${location.origin}/prices/*`, () => HttpResponse.error()));
    expect((await render(design).settled('error')).error.kind).toBe('network');
  });

  it('não lança na renderização, mesmo com `throwOnError` ligado no QueryClient', async () => {
    publish({ 'manifest.json': encode({ schemaVersion: 2 }) });
    const { settled } = render(design, { throwOnError: true });
    expect((await settled('error')).error.kind).toBe('invalid');
  });

  it('erro que não é CatalogError vira `network`, sem o texto original', async () => {
    const load = () => Promise.reject(new Error(SERVER_TEXT));
    const state = await render(design, { retry: false }, load).settled('error');
    expect(state.error).toBeInstanceOf(CatalogError);
    expect(state.error.kind).toBe('network');
    expect(state.error.message).not.toContain('onerror');
  });
});
