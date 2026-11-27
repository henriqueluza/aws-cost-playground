// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DAILY_LIMIT } from '../../../../e2e/support/mockBackend';
import { createInMemoryApi } from './inMemoryApi';
import { QUOTA_LIMITS } from './quotaLimits';

describe('QUOTA_LIMITS', () => {
  it('são os padrões da API: 5 por usuário e 30 globais por dia', () => {
    expect(QUOTA_LIMITS).toEqual({ userDailyLimit: 5, globalDailyLimit: 30 });
  });

  it('o backend simulado do e2e usa o mesmo limite por usuário', () => {
    expect(DAILY_LIMIT).toBe(QUOTA_LIMITS.userDailyLimit);
  });

  it('o fake com esses limites mostra 5 de 5 e para na sexta estimativa do dia', async () => {
    const api = createInMemoryApi({ ...QUOTA_LIMITS, maxDesigns: 1, maxDocBytes: 1 });
    const request = {
      region: 'us-east-1' as const,
      description: 'x',
      blocks: [{ id: 'blk_fn', type: 'aws.lambda', attributes: {} }],
      edges: [],
    };
    expect(await api.quota.get()).toMatchObject({ limit: 5, remaining: 5 });
    for (let used = 1; used <= 5; used += 1) {
      const { quota } = await api.estimates.estimateUsage(request);
      expect(quota.remaining).toBe(5 - used);
    }
    await expect(api.estimates.estimateUsage(request)).rejects.toMatchObject({
      detail: { kind: 'quota-exhausted', scope: 'user' },
    });
  });
});
