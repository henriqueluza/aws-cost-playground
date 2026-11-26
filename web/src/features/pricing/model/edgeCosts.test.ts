import { describe, expect, it } from 'vitest';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { decimal, toFixed } from '../../../shared/lib/money';
import { catalogOf, type RawPrice } from '../../../test/catalogFixtures';
import type { BlockPricer } from './blockContract';
import { blockDefinition } from './blockRegistry';
import { createEstimator, type CostEstimate, type EdgeCost } from './engine';

/** Preços públicos de us-east-1 em 26/11/2026 (os das sementes), para as contas feitas à mão. */
const prices: Record<string, RawPrice[]> = {
  'data-transfer': [
    {
      sku: 'data-transfer-internet-out',
      tiers: [
        ['10240', '0.09'],
        ['51200', '0.085'],
        ['153600', '0.07'],
        [null, '0.05'],
      ],
      freeTier: { quantity: '100' },
    },
    { sku: 'data-transfer-inter-az', tiers: [[null, '0.01']] },
  ],
  cloudfront: [
    {
      sku: 'cloudfront-data-transfer-out',
      tiers: [
        ['10240', '0.085'],
        [null, '0.08'],
      ],
      freeTier: { quantity: '1024' },
    },
  ],
  'nat-gateway': [{ sku: 'nat-gateway-data-processed', tiers: [[null, '0.045']] }],
  cloudwatch: [
    { sku: 'cloudwatch-logs-ingestion', tiers: [[null, '0.5']], freeTier: { quantity: '5' } },
  ],
};
const catalog = catalogOf(prices);

/** Blocos sem cobrança, salvo os de `pricers`: o que está sob teste são as arestas. */
const estimatorWith = (pricers: Record<string, BlockPricer> = {}) =>
  createEstimator({ definition: blockDefinition, pricer: (type) => pricers[type] ?? (() => []) });
const run = estimatorWith();

const block = (id: string, type: string, attributes: object = {}) => ({
  id: `blk_${id}`,
  type: `aws.${type}`,
  label: '',
  attributes,
  usage: { source: 'default', values: {} },
  overrides: {},
});
/** Aresta `origem>destino`; `gb` ausente deixa o uso vazio. */
const edge = (path: string, kind: string, gb?: number, overrides: object = {}) => {
  const [source, target] = path.split('>') as [string, string];
  return {
    id: `edg_${source}_${target}`,
    source: `blk_${source}`,
    target: target === 'client' ? target : `blk_${target}`,
    kind,
    usage: { source: 'default', values: gb === undefined ? {} : { gbPerMonth: gb } },
    overrides,
  };
};
const design = (blocks: object[], edges: object[], region = 'us-east-1'): DesignDocument =>
  designDocumentSchema.parse({
    schemaVersion: 1,
    region,
    workload: { description: '' },
    blocks,
    edges,
    scenarios: [],
  });
/** `sku quantidade preço valor tipo` de cada linha. */
const lines = (item: EdgeCost) =>
  item.lines.map((l) =>
    [l.sku, toFixed(l.quantity, 1), toFixed(l.unitPrice, 3), toFixed(l.amount, 4), l.charge].join(
      ' ',
    ),
  );
const totals = (item: CostEstimate | EdgeCost) =>
  [item.total, item.fixed, item.variable].map((value) => toFixed(value, 4));
const ZERO = { status: 'priced', lines: [], total: decimal(0) };
const UNAVAILABLE = { status: 'unavailable', lines: [], total: decimal(0) };

const web = [
  block('s3', 's3'),
  block('alb', 'alb'),
  block('ec2', 'ec2'),
  block('cdn', 'cloudfront'),
];

