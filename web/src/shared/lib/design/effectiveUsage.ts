import type { Overrides, Usage, UsageValues } from './designDocument';

/**
 * Uso efetivo de um bloco ou aresta (ADR-0001): o override vence o valor da LLM ou o padrão.
 * Uma re-estimativa troca `usage` inteiro e não toca em `overrides`, então o override sobrevive.
 */
export function effectiveUsage(usage: Usage, overrides: Overrides): UsageValues {
  return { ...usage.values, ...overrides };
}
