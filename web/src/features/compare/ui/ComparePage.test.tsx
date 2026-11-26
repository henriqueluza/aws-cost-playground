import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../shared/lib/api/ApiProvider';
import { createInMemoryApi } from '../../../shared/lib/api/inMemoryApi';
import { ApiError, type Api, type ApiErrorKind } from '../../../shared/lib/api';
import { fakeAuth } from '../../../test/authFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import type { DesignDocument, Region } from '../../../shared/lib/design';
import { AuthProvider } from '../../auth';
import { designStore } from '../../editor';
import {
  catalogServices,
  priceCatalogKey,
  priceFileSchema,
  type PriceCatalog,
} from '../../pricing';
import { ComparePage } from './ComparePage';

const root = resolve(import.meta.dirname, '../../../../..');
const scenario = (name: string): DesignDocument =>
  JSON.parse(readFileSync(resolve(root, `contracts/scenarios/${name}.json`), 'utf8'));

/** As sementes versionadas da região, como o motor as recebe (preços reais do repositório). */
function seedOf(region: Region): PriceCatalog {
  const directory = resolve(root, `web/public/prices/${region}`);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) =>
      priceFileSchema.parse(JSON.parse(readFileSync(resolve(directory, name), 'utf8'))),
    );
  return {
    region,
    manifest: { schemaVersion: 1, source: 'seed', generatedAt: '2026-11-23T12:00:00Z', files: [] },
    services: new Map(files.map((file) => [file.service, file])),
  };
}

const newApi = (): Api =>
  createInMemoryApi({
    maxDesigns: 5,
    maxDocBytes: 350_000,
    userDailyLimit: 5,
    globalDailyLimit: 5,
  });
const SIGNED_IN = {
  status: 'authenticated',
  user: { sub: 'usuario-de-teste', email: null },
} as const;

function renderPage(docs: DesignDocument[] = [], api: Api = newApi(), signedIn = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const doc of [designStore.getState().document, ...docs]) {
    client.setQueryData(priceCatalogKey(doc.region, catalogServices(doc)), seedOf(doc.region));
  }
  const router = createMemoryRouter(
    [
      { path: '/comparar', Component: ComparePage },
      { path: '/', element: <p>Editor</p> },
    ],
    { initialEntries: ['/comparar'] },
  );
  const auth = fakeAuth(signedIn ? SIGNED_IN : { status: 'anonymous' });
  return render(
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>
        <AuthProvider service={auth.service}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
}

const file = (doc: unknown, name = 'cenario.json') =>
  new File([typeof doc === 'string' ? doc : JSON.stringify(doc)], name, {
    type: 'application/json',
  });
const pickB = (f: File) =>
  userEvent.upload(screen.getByLabelText('Arquivo JSON do design B'), f, { applyAccept: false });
const group = (name: string) => screen.getByRole('group', { name });

const initialState = designStore.getState();

afterEach(() => {
  vi.unstubAllGlobals();
  designStore.setState(initialState);
});

