import { describe, expect, it } from 'vitest';
import { REGIONS } from '../../../shared/lib/design';
import { decimal, toFixed } from '../../../shared/lib/money';
import { CATALOG_LIMITS, priceFileSchema, priceManifestSchema, type PriceCatalog } from '..';

const { maxPricesPerFile, maxTiersPerPrice, maxFilesInManifest } = CATALOG_LIMITS;
const { maxDescriptionLength, maxUnitLength } = CATALOG_LIMITS;
const sha = 'a'.repeat(64);
const requests = {
  sku: 'AWS-Lambda-Requests',
  description: 'Requisições',
  unit: 'Requests',
  tiers: [{ upTo: null, unitPrice: '0.0000002' }],
  freeTier: { quantity: '1000000', pool: 'lambda-requests' },
};
const duration = {
  sku: 'AWS-Lambda-Duration',
  description: 'Duração (x86)',
  unit: 'GB-Second',
  tiers: [
    { upTo: '6000000000', unitPrice: '0.0000166667' },
    { upTo: '15000000000', unitPrice: '0.000015' },
    { upTo: null, unitPrice: '0.0000133334' },
  ],
  minimumQuantity: '0.001',
};
const lambdaFile = {
  schemaVersion: 1,
  service: 'lambda',
  region: 'us-east-1',
  currency: 'USD',
  prices: [requests, duration],
};
const manifest = {
  schemaVersion: 1,
  source: 'seed',
  generatedAt: '2026-11-23T12:00:00Z',
  files: [
    { path: 'us-east-1/lambda.json', sha256: sha },
    { path: 'sa-east-1/lambda.json', sha256: sha },
  ],
};

const fileWith = (patch: object) => ({ ...lambdaFile, ...patch });
const priceWith = (patch: object) => fileWith({ prices: [{ ...duration, ...patch }] });
const tiersOf = (...upTos: (string | null)[]) =>
  priceWith({ tiers: upTos.map((upTo) => ({ upTo, unitPrice: '1' })) });
const manifestWith = (patch: object) => ({ ...manifest, ...patch });
const manifestFile = (patch: object) =>
  manifestWith({ files: [{ ...manifest.files[0], ...patch }] });
const accepts = (schema: typeof priceFileSchema | typeof priceManifestSchema, input: unknown) =>
  schema.safeParse(input).success;
const messages = (input: unknown) =>
  priceFileSchema.safeParse(input).error?.issues.map((issue) => issue.message);
const skus = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ ...requests, sku: `sku-${i}` }));
const ascending = (count: number) => [
  ...Array.from({ length: count - 1 }, (_, i) => String(i + 1)),
  null,
];

