import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceCodePipeline } from './codepipeline';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  codepipeline: [
    { sku: 'codepipeline-active-pipelines', tiers: [[null, '1']], freeTier: { quantity: '1' } },
    { sku: 'codepipeline-action-minutes', tiers: [[null, '0.002']], freeTier: { quantity: '100' } },
  ],
});

const ACTIVE = 'codepipeline-active-pipelines';
const MINUTES = 'codepipeline-action-minutes';
/** Cada tipo recebe só a própria chave de uso: a do outro tipo pode faltar. */
const v1 = (activePipelines: number) => ({
  attributes: { pipelineType: 'V1' },
  usage: { activePipelines },
});
const v2 = (executionMinutesPerMonth: number) => ({
  attributes: { pipelineType: 'V2' },
  usage: { executionMinutesPerMonth },
});
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco, na franquia que resta. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(
    priceCodePipeline(block).map((c) => ({ ...c, service: 'codepipeline' })),
  );
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  return {
    lines: lines.map(
      (l) => `${l.sku} ${l.charge} ${toFixed(l.quantity, 1)} ${toFixed(l.amount, 3)}`,
    ),
    total: toFixed(sum(lines.map((l) => l.amount)), 3),
  };
}

describe('priceCodePipeline', () => {
  it.each([
    [3, '3'],
    // Uso zero ainda emite a cobrança.
    [0, '0'],
  ])('V1 cobra pipelines ativos como custo fixo: %i', (pipelines, quantity) => {
    expect(priceCodePipeline(v1(pipelines))).toStrictEqual([
      { sku: ACTIVE, quantity: decimal(quantity), charge: 'fixed' },
    ]);
  });

  it.each([
    [500, '500'],
    [150.5, '150.5'],
    [0, '0'],
  ])('V2 cobra minutos de execução como custo variável: %s', (minutes, quantity) => {
    expect(priceCodePipeline(v2(minutes))).toStrictEqual([
      { sku: MINUTES, quantity: decimal(quantity), charge: 'variable' },
    ]);
  });

  it('lê só a chave do tipo ativo', () => {
    const usage = { activePipelines: 4, executionMinutesPerMonth: 900 };
    expect(priceCodePipeline({ attributes: { pipelineType: 'V1' }, usage })).toStrictEqual([
      { sku: ACTIVE, quantity: decimal(4), charge: 'fixed' },
    ]);
    expect(priceCodePipeline({ attributes: { pipelineType: 'V2' }, usage })).toStrictEqual([
      { sku: MINUTES, quantity: decimal(900), charge: 'variable' },
    ]);
    // Sem a chave do outro tipo não lança.
    expect(() => priceCodePipeline(v1(1))).not.toThrow();
    expect(() => priceCodePipeline(v2(1))).not.toThrow();
  });

  it('V1 desconta 1 pipeline grátis por mês', () => {
    // (3 − 1) × 1 = 2,00.
    expect(rate(createRater(catalog), v1(3))).toStrictEqual({
      lines: [`${ACTIVE} fixed 2.0 2.000`],
      total: '2.000',
    });
  });

  it.each([1, 0])('V1 com %i pipeline cabe na franquia e ainda emite a linha', (pipelines) => {
    expect(rate(createRater(catalog), v1(pipelines))).toStrictEqual({
      lines: [`${ACTIVE} fixed 0.0 0.000`],
      total: '0.000',
    });
  });

  it('dois blocos V1 dividem o pipeline grátis da conta', () => {
    // O 1º usa a franquia; o 2º paga 1 × 1 = 1,00.
    const rater = createRater(catalog);
    expect(rate(rater, v1(1)).lines).toEqual([`${ACTIVE} fixed 0.0 0.000`]);
    expect(rate(rater, v1(1)).lines).toEqual([`${ACTIVE} fixed 1.0 1.000`]);
  });

  it.each([
    // (500 − 100) × 0,002 = 0,80.
    [500, '400.0', '0.800'],
    // (150,5 − 100) × 0,002 = 0,101.
    [150.5, '50.5', '0.101'],
    // 80 ≤ 100: cabe na franquia.
    [80, '0.0', '0.000'],
    // Limite da franquia.
    [100, '0.0', '0.000'],
  ])('V2 desconta 100 minutos grátis por mês: %s min', (minutes, billed, usd) => {
    expect(rate(createRater(catalog), v2(minutes))).toStrictEqual({
      lines: [`${MINUTES} variable ${billed} ${usd}`],
      total: usd,
    });
  });

  it('dois blocos V2 dividem os 100 minutos grátis da conta', () => {
    // O 1º usa 60 de 100; o 2º paga (60 − 40) × 0,002 = 0,04.
    const rater = createRater(catalog);
    expect(rate(rater, v2(60)).lines).toEqual([`${MINUTES} variable 0.0 0.000`]);
    expect(rate(rater, v2(60)).lines).toEqual([`${MINUTES} variable 20.0 0.040`]);
  });

  it('V1 e V2 têm franquias separadas', () => {
    // Pipelines e minutos são SKUs diferentes: um não consome a franquia do outro.
    const rater = createRater(catalog);
    expect(rate(rater, v1(1)).total).toBe('0.000');
    expect(rate(rater, v2(100)).total).toBe('0.000');
  });

  it.each([
    ['tipo inválido', { pipelineType: 'V3' }, v1(1).usage, 'tipo de pipeline'],
    ['tipo do protótipo', { pipelineType: 'toString' }, v1(1).usage, 'tipo de pipeline'],
    ['tipo ausente', {}, v1(1).usage, 'tipo de pipeline'],
    ['V1 sem pipelines ativos', { pipelineType: 'V1' }, v2(1).usage, 'uso'],
    ['V2 sem minutos', { pipelineType: 'V2' }, v1(1).usage, 'uso'],
  ])('lança RangeError fora do contrato: %s', (_, attributes, usage, field) => {
    const call = () => priceCodePipeline({ attributes, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.codepipeline: ${field} fora do contrato`);
  });
});