describe('saída para a internet (aresta `data` para `client`)', () => {
  it('atravessa a franquia de 100 GB e troca de faixa em 10 TB', () => {
    // 12.388 GB − 100 GB de franquia = 12.288 GB cobrados.
    // 1ª faixa: 10.240 GB × US$ 0,09 = US$ 921,60. 2ª: 2.048 GB × US$ 0,085 = US$ 174,08.
    // Total: US$ 1.095,68, todo variável.
    const result = run(design(web, [edge('s3>client', 'data', 12388)]), catalog);
    const [out] = result.edges;
    expect(out).toMatchObject({ edgeId: 'edg_s3_client', kind: 'data', status: 'priced' });
    expect(lines(out!)).toEqual([
      'data-transfer-internet-out 10240.0 0.090 921.6000 variable',
      'data-transfer-internet-out 2048.0 0.085 174.0800 variable',
    ]);
    expect(totals(out!)).toEqual(['1095.6800', '0.0000', '1095.6800']);
    expect(totals(result)).toEqual(['1095.6800', '0.0000', '1095.6800']);
  });

  it('S3, ALB e EC2 dividem a franquia e somam volume, na ordem das arestas', () => {
    // S3: 60 GB, todos na franquia (restam 40). ALB: 70 − 40 = 30 GB × US$ 0,09 = US$ 2,70.
    // EC2: franquia esgotada, 10 GB × US$ 0,09 = US$ 0,90. Total: US$ 3,60.
    const edges = [
      edge('s3>client', 'data', 60),
      edge('alb>client', 'data', 70),
      edge('ec2>client', 'data', 10),
    ];
    const result = run(design(web, edges), catalog);
    expect(result.edges.map(lines)).toEqual([
      ['data-transfer-internet-out 0.0 0.090 0.0000 variable'],
      ['data-transfer-internet-out 30.0 0.090 2.7000 variable'],
      ['data-transfer-internet-out 10.0 0.090 0.9000 variable'],
    ]);
    expect(totals(result)).toEqual(['3.6000', '0.0000', '3.6000']);
  });

  it('a posição nas faixas é da conta: a segunda origem começa onde a primeira parou', () => {
    // S3: 10.300 − 100 = 10.200 GB × 0,09 = US$ 918,00. ALB: restam 40 GB na 1ª faixa
    // (40 × 0,09 = US$ 3,60) e 60 GB vão para a 2ª (60 × 0,085 = US$ 5,10): US$ 8,70.
    const edges = [edge('s3>client', 'data', 10300), edge('alb>client', 'data', 100)];
    const [s3, alb] = run(design(web, edges), catalog).edges;
    expect(totals(s3!)[0]).toBe('918.0000');
    expect(lines(alb!)).toEqual([
      'data-transfer-internet-out 40.0 0.090 3.6000 variable',
      'data-transfer-internet-out 60.0 0.085 5.1000 variable',
    ]);
  });

  it('o CloudFront usa a tabela e a franquia de 1 TB dele, sem gastar a da região', () => {
    // CloudFront: 1.500 − 1.024 GB de franquia = 476 GB × US$ 0,085 = US$ 40,46.
    // S3 depois dele: 100 GB, ainda inteiros na franquia de 100 GB da região: US$ 0.
    const edges = [edge('cdn>client', 'data', 1500), edge('s3>client', 'data', 100)];
    const result = run(design(web, edges), catalog);
    expect(result.edges.map(lines)).toEqual([
      ['cloudfront-data-transfer-out 476.0 0.085 40.4600 variable'],
      ['data-transfer-internet-out 0.0 0.090 0.0000 variable'],
    ]);
    expect(totals(result)).toEqual(['40.4600', '0.0000', '40.4600']);
  });
});

describe('tráfego entre zonas (aresta `data` entre blocos com `az`)', () => {
  const zoned = [
    block('a', 'ec2', { az: 'a' }),
    block('b', 'ec2', { az: 'b' }),
    block('db', 'rds', { az: 'a' }),
    block('cache', 'elasticache', { az: 'b' }),
    block('nozone', 'ec2'),
    block('fn', 'lambda'),
  ];

  it('zonas diferentes: cobra o volume na saída de uma zona e na entrada da outra', () => {
    // b → db (zona b para a): 30 GB × 2 direções = 60 GB × US$ 0,01 = US$ 0,60.
    // a → cache (zona a para b): 10 GB × 2 = 20 GB × US$ 0,01 = US$ 0,20. Total: US$ 0,80.
    const edges = [edge('b>db', 'data', 30), edge('a>cache', 'data', 10)];
    const result = run(design(zoned, edges), catalog);
    expect(result.edges.map(lines)).toEqual([
      ['data-transfer-inter-az 60.0 0.010 0.6000 variable'],
      ['data-transfer-inter-az 20.0 0.010 0.2000 variable'],
    ]);
    expect(totals(result)).toEqual(['0.8000', '0.0000', '0.8000']);
  });

  it('mesma zona, ponta sem `az` ou serviço sem zona: aresta `priced` com zero e sem linhas', () => {
    const edges = [
      edge('a>db', 'data', 30),
      edge('nozone>db', 'data', 30),
      edge('a>nozone', 'data', 30),
      edge('fn>db', 'data', 30),
    ];
    const result = run(design(zoned, edges), catalog);
    result.edges.forEach((item) => expect(item).toMatchObject(ZERO));
    expect(totals(result)).toEqual(['0.0000', '0.0000', '0.0000']);
    // Sem cobrança, nem o serviço precisa estar carregado.
    expect(run(design(zoned, edges), catalogOf({})).edges[0]).toMatchObject(ZERO);
  });
});