describe('priceFileSchema', () => {
  it('lê preços e quantidades como Decimal exato', () => {
    const file = priceFileSchema.parse(structuredClone(lambdaFile));
    const [first, second] = file.prices;
    expect(first?.tiers[0]?.unitPrice).toBe(decimal('0.0000002'));
    expect(first?.freeTier).toEqual({ quantity: decimal(1_000_000), pool: 'lambda-requests' });
    expect(second?.tiers.map((tier) => tier.upTo)).toEqual([decimal(6e9), decimal(15e9), null]);
    expect(second?.minimumQuantity).toBe(decimal('0.001'));
    expect(file).toMatchObject({ service: 'lambda', region: 'us-east-1', currency: 'USD' });
  });

  it('não arredonda: 12 casas e 15 dígitos inteiros passam inteiros', () => {
    const text = '123456789012345.123456789012';
    const file = priceFileSchema.parse(priceWith({ minimumQuantity: text }));
    expect(toFixed(file.prices[0]!.minimumQuantity!, 12)).toBe(text);
  });

  it.each(REGIONS)('aceita a região %s', (region) => {
    expect(accepts(priceFileSchema, fileWith({ region }))).toBe(true);
  });

  it.each([
    ['sem preços', fileWith({ prices: [] })],
    ['preços no limite', fileWith({ prices: skus(maxPricesPerFile) })],
    ['faixas no limite', tiersOf(...ascending(maxTiersPerPrice))],
    ['preço zero', priceWith({ tiers: [{ upTo: null, unitPrice: '0' }] })],
    ['free tier sem pool', priceWith({ freeTier: { quantity: '5' } })],
    ['descrição no limite', priceWith({ description: 'a'.repeat(maxDescriptionLength) })],
    ['unidade no limite', priceWith({ unit: 'a'.repeat(maxUnitLength) })],
  ])('aceita %s', (_, input) => {
    expect(accepts(priceFileSchema, input)).toBe(true);
  });

  it('descarta chave desconhecida (leitura tolerante)', () => {
    const file = priceFileSchema.parse(fileWith({ futureField: 1 }));
    expect(file).not.toHaveProperty('futureField');
  });

  const badDecimals = [
    ['13 casas', '0.0000000000001'],
    ['13 casas que arredondariam', '0.0000166666665'],
    ['notação exponencial', '1e-7'],
    ['expoente maiúsculo', '2E3'],
    ['16 dígitos inteiros', '1234567890123456'],
    ['sinal negativo', '-1'],
    ['sinal positivo', '+1'],
    ['sem parte inteira', '.5'],
    ['sem parte decimal', '1.'],
    ['vírgula', '0,5'],
    ['separador de milhar', '1,000.00'],
    ['espaço', ' 1'],
    ['quebra de linha no fim', '1\n'],
    ['hexadecimal', '0x10'],
    ['texto', 'NaN'],
    ['vazio', ''],
    ['número JSON', 0.0000002],
    ['nulo', null],
  ] as const;

  it.each(badDecimals)('recusa preço unitário com %s', (_, unitPrice) => {
    expect(accepts(priceFileSchema, priceWith({ tiers: [{ upTo: null, unitPrice }] }))).toBe(false);
  });

  it.each(badDecimals.filter(([, value]) => value !== null))(
    'recusa quantidade com %s (upTo, free tier e mínimo)',
    (_, quantity) => {
      expect(accepts(priceFileSchema, tiersOf(quantity as string, null))).toBe(false);
      expect(accepts(priceFileSchema, priceWith({ freeTier: { quantity } }))).toBe(false);
      expect(accepts(priceFileSchema, priceWith({ minimumQuantity: quantity }))).toBe(false);
    },
  );

  it.each([
    ['lista vazia', tiersOf(), undefined],
    ['fora de ordem', tiersOf('10', '5', null), 'Faixas fora de ordem crescente.'],
    ['limite repetido', tiersOf('10', '10', null), 'Faixas fora de ordem crescente.'],
    ['limite zero', tiersOf('0', null), 'Faixas fora de ordem crescente.'],
    ['upTo null fora da última', tiersOf(null, '10', null), 'Só a última faixa é aberta.'],
    ['duas faixas abertas', tiersOf('10', null, null), 'Só a última faixa é aberta.'],
    ['última faixa com teto', tiersOf('10', '20'), 'A última faixa é aberta.'],
    ['faixas demais', tiersOf(...ascending(maxTiersPerPrice + 1)), undefined],
  ])('recusa faixas: %s', (_, input, message) => {
    expect(accepts(priceFileSchema, input)).toBe(false);
    if (message) expect(messages(input)).toEqual([message]);
  });

  it.each([
    ['schemaVersion desconhecida', fileWith({ schemaVersion: 2 })],
    ['região fora de REGIONS', fileWith({ region: 'eu-west-1' })],
    ['moeda que não é USD', fileWith({ currency: 'BRL' })],
    ['serviço com caminho', fileWith({ service: '../lambda' })],
    ['serviço com maiúscula', fileWith({ service: 'Lambda' })],
    ['serviço longo demais', fileWith({ service: 'a'.repeat(41) })],
    ['preços demais', fileWith({ prices: skus(maxPricesPerFile + 1) })],
    ['SKU repetido', fileWith({ prices: [requests, requests] })],
    ['SKU com espaço', priceWith({ sku: 'a b' })],
    ['SKU longo demais', priceWith({ sku: 'a'.repeat(65) })],
    ['descrição longa demais', priceWith({ description: 'a'.repeat(maxDescriptionLength + 1) })],
    ['unidade vazia', priceWith({ unit: '' })],
    ['unidade longa demais', priceWith({ unit: 'a'.repeat(maxUnitLength + 1) })],
    ['pool fora do formato', priceWith({ freeTier: { quantity: '1', pool: 'Pool 1' } })],
    ['sem faixas', priceWith({ tiers: undefined })],
    ['array no lugar do arquivo', [lambdaFile]],
    ['nulo', null],
  ])('recusa %s', (_, input) => {
    expect(accepts(priceFileSchema, input)).toBe(false);
  });

  it('não repete o conteúdo do arquivo nos erros', () => {
    const marker = 'vazou<script>';
    const input = {
      ...lambdaFile,
      service: marker,
      region: marker,
      currency: marker,
      [marker]: marker,
      prices: [
        { ...requests, sku: `${marker} `, unit: '', tiers: [{ upTo: marker, unitPrice: marker }] },
      ],
    };
    const { error } = priceFileSchema.safeParse(input);
    expect(error?.issues.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(error?.issues)).not.toContain('vazou');
    expect(error?.message).not.toContain('vazou');
  });
});

