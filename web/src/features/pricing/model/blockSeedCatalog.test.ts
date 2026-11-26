// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONS, blockSchema, type Region } from '../../../shared/lib/design';
import type { AttributeDefinition, BlockCharge, BlockDefinition } from './blockContract';
import { blockPriceInput } from './blockInput';
import { BLOCKS, blockPricer } from './blockRegistry';
import { priceFileSchema } from './catalog';
import { blockService } from './engine';

/** Teto do produto cartesiano das opções; acima dele, varia um atributo por vez a partir dos padrões. */
const MAX_COMBINATIONS = 128;
const pricesDirectory = resolve(import.meta.dirname, '../../../../public/prices');

type Attributes = Record<string, string | number>;
type UsageValues = Record<string, number>;

const seeds = new Map<string, ReadonlySet<string> | undefined>();
/** SKUs de `public/prices/<região>/<serviço>.json`, validado pelo schema; `undefined` sem arquivo. */
function seedSkus(region: Region, service: string): ReadonlySet<string> | undefined {
  const key = `${region}/${service}`;
  if (!seeds.has(key)) {
    const path = resolve(pricesDirectory, `${key}.json`);
    const parsed = existsSync(path)
      ? priceFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      : undefined;
    expect(parsed?.error?.issues, `${key}.json fora do schema do catálogo`).toBeUndefined();
    const file = parsed?.data;
    expect(file && [file.region, file.service], key).toEqual(file && [region, service]);
    seeds.set(key, file && new Set(file.prices.map((price) => price.sku)));
  }
  return seeds.get(key);
}

/** Valores de um atributo: as opções e, se ele não tem padrão, também ausente. */
const valuesOf = ({ options, default: fallback }: AttributeDefinition) =>
  fallback === undefined ? [...options, undefined] : options;
const withValue = (attributes: Attributes, key: string, value: string | number | undefined) =>
  value === undefined ? attributes : { ...attributes, [key]: value };

function attributeCombinations(attributes: readonly AttributeDefinition[]): Attributes[] {
  const total = attributes.reduce((count, attribute) => count * valuesOf(attribute).length, 1);
  if (total > MAX_COMBINATIONS) {
    return [{}, ...attributes.flatMap((a) => valuesOf(a).map((v) => withValue({}, a.key, v)))];
  }
  return attributes.reduce<Attributes[]>(
    (combinations, a) =>
      combinations.flatMap((combination) =>
        valuesOf(a).map((v) => withValue(combination, a.key, v)),
      ),
    [{}],
  );
}

/** Uso ausente (o padrão do contrato), tudo no mínimo, tudo no máximo e cada chave no máximo. */
function usageScenarios({ usage }: BlockDefinition): UsageValues[] {
  const all = (bound: 'min' | 'max') =>
    Object.fromEntries(usage.map((key) => [key.key, key[bound]]));
  return [{}, all('min'), all('max'), ...usage.map((key) => ({ [key.key]: key.max }))];
}

const designBlock = (type: string, attributes: Attributes, values: UsageValues) =>
  blockSchema.parse({
    id: 'blk_seed',
    type,
    label: '',
    attributes,
    usage: { source: 'default', values },
    overrides: {},
  });

describe.each(REGIONS)('catálogo semente de %s', (region) => {
  it.each(BLOCKS)('$type só cobra SKUs da semente, com quantidade não negativa', (definition) => {
    const { type } = definition;
    const pricer = blockPricer(type);
    expect(pricer, type).toBeTypeOf('function');
    for (const attributes of attributeCombinations(definition.attributes)) {
      for (const values of usageScenarios(definition)) {
        const where = `${type} em ${region}, atributos ${JSON.stringify(attributes)}, uso ${JSON.stringify(values)}`;
        const input = blockPriceInput(definition, designBlock(type, attributes, values));
        expect(input, where).toBeDefined();
        let charges: readonly BlockCharge[] = [];
        expect(() => (charges = pricer!(input!)), where).not.toThrow();
        for (const { sku, quantity, service = blockService(type) } of charges) {
          const at = `${where}: SKU ${sku} (${region}/${service}.json)`;
          expect(seedSkus(region, service)?.has(sku), `${at} não está na semente`).toBe(true);
          expect(quantity >= 0n, `${at} com quantidade negativa`).toBe(true);
        }
      }
    }
  });
});
