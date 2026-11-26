import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceWaf } from './waf';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  waf: [
    { sku: 'waf-web-acls', tiers: [[null, '5']] },
    { sku: 'waf-rules', tiers: [[null, '1']] },
    { sku: 'waf-requests', tiers: [[null, '0.0000006']] },
  ],
});

const waf = (webAcls: number, rules: number, requestsPerMonth: number) => ({
  attributes: {},
  usage: { webAcls, rules, requestsPerMonth },
});
const charge = (sku: string, quantity: string, kind: 'fixed' | 'variable') => ({
  sku: `waf-${sku}`,
  quantity: decimal(quantity),
  charge: kind,
});
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco, com `digits` casas. */
function rate(rater: Rater, block: BlockPriceInput, digits = 2) {
  const lines = rater.rate(priceWaf(block).map((c) => ({ ...c, service: 'waf' })));
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  return {
    lines: lines.map(
      (l) => `${l.sku} ${l.charge} ${toFixed(l.quantity, 0)} ${toFixed(l.amount, digits)}`,
    ),
    total: toFixed(sum(lines.map((l) => l.amount)), digits),
  };
}

describe('priceWaf', () => {
  it.each([
    [1, 5, 1e6, '1', '5', '1000000'],
    [3, 40, 2.5e7, '3', '40', '25000000'],
    [100, 10000, 1e11, '100', '10000', '100000000000'],
    // Uso zero ainda emite as três cobranças.
    [1, 0, 0, '1', '0', '0'],
  ])(
    'cobra web ACLs e regras fixas e requisições variáveis: %i ACLs',
    (a, r, q, acls, rules, req) => {
      expect(priceWaf(waf(a, r, q))).toStrictEqual([
        charge('web-acls', acls, 'fixed'),
        charge('rules', rules, 'fixed'),
        charge('requests', req, 'variable'),
      ]);
    },
  );

  it('cobra o total de regras do bloco, não regras por web ACL', () => {
    // 4 web ACLs com 6 regras no total: 4 × 5 = 20 e 6 × 1 = 6, nunca 4 × 6 regras.
    expect(rate(createRater(catalog), waf(4, 6, 0))).toStrictEqual({
      lines: [
        'waf-web-acls fixed 4 20.00',
        'waf-rules fixed 6 6.00',
        'waf-requests variable 0 0.00',
      ],
      total: '26.00',
    });
  });

  it('padrão do contrato: 1 web ACL, 5 regras e 1.000.000 de requisições custam 10,60', () => {
    // 1 × 5 = 5; 5 × 1 = 5; 1.000.000 × 0,0000006 = 0,60.
    expect(rate(createRater(catalog), waf(1, 5, 1e6))).toStrictEqual({
      lines: [
        'waf-web-acls fixed 1 5.00',
        'waf-rules fixed 5 5.00',
        'waf-requests variable 1000000 0.60',
      ],
      total: '10.60',
    });
  });

  it('máximo do contrato: 100 web ACLs, 10.000 regras e 1e11 requisições custam 70.500,00', () => {
    // 100 × 5 = 500; 10.000 × 1 = 10.000; 1e11 × 0,0000006 = 60.000.
    expect(rate(createRater(catalog), waf(100, 10000, 1e11))).toStrictEqual({
      lines: [
        'waf-web-acls fixed 100 500.00',
        'waf-rules fixed 10000 10000.00',
        'waf-requests variable 100000000000 60000.00',
      ],
      total: '70500.00',
    });
  });

  it('uso zero emite linhas zeradas: só a web ACL mínima é cobrada', () => {
    expect(rate(createRater(catalog), waf(1, 0, 0))).toStrictEqual({
      lines: [
        'waf-web-acls fixed 1 5.00',
        'waf-rules fixed 0 0.00',
        'waf-requests variable 0 0.00',
      ],
      total: '5.00',
    });
  });

  it('o WAF não tem franquia gratuita: a primeira unidade de cada SKU já é cobrada', () => {
    // 1 × 5 + 1 × 1 + 1 × 0,0000006 = 6,0000006, sem arredondar (7 casas).
    expect(rate(createRater(catalog), waf(1, 1, 1), 7)).toStrictEqual({
      lines: [
        'waf-web-acls fixed 1 5.0000000',
        'waf-rules fixed 1 1.0000000',
        'waf-requests variable 1 0.0000006',
      ],
      total: '6.0000006',
    });
  });

  it('o WAF não tem troca de faixa: dois blocos no máximo somam pelo mesmo preço unitário', () => {
    // O 2º bloco começa depois de 1e11 requisições, 100 ACLs e 10.000 regras e paga o mesmo:
    // 2 × 70.500,00 = 141.000,00.
    const rater = createRater(catalog);
    const [first, second] = [1, 2].map(() => rate(rater, waf(100, 10000, 1e11)));
    expect(second!.lines).toStrictEqual(first!.lines);
    expect(second!.total).toBe('70500.00');
    expect(toFixed(sum([first!.total, second!.total].map(decimal)), 2)).toBe('141000.00');
  });

  it('dois blocos padrão somam 2 × 10,60 = 21,20, sem franquia dividida', () => {
    const rater = createRater(catalog);
    const totals = [1, 2].map(() => rate(rater, waf(1, 5, 1e6)).total);
    expect(totals).toStrictEqual(['10.60', '10.60']);
    expect(toFixed(sum(totals.map(decimal)), 2)).toBe('21.20');
  });

  const full = waf(1, 5, 1e6).usage;
  it.each([['webAcls'], ['rules'], ['requestsPerMonth']])(
    'lança RangeError fora do contrato: sem %s',
    (missing) => {
      const usage = Object.fromEntries(Object.entries(full).filter(([key]) => key !== missing));
      const call = () => priceWaf({ attributes: {}, usage });
      expect(call).toThrow(RangeError);
      expect(call).toThrow('aws.waf: uso fora do contrato');
    },
  );

  it('lança RangeError fora do contrato: sem uso', () => {
    const call = () => priceWaf({ attributes: {}, usage: {} });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.waf: uso fora do contrato');
  });
});