describe('priceManifestSchema', () => {
  it.each(['seed', 'price-list'])('aceita a origem %s, com data e hashes', (source) => {
    const result = priceManifestSchema.parse(manifestWith({ source }));
    expect(result).toEqual({ ...manifest, source });
  });

  it.each([
    ['sem arquivos', manifestWith({ files: [] })],
    ['data com milissegundos', manifestWith({ generatedAt: '2026-11-23T12:00:00.123Z' })],
  ])('aceita %s', (_, input) => {
    expect(accepts(priceManifestSchema, input)).toBe(true);
  });

  it.each([
    ['maiúsculas', 'A'.repeat(64)],
    ['63 caracteres', 'a'.repeat(63)],
    ['65 caracteres', 'a'.repeat(65)],
    ['fora do hexadecimal', 'g'.repeat(64)],
    ['prefixo sha256:', `sha256:${'a'.repeat(57)}`],
    ['vazio', ''],
    ['ausente', undefined],
  ])('recusa sha256 com %s', (_, sha256) => {
    expect(accepts(priceManifestSchema, manifestFile({ sha256 }))).toBe(false);
  });

  it.each([
    ['região fora de REGIONS', 'eu-west-1/lambda.json'],
    ['sem região', 'lambda.json'],
    ['subida de diretório', 'us-east-1/../lambda.json'],
    ['subpasta', 'us-east-1/a/lambda.json'],
    ['caminho absoluto', '/us-east-1/lambda.json'],
    ['URL', 'https://example.com/us-east-1/lambda.json'],
    ['outra extensão', 'us-east-1/lambda.js'],
    ['maiúscula', 'us-east-1/Lambda.json'],
  ])('recusa arquivo com %s', (_, path) => {
    expect(accepts(priceManifestSchema, manifestFile({ path }))).toBe(false);
  });

  it.each([
    ['schemaVersion desconhecida', manifestWith({ schemaVersion: 2 })],
    ['origem desconhecida', manifestWith({ source: 'manual' })],
    ['sem origem', manifestWith({ source: undefined })],
    ['sem data', manifestWith({ generatedAt: undefined })],
    ['data sem hora', manifestWith({ generatedAt: '2026-11-23' })],
    ['data fora de UTC', manifestWith({ generatedAt: '2026-11-23T12:00:00-03:00' })],
    ['data inexistente', manifestWith({ generatedAt: '2026-02-30T12:00:00Z' })],
    ['arquivo repetido', manifestWith({ files: [manifest.files[0], manifest.files[0]] })],
    [
      'arquivos demais',
      manifestWith({
        files: Array.from({ length: maxFilesInManifest + 1 }, (_, i) => ({
          path: `us-east-1/s${i}.json`,
          sha256: sha,
        })),
      }),
    ],
    ['files como objeto', manifestWith({ files: { 'us-east-1/lambda.json': sha } })],
  ])('recusa %s', (_, input) => {
    expect(accepts(priceManifestSchema, input)).toBe(false);
  });
});

describe('PriceCatalog', () => {
  it('junta região, manifest e os arquivos por serviço', () => {
    const file = priceFileSchema.parse(lambdaFile);
    const catalog: PriceCatalog = {
      region: file.region,
      manifest: priceManifestSchema.parse(manifest),
      services: new Map([[file.service, file]]),
    };
    expect(catalog.services.get('lambda')?.prices).toHaveLength(2);
    expect(catalog.manifest.source).toBe('seed');
  });
});
