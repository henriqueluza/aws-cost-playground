import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type ApiErrorDetail } from '../../../shared/lib/api';
import { ApiProvider } from '../../../shared/lib/api/ApiProvider';
import { createInMemoryApi } from '../../../shared/lib/api/inMemoryApi';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { expectNoAxeViolations } from '../../../test/axe';
import { fakeAuth } from '../../../test/authFixtures';
import { adrExampleDesign } from '../../../test/designFixtures';
import { AuthProvider } from '../../auth';
import { EMPTY_STATE, designStore } from '../../editor';
import { WorkloadPanel } from './WorkloadPanel';

const doc = designDocumentSchema.parse(adrExampleDesign);
const state = (document: DesignDocument) =>
  designStore.setState({ ...EMPTY_STATE, document, history: { past: [], future: [] } });
const LLM = {
  blocks: [{ id: 'blk_assets', source: 'llm' as const, values: { storageGb: 80 } }],
  edges: [],
};

function setup(opts: { signedIn?: boolean; estimate?: Api['estimates']['estimateUsage'] } = {}) {
  const base = createInMemoryApi({
    maxDesigns: 5,
    maxDocBytes: 350_000,
    userDailyLimit: 20,
    globalDailyLimit: 300,
    estimate: () => LLM,
  });
  const api: Api = {
    ...base,
    estimates: { estimateUsage: vi.fn(opts.estimate ?? base.estimates.estimateUsage) },
    quota: { get: vi.fn(base.quota.get) },
  };
  const auth = fakeAuth(
    opts.signedIn === false
      ? { status: 'anonymous' }
      : { status: 'authenticated', user: { sub: 'u1', email: null } },
  );
  const view = render(
    <ApiProvider api={api}>
      <AuthProvider service={auth.service}>
        <WorkloadPanel />
      </AuthProvider>
    </ApiProvider>,
  );
  return { api, auth, ...view };
}
const failWith = (detail: ApiErrorDetail) => () => Promise.reject(new ApiError(detail));
const button = () => screen.getByRole('button', { name: /Re-estimar carga|Estimando/ });
const assets = () => designStore.getState().document.blocks.find((b) => b.id === 'blk_assets');

beforeEach(() => state(doc));
afterEach(() => state(EMPTY_STATE.document));