describe('ComparePage (anônimo: design em edição × arquivo, sem API)', () => {
  it('compara o template com app-classico: totais de referência e diferença com sinal e palavra', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const app = scenario('app-classico');
    renderPage([app]);
    expect(screen.getByText('Escolha o design B')).toBeInTheDocument();

    await pickB(file(app));

    const total = group('Total por mês');
    expect(total).toHaveTextContent('A US$ 131,28');
    expect(total).toHaveTextContent('B US$ 333,65');
    expect(total).toHaveTextContent('+US$ 202,37');
    expect(total).toHaveTextContent('a mais');
    expect(group('Fixo')).toHaveTextContent('a mais');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('compara o template com api-serverless: B custa menos, e diz "a menos" com sinal −', async () => {
    const api = scenario('api-serverless');
    renderPage([api]);
    await pickB(file(api));
    const total = group('Total por mês');
    expect(total).toHaveTextContent('B US$ 29,67');
    expect(total).toHaveTextContent('−US$ 101,61');
    expect(total).toHaveTextContent('a menos');
    expect(screen.getByRole('table', { name: /Custo mensal por tipo de bloco/ })).toBeVisible();
  });

  it('designs iguais: diferença zero, "igual" e nenhum aviso', async () => {
    const same = designStore.getState().document;
    renderPage();
    await pickB(file(same));
    expect(group('Total por mês')).toHaveTextContent('US$ 0,00');
    expect(group('Total por mês')).toHaveTextContent('igual');
    expect(screen.queryByText(/Buscando os preços/)).toBeNull();
    expect(screen.queryByText(/regiões diferentes/)).toBeNull();
    expect(screen.queryByText(/descrições de carga/)).toBeNull();
  });

  it('avisa de região e de carga diferentes, e calcula cada lado com a sua região', async () => {
    const api = { ...scenario('api-serverless'), region: 'sa-east-1' } as DesignDocument;
    renderPage([api]);
    await pickB(file(api));
    expect(screen.getByText(/regiões diferentes/)).toBeInTheDocument();
    expect(
      screen.getByText(/descrições de carga dos dois designs são diferentes/),
    ).toBeInTheDocument();
    expect(screen.getByText('sa-east-1')).toBeInTheDocument();
  });

  it('descrições que só diferem em espaços não geram aviso de carga', async () => {
    const base = designStore.getState().document;
    const spaced = {
      ...base,
      workload: { description: `  ${base.workload.description.replace(/ /g, '  ')}\n` },
    };
    renderPage();
    await pickB(file(spaced));
    expect(screen.queryByText(/descrições de carga/)).toBeNull();
  });

  it('arquivo inválido: mesma validação de abrir design, texto próprio e nada comparado', async () => {
    renderPage();
    await pickB(file('{ não é json'));
    expect(await screen.findByRole('alert')).toHaveTextContent('não é um JSON válido');
    await pickB(file({ foo: 1 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não é um design deste produto');
    expect(screen.queryByRole('table')).toBeNull();
    const big = file(JSON.stringify({ pad: 'x'.repeat(360 * 1024) }));
    await pickB(big);
    expect(await screen.findByRole('alert')).toHaveTextContent('passa de 350 KB');
  });

  it('rótulos do arquivo entram só como texto, nunca como HTML', async () => {
    const doc = scenario('api-serverless');
    const evil = {
      ...doc,
      blocks: doc.blocks.map((b, i) =>
        i === 0 ? { ...b, label: '<img src=x onerror=alert(1)>' } : b,
      ),
    };
    const { container } = renderPage([evil]);
    await pickB(file(evil, '<b>nome</b>.json'));
    expect(container.querySelector('img, b')).toBeNull();
    expect(screen.getByText('<b>nome</b>.json')).toBeInTheDocument();
  });

  it('só lê: a store do editor não muda', async () => {
    const before = designStore.getState();
    const api = scenario('api-serverless');
    renderPage([api]);
    await pickB(file(api));
    expect(designStore.getState()).toBe(before);
  });

  it('erro de preços de um lado: texto próprio e "Tentar de novo", sem tabela', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const api = { ...scenario('api-serverless'), region: 'sa-east-1' } as DesignDocument;
    // Só o lado A tem catálogo no cache; o lado B (sa-east-1) busca e falha.
    renderPage();
    await pickB(file(api));
    expect(await screen.findByText('Sem preços de sa-east-1 neste momento.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('carregando os preços de um lado: texto no lado, sem tabela, até o catálogo chegar', async () => {
    let release = (): void => {};
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending));
    const api = { ...scenario('api-serverless'), region: 'sa-east-1' } as DesignDocument;
    renderPage();
    await pickB(file(api));
    expect(await screen.findByText('Buscando os preços de sa-east-1…')).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.queryByRole('table')).toBeNull();
    release(); // o catálogo em andamento é compartilhado pelo módulo: não deixa pendente para o próximo teste
    await screen.findByText('Sem preços de sa-east-1 neste momento.');
  });

  it('erro de preços no lado A: texto próprio por código e nova tentativa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    renderPage([scenario('api-serverless')]);
    await pickB(file(scenario('api-serverless')));
    act(() => void designStore.getState().setRegion('sa-east-1')); // o catálogo do A não está no cache
    expect(await screen.findByText('Sem preços de sa-east-1 neste momento.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('não tem violações de acessibilidade', async () => {
    const api = scenario('api-serverless');
    const { container } = renderPage([api]);
    await pickB(file(api));
    await expectNoAxeViolations(container);
  });
});

describe('ComparePage com designs salvos (sessão)', () => {
  /** Uma API com os designs já salvos na conta; devolve também os ids na ordem dada. */
  async function savedApi(...docs: [string, DesignDocument][]) {
    const api = newApi();
    const ids: string[] = [];
    for (const [name, doc] of docs) ids.push((await api.designs.create({ name, doc })).id);
    return { api, ids };
  }
  const origin = (side: 'A' | 'B', option: string) =>
    userEvent.selectOptions(screen.getByLabelText(`Origem do design ${side}`), option);
  const pickSaved = (side: 'A' | 'B', id: string) =>
    userEvent.selectOptions(screen.getByLabelText(`Design salvo ${side}`), id);
  const failWith = (api: Api, kind: ApiErrorKind, method: 'list' | 'get') =>
    vi.spyOn(api.designs, method).mockRejectedValue(new ApiError({ kind } as never));

  it('escolhe dois designs salvos, com a região de cada um e o nome só como texto', async () => {
    const [app, serverless] = [scenario('app-classico'), scenario('api-serverless')];
    const { api, ids } = await savedApi(['<b>App</b>', app], ['Serverless', serverless]);
    const { container } = renderPage([app, serverless], api, true);
    await origin('A', 'saved');
    expect(screen.getByRole('option', { name: '<b>App</b> (us-east-1)' })).toBeInTheDocument();
    await pickSaved('A', ids[0]!);
    await origin('B', 'saved');
    await pickSaved('B', ids[1]!);
    const total = group('Total por mês');
    expect(total).toHaveTextContent('A US$ 333,65');
    expect(total).toHaveTextContent('B US$ 29,67');
    expect(total).toHaveTextContent('−US$ 303,98');
    expect(container.querySelector('b')).toBeNull();
  });

  it('mistura as origens: o design em edição (A) contra um salvo (B)', async () => {
    const app = scenario('app-classico');
    const before = designStore.getState();
    const { api, ids } = await savedApi(['App', app]);
    renderPage([app], api, true);
    await origin('B', 'saved');
    await pickSaved('B', ids[0]!);
    expect(group('Total por mês')).toHaveTextContent('+US$ 202,37');
    expect(designStore.getState()).toBe(before);
  });

  it('o anônimo não vê a opção de salvos e não chama a API', async () => {
    const api = newApi();
    const calls = (Object.keys(api.designs) as (keyof Api['designs'])[]).map((m) =>
      vi.spyOn(api.designs, m),
    );
    renderPage([], api);
    expect(screen.queryByRole('option', { name: 'Salvo na conta' })).toBeNull();
    await pickB(file(designStore.getState().document));
    expect(calls.every((call) => call.mock.calls.length === 0)).toBe(true);
  });

  it('lista vazia: diz o que fazer', async () => {
    renderPage([], newApi(), true);
    await origin('B', 'saved');
    expect(await screen.findByText(/ainda não salvou nenhum design/)).toBeInTheDocument();
    expect(screen.getByText('Escolha o design B')).toBeInTheDocument();
  });

  it('erro da lista: texto próprio por código e nova tentativa só quando vale', async () => {
    const api = newApi();
    const list = failWith(api, 'network', 'list');
    renderPage([], api, true);
    await origin('B', 'saved');
    expect(await screen.findByText(/Sem conexão com o serviço/)).toBeInTheDocument();
    list.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/ainda não salvou/)).toBeInTheDocument();
    failWith(api, 'unauthenticated', 'list');
    await origin('B', 'file');
    await origin('B', 'saved');
    expect(await screen.findByText(/Entre na sua conta/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });

  it('erro ao buscar o design: texto próprio por código, sem tabela', async () => {
    const app = scenario('app-classico');
    const { api, ids } = await savedApi(['App', app]);
    failWith(api, 'not-found', 'get');
    renderPage([app], api, true);
    await origin('B', 'saved');
    await pickSaved('B', ids[0]!);
    expect(await screen.findByText('Este design não existe mais na sua conta.')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('documento inválido vindo do servidor é recusado antes de calcular', async () => {
    const app = scenario('app-classico');
    const { api, ids } = await savedApi(['App', app]);
    const get = api.designs.get;
    vi.spyOn(api.designs, 'get').mockImplementation(async (id) => ({
      ...(await get(id)),
      doc: { ...app, blocks: [{ id: 1 }] } as never,
    }));
    renderPage([app], api, true);
    await origin('B', 'saved');
    await pickSaved('B', ids[0]!);
    expect(await screen.findByText(/devolveu um design que não conseguimos abrir/)).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
