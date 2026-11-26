import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import type { DesignDocument, Region } from '../../../shared/lib/design';
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

function renderPage(docs: DesignDocument[] = []) {
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
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
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