describe('WorkloadPanel: anônimo', () => {
  it('mostra o convite, não oferece estimar e não faz nenhuma chamada', async () => {
    const { api, auth, container } = setup({ signedIn: false });
    expect(screen.getByText(/Entre na sua conta para estimar/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-estimar/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(auth.service.signIn).toHaveBeenCalledTimes(1);
    expect(api.estimates.estimateUsage).not.toHaveBeenCalled();
    expect(api.quota.get).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('falha ao abrir o login vira frase própria', async () => {
    const { auth } = setup({ signedIn: false });
    auth.service.signIn.mockRejectedValueOnce(new Error('<b>x</b>'));
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText(/Não foi possível abrir o login/)).toBeInTheDocument();
  });

  it('a descrição continua editável e entra no design', () => {
    setup({ signedIn: false });
    fireEvent.change(screen.getByLabelText('Descrição da carga'), {
      target: { value: 'Carga nova' },
    });
    expect(designStore.getState().document.workload.description).toBe('Carga nova');
  });
});

describe('WorkloadPanel: descrição e contador', () => {
  it('conta os caracteres, limita a 2.000 e só anuncia nos marcos', () => {
    setup();
    const field = screen.getByLabelText('Descrição da carga');
    expect(field).toHaveAttribute('maxlength', '2000');
    const live = () => screen.getAllByRole('status')[0];
    fireEvent.change(field, { target: { value: 'x'.repeat(1799) } });
    expect(live()).toHaveTextContent('');
    fireEvent.change(field, { target: { value: 'x'.repeat(1800) } });
    expect(live()).toHaveTextContent('Restam 200 caracteres.');
    fireEvent.change(field, { target: { value: 'x'.repeat(1850) } });
    expect(live()).toHaveTextContent('Restam 200 caracteres.'); // não muda a cada tecla
    fireEvent.change(field, { target: { value: 'x'.repeat(2000) } });
    expect(live()).toHaveTextContent('Limite de 2.000 caracteres atingido.');
    expect(screen.getByText('2.000 / 2.000')).toBeInTheDocument();
  });

  it('sem blocos ou sem descrição o botão diz por quê e não estima', async () => {
    const { api } = setup();
    state({ ...doc, workload: { description: '  ' } });
    expect(await screen.findByText('Descreva a carga para estimar.')).toBeInTheDocument();
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button());
    state({ ...doc, blocks: [], edges: [] });
    expect(await screen.findByText(/Adicione blocos/)).toBeInTheDocument();
    expect(api.estimates.estimateUsage).not.toHaveBeenCalled();
  });
});

describe('WorkloadPanel: estimar', () => {
  it('mostra a quota ao abrir, carrega, aplica o uso, preserva o override e mostra o restante', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { container } = setup({
      estimate: async () => (
        await gate,
        { ...LLM, quota: { limit: 20, remaining: 18, resetsAt: '2026-11-27T00:00:00.000Z' } }
      ),
    });
    expect(await screen.findByText('Restam 20 de 20 hoje')).toBeInTheDocument();
    await userEvent.click(button());
    expect(button()).toHaveTextContent('Estimando…');
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    release();
    expect(
      await screen.findByText('Estimativa aplicada: 1 bloco e 0 conexões.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Restam 18 de 20 hoje')).toBeInTheDocument();
    expect(assets()?.usage).toMatchObject({ source: 'llm', values: { storageGb: 80 } });
    expect(designStore.getState().document.blocks[0]?.overrides).toEqual({ avgDurationMs: 80 });
    expect(designStore.getState().history.past).toHaveLength(1); // um passo desfazível
    await expectNoAxeViolations(container);
  });

  it('clique duplo com a chamada em voo manda uma só', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api } = setup({
      estimate: async () => (
        await gate,
        { ...LLM, quota: { limit: 20, remaining: 1, resetsAt: '2026-11-27T00:00:00.000Z' } }
      ),
    });
    await userEvent.dblClick(button());
    release();
    await screen.findByText(/Estimativa aplicada/);
    expect(api.estimates.estimateUsage).toHaveBeenCalledTimes(1);
  });

  it('mudar o diagrama ou a descrição depois marca como desatualizada; rótulo e override não', async () => {
    setup();
    await userEvent.click(button());
    await screen.findByText(/Estimativa aplicada/);
    expect(screen.queryByText('Estimativa desatualizada')).toBeNull();
    act(() => void designStore.getState().editBlock('blk_assets', { label: 'Outro' }));
    act(
      () =>
        void designStore
          .getState()
          .setOverride({ kind: 'block', id: 'blk_assets' }, 'storageGb', 3),
    );
    expect(screen.queryByText('Estimativa desatualizada')).toBeNull();
    fireEvent.change(screen.getByLabelText('Descrição da carga'), {
      target: { value: 'Mais tráfego' },
    });
    expect(screen.getByText('Estimativa desatualizada')).toBeInTheDocument();
  });

  it('desmontar com a chamada em voo não grava nada', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { unmount, api } = setup({
      estimate: async () => (
        await gate,
        { ...LLM, quota: { limit: 20, remaining: 1, resetsAt: '2026-11-27T00:00:00.000Z' } }
      ),
    });
    await userEvent.click(button());
    unmount();
    release();
    await waitFor(() => expect(api.estimates.estimateUsage).toHaveBeenCalled());
    await act(async () => void (await gate));
    expect(assets()?.usage.source).toBe('default');
  });
});

describe('WorkloadPanel: erros', () => {
  const reset = '2026-11-27T00:00:00.000Z';
  it.each([
    [
      { kind: 'quota-exhausted', scope: 'user', resetsAt: reset } as const,
      /Você usou as estimativas de hoje\. Elas voltam às/,
    ],
    [
      { kind: 'quota-exhausted', scope: 'global', resetsAt: reset } as const,
      /O limite diário do serviço acabou; volta amanhã/,
    ],
  ])('429 %j: frase própria e botão travado, diagrama intacto', async (detail, text) => {
    const { api } = setup({ estimate: failWith(detail) });
    await userEvent.click(button());
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button());
    expect(api.estimates.estimateUsage).toHaveBeenCalledTimes(1);
    expect(designStore.getState().document).toEqual(doc);
  });

  it.each([
    ['unavailable', /indisponível\. Tente mais tarde/],
    ['network', /Sem conexão/],
    ['too-large', /grande demais/],
    ['invalid-response', /Não foi possível usar a resposta/],
  ] as const)('%s: frase própria, diagrama intacto, quota relida', async (kind, text) => {
    const { api } = setup({ estimate: failWith({ kind }) });
    await userEvent.click(button());
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(designStore.getState().document).toEqual(doc);
    expect(api.quota.get).toHaveBeenCalledTimes(2); // ao abrir e depois da falha
    expect(button()).toHaveAttribute('aria-disabled', 'false');
  });

  it('unauthenticated no meio do caminho vira o convite para entrar', async () => {
    setup({ estimate: failWith({ kind: 'unauthenticated' }) });
    await userEvent.click(button());
    const invite = await screen.findByText(/Entre na sua conta para estimar/);
    expect(
      within(invite.closest('div')!.parentElement!).getByRole('button', { name: 'Entrar' }),
    ).toBeInTheDocument();
  });
});