describe('NAT Gateway, logs e `runs-on`', () => {
  it('aresta `data` para o NAT cobra o GB processado, junto do volume informado no bloco', () => {
    // Arestas: 25 GB × US$ 0,045 = US$ 1,125 cada. Bloco: 100 GB × US$ 0,045 = US$ 4,50.
    // Total: 4,50 + 1,125 + 1,125 = US$ 6,75.
    const nat: BlockPricer = () => [
      { sku: 'nat-gateway-data-processed', quantity: decimal(100), charge: 'variable' },
    ];
    const blocks = [
      block('a', 'ec2', { az: 'a' }),
      block('b', 'ec2', { az: 'b' }),
      block('nat', 'nat-gateway'),
    ];
    const edges = [edge('a>nat', 'data', 25), edge('b>nat', 'data', 25)];
    const result = estimatorWith({ 'aws.nat-gateway': nat })(design(blocks, edges), catalog);
    expect(result.edges.map(lines)).toEqual([
      ['nat-gateway-data-processed 25.0 0.045 1.1250 variable'],
      ['nat-gateway-data-processed 25.0 0.045 1.1250 variable'],
    ]);
    expect(totals(result)).toEqual(['6.7500', '0.0000', '6.7500']);
  });

  it('aresta `logs` cobra a ingestão e divide a franquia de 5 GB com o bloco CloudWatch', () => {
    // Bloco (avaliado antes das arestas): 3 GB, na franquia; restam 2 GB.
    // 1ª aresta: 20 − 2 = 18 GB × US$ 0,50 = US$ 9,00. 2ª: 10 GB × US$ 0,50 = US$ 5,00.
    const cloudwatch: BlockPricer = () => [
      { sku: 'cloudwatch-logs-ingestion', quantity: decimal(3), charge: 'variable' },
    ];
    const blocks = [block('fn', 'lambda'), block('db', 'rds'), block('logs', 'cloudwatch')];
    const edges = [edge('fn>logs', 'logs', 20), edge('db>logs', 'logs', 10)];
    const result = estimatorWith({ 'aws.cloudwatch': cloudwatch })(design(blocks, edges), catalog);
    expect(result.blocks[2]!.lines.map((l) => toFixed(l.quantity, 1))).toEqual(['0.0']);
    expect(result.edges.map((item) => [item.kind, ...lines(item)])).toEqual([
      ['logs', 'cloudwatch-logs-ingestion 18.0 0.500 9.0000 variable'],
      ['logs', 'cloudwatch-logs-ingestion 10.0 0.500 5.0000 variable'],
    ]);
    expect(totals(result)).toEqual(['14.0000', '0.0000', '14.0000']);
  });

  it('`runs-on` não custa, com ou sem catálogo', () => {
    const blocks = [block('svc', 'ecs', { az: 'a' }), block('host', 'ec2', { az: 'b' })];
    const input = design(blocks, [edge('svc>host', 'runs-on')]);
    for (const loaded of [catalog, catalogOf({})]) {
      expect(run(input, loaded).edges).toEqual([
        expect.objectContaining({ ...ZERO, edgeId: 'edg_svc_host', kind: 'runs-on' }),
      ]);
    }
  });
});

