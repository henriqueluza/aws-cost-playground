import { describe, expect, it } from 'vitest';
import type { Block, Usage } from './designDocument';
import { effectiveUsage } from './effectiveUsage';

type UsageSlot = Pick<Block, 'usage' | 'overrides'>;
// Bloco Lambda do ADR-0001, seção "Modelo de dados".
const adrUsage: Usage = {
  source: 'llm',
  estimatedAt: '2026-11-18T14:00:00Z',
  values: { requestsPerMonth: 3000000, avgDurationMs: 120 },
};

describe('effectiveUsage (ADR-0001)', () => {
  it('o override vence o valor do usage e as outras chaves ficam', () => {
    const result = effectiveUsage(adrUsage, { avgDurationMs: 80 });
    expect(result).toEqual({ requestsPerMonth: 3000000, avgDurationMs: 80 });
  });

  it('inclui a chave que só existe no override', () => {
    const result = effectiveUsage(adrUsage, { burstPerSecond: 50 });
    expect(result).toEqual({ requestsPerMonth: 3000000, avgDurationMs: 120, burstPerSecond: 50 });
  });

  it('sem override devolve os valores do usage em um objeto novo', () => {
    const result = effectiveUsage(adrUsage, {});
    expect(result).toEqual(adrUsage.values);
    expect(result).not.toBe(adrUsage.values);
  });

  it('re-estimativa troca o usage inteiro e preserva os overrides', () => {
    const old = { requestsPerMonth: 1000, avgDurationMs: 120, payloadKb: 4, burstPerSecond: 10 };
    const block: UsageSlot = {
      usage: { source: 'default', values: old },
      overrides: { avgDurationMs: 80, burstPerSecond: 50 },
    };
    const overridesBefore = structuredClone(block.overrides);
    const values = { requestsPerMonth: 9000000, avgDurationMs: 200, coldStartsPerMonth: 300 };
    const reEstimated: UsageSlot = { ...block, usage: { source: 'llm', values } };

    expect(reEstimated.overrides).toEqual(overridesBefore);
    const result = effectiveUsage(reEstimated.usage, reEstimated.overrides);
    expect(result).toEqual({ ...values, avgDurationMs: 80, burstPerSecond: 50 });
    expect(result).not.toHaveProperty('payloadKb');
  });

  it('não muta usage.values nem overrides, nem os expõe no resultado', () => {
    const usage = structuredClone(adrUsage);
    const overrides = { avgDurationMs: 80 };
    const [usageBefore, overridesBefore] = [structuredClone(usage), structuredClone(overrides)];
    const result = effectiveUsage(usage, overrides);
    result.avgDurationMs = 1;
    expect(usage).toEqual(usageBefore);
    expect(overrides).toEqual(overridesBefore);
  });
});
