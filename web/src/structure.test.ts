import { expect, it } from 'vitest';

const features = import.meta.glob<object>('./features/*/index.ts', { eager: true });
const adrFeatures = 'account auth compare designs editor export legal pricing workload'.split(' ');

it('cada feature do ADR tem index.ts que exporta seu componente', () => {
  const found = Object.keys(features).map((path) => path.split('/')[2]);
  expect(found).toEqual(expect.arrayContaining(adrFeatures));
  for (const mod of Object.values(features)) expect(Object.values(mod)).not.toHaveLength(0);
});