describe('uso e preço ausente', () => {
  it('usa o uso efetivo: override vence, ausente recebe o padrão de 10 GB e o teto limita', () => {
    // Sem franquia de sobra? Cada caso roda sozinho: 100 GB grátis e o resto a US$ 0,09.
    const billed = (gb?: number, overrides: object = {}) =>
      lines(run(design(web, [edge('s3>client', 'data', gb, overrides)]), catalog).edges[0]!);
    // Override: 300 − 100 = 200 GB × 0,09 = US$ 18,00 (o valor estimado, 5.000 GB, não conta).
    expect(billed(5000, { gbPerMonth: 300 })).toEqual([
      'data-transfer-internet-out 200.0 0.090 18.0000 variable',
    ]);
    // Ausente: padrão de 10 GB do contrato, dentro da franquia.
    expect(billed()).toEqual(['data-transfer-internet-out 0.0 0.090 0.0000 variable']);
    // Acima do teto do contrato (100.000.000 GB): limitado a ele, menos 100 GB de franquia.
    const capped = run(design(web, [edge('s3>client', 'data', 1e12)]), catalog).edges[0]!;
    const quantity = capped.lines.reduce((sum, line) => sum + line.quantity, 0n);
    expect(quantity).toBe(decimal(100_000_000 - 100));
  });

  it('serviço ou SKU ausente: aresta `unavailable`, fora dos totais e sem gastar franquia', () => {
    const edges = [
      edge('cdn>client', 'data', 5000),
      edge('s3>client', 'data', 60),
      edge('alb>client', 'data', 70),
    ];
    // Sem `cloudfront` carregado: só a aresta do CloudFront fica sem preço.
    // S3 e ALB como no teste da franquia: 0 e 30 GB × 0,09 = US$ 2,70.
    const withoutCloudFront = Object.fromEntries(
      Object.entries(prices).filter(([service]) => service !== 'cloudfront'),
    );
    const partial = run(design(web, edges), catalogOf(withoutCloudFront));
    expect(partial.edges[0]).toMatchObject({ ...UNAVAILABLE, edgeId: 'edg_cdn_client' });
    expect(totals(partial)).toEqual(['2.7000', '0.0000', '2.7000']);
    // Serviço carregado sem o SKU.
    const noSku = run(design(web, edges), catalogOf({ ...prices, 'data-transfer': [] }));
    expect(noSku.edges.map((item) => item.status)).toEqual([
      'priced',
      'unavailable',
      'unavailable',
    ]);
  });

  it('catálogo de outra região: toda aresta `unavailable`, inclusive a sem custo', () => {
    const blocks = [...web, block('svc', 'ecs')];
    const edges = [edge('s3>client', 'data', 500), edge('svc>ec2', 'runs-on')];
    const result = run(design(blocks, edges, 'sa-east-1'), catalog);
    result.edges.forEach((item) => expect(item).toMatchObject(UNAVAILABLE));
    expect(totals(result)).toEqual(['0.0000', '0.0000', '0.0000']);
  });

  it('aresta fora do contrato não tem preço', () => {
    const blocks = [
      ...web,
      block('fn', 'lambda'),
      block('logs', 'cloudwatch'),
      block('other', 'kinesis'),
      block('bad', 'ec2', { az: 'z' }),
      block('db', 'rds', { az: 'a' }),
    ];
    const edges = [
      edge('fn>client', 'data', 500), // Lambda não chega a `client` no contrato.
      edge('fn>s3', 'logs', 5), // `logs` só chega ao CloudWatch.
      edge('fn>ec2', 'runs-on'), // `runs-on` é só ECS → EC2.
      edge('other>s3', 'data', 5), // Tipo de bloco desconhecido na origem.
      edge('s3>other', 'data', 5), // E no destino.
      edge('bad>db', 'data', 5), // Zona fora das opções: não dá para saber se cruza zonas.
      edge('logs>s3', 'data', 5), // CloudWatch não é origem de `data`.
    ];
    const result = run(design(blocks, edges), catalog);
    result.edges.forEach((item) => expect(item).toMatchObject(UNAVAILABLE));
    expect(totals(result)).toEqual(['0.0000', '0.0000', '0.0000']);
  });
});
