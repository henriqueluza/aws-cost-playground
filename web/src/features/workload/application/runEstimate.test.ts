import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../../../shared/lib/api';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import type { UsageContract } from '../model/estimateModel';
import { runEstimate } from './runEstimate';

const doc = designDocumentSchema.parse(adrExampleDesign);
const contract: UsageContract = {
  block: () => [{ key: 'storageGb', min: 0, max: 1e6, integer: false }],
  edge: () => undefined,
};
const quota = { limit: 20, remaining: 11, resetsAt: '2026-11-27T00:00:00.000Z' };
const answer = (blocks: unknown[]) => ({ blocks, edges: [], quota });

function setup(estimateUsage: () => Promise<unknown>, alive = () => true) {
  let current: DesignDocument = doc;
  const commit = vi.fn((next: DesignDocument) => ((current = next), true));
  const api = { estimates: { estimateUsage: vi.fn(estimateUsage) } } as unknown as Api;
  const run = () =>
    runEstimate({
      api,
      document: { current: () => current, commit },
      contract,
      now: () => '2026-11-26T12:00:00.000Z',
      active: alive,
    });
  return { run, commit, api, change: (d: DesignDocument) => (current = d) };
}

describe('runEstimate', () => {
  it('aplica a resposta num único commit e devolve a quota e a impressão digital', async () => {
    const t = setup(async () =>
      answer([{ id: 'blk_assets', source: 'llm', values: { storageGb: 9 } }]),
    );
    const out = await t.run();
    expect(out).toMatchObject({ status: 'applied', blocks: 1, edges: 0, quota });
    expect(t.commit).toHaveBeenCalledTimes(1);
  });

  it('diagrama que mudou em voo: aplica só ao que ainda existe e a estimativa nasce desatualizada', async () => {
    const t: ReturnType<typeof setup> = setup(async () => {
      t.change({ ...doc, blocks: doc.blocks.filter((b) => b.id !== 'blk_assets'), edges: [] });
      return answer([
        { id: 'blk_assets', source: 'llm', values: { storageGb: 9 } },
        { id: 'blk_fn_api', source: 'llm', values: { storageGb: 2 } },
      ]);
    });
    const out = await t.run();
    expect(out).toMatchObject({ status: 'applied', blocks: 1 });
    const written = t.commit.mock.calls[0]?.[0];
    expect(written?.blocks.map((b) => b.id)).toEqual(['blk_fn_api']);
    const { estimateFingerprint } = await import('../model/estimateModel');
    if (out.status === 'applied') expect(out.fingerprint).toBe(estimateFingerprint(doc));
  });

  it('nada utilizável: não grava', async () => {
    const t = setup(async () => answer([{ id: 'blk_assets', source: 'llm', values: { x: 1 } }]));
    expect(await t.run()).toMatchObject({ status: 'applied', blocks: 0 });
    expect(t.commit).not.toHaveBeenCalled();
  });

  it('desmontada antes da resposta: não grava', async () => {
    const t = setup(
      async () => answer([{ id: 'blk_assets', source: 'llm', values: { storageGb: 9 } }]),
      () => false,
    );
    expect(await t.run()).toEqual({ status: 'cancelled' });
    expect(t.commit).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'unauthenticated' }, 'sign-in'],
    [{ kind: 'quota-exhausted', scope: 'user', resetsAt: quota.resetsAt }, 'quota-user'],
    [{ kind: 'quota-exhausted', scope: 'global', resetsAt: quota.resetsAt }, 'quota-global'],
    [{ kind: 'unavailable' }, 'unavailable'],
    [{ kind: 'network' }, 'network'],
    [{ kind: 'too-large' }, 'too-large'],
    [{ kind: 'invalid-response' }, 'unusable'],
  ] as const)('erro %j vira %s e o documento fica intacto', async (detail, kind) => {
    const t = setup(() => Promise.reject(new ApiError(detail)));
    expect(await t.run()).toMatchObject({ status: 'failed', failure: { kind } });
    expect(t.commit).not.toHaveBeenCalled();
  });

  it('o commit recusado vira unusable', async () => {
    const t = setup(async () =>
      answer([{ id: 'blk_assets', source: 'llm', values: { storageGb: 9 } }]),
    );
    t.commit.mockReturnValueOnce(false);
    expect(await t.run()).toEqual({ status: 'failed', failure: { kind: 'unusable' } });
  });

  it('desmontada antes do erro: cancelada, sem falha mostrada', async () => {
    const t = setup(
      () => Promise.reject(new ApiError({ kind: 'unavailable' })),
      () => false,
    );
    expect(await t.run()).toEqual({ status: 'cancelled' });
  });

  it('erro que não é da API vira unusable', async () => {
    const t = setup(() => Promise.reject(new Error('<img onerror=x>')));
    expect(await t.run()).toEqual({ status: 'failed', failure: { kind: 'unusable' } });
  });
});
