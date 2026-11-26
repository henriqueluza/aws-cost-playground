import { add, compare, decimal, mul, sub, type Decimal } from '../../../shared/lib/money';
import type { Price, PriceCatalog } from './catalog';
import type { ChargeKind, CostLine } from './engine';

/** Quantidade mensal de um SKU de um serviço do catálogo (`PriceFile.service`). */
export interface ServiceCharge {
  readonly service: string;
  readonly sku: string;
  readonly quantity: Decimal;
  readonly charge: ChargeKind;
}

/**
 * Aplica as regras do catálogo às cobranças de um design, item a item, na ordem das chamadas.
 * Franquia e posição nas faixas são da conta (do design inteiro), não de cada item: dois blocos
 * do mesmo SKU dividem a franquia e somam volume para a faixa seguinte.
 */
export interface Rater {
  /** Linhas de um item; `undefined` se falta preço de alguma cobrança (nada é consumido). */
  rate(charges: readonly ServiceCharge[]): readonly CostLine[] | undefined;
}

const ZERO = decimal(0);
const least = (a: Decimal, b: Decimal): Decimal => (compare(a, b) <= 0 ? a : b);

/** Franquia de cada `pool`: a menor declarada no catálogo, para não depender da ordem do design. */
function poolAllowances(catalog: PriceCatalog): Map<string, Decimal> {
  const pools = new Map<string, Decimal>();
  for (const file of catalog.services.values()) {
    for (const { freeTier } of file.prices) {
      if (freeTier?.pool === undefined) continue;
      const known = pools.get(freeTier.pool);
      pools.set(
        freeTier.pool,
        known === undefined ? freeTier.quantity : least(known, freeTier.quantity),
      );
    }
  }
  return pools;
}

/** Cria o estado de uma estimativa. Cada `estimate` usa um `Rater` novo; o catálogo não é alterado. */
export function createRater(catalog: PriceCatalog): Rater {
  const pools = poolAllowances(catalog);
  /** Franquia que resta, por `pool` ou por SKU. */
  const freeLeft = new Map<string, Decimal>();
  /** Quantidade já cobrada de cada SKU: a posição nas faixas. */
  const billed = new Map<string, Decimal>();

  function afterFreeTier(skuKey: string, price: Price, quantity: Decimal): Decimal {
    const { freeTier } = price;
    if (freeTier === undefined) return quantity;
    // `skuKey` sempre tem `/`, que o slug do `pool` não aceita: as chaves não colidem.
    const key = freeTier.pool ?? skuKey;
    const allowance = freeTier.pool === undefined ? undefined : pools.get(freeTier.pool);
    const left = freeLeft.get(key) ?? allowance ?? freeTier.quantity;
    const used = least(quantity, left);
    freeLeft.set(key, sub(left, used));
    return sub(quantity, used);
  }

  function lines(charge: ServiceCharge, price: Price): CostLine[] {
    const skuKey = `${charge.service}/${charge.sku}`;
    const minimum = price.minimumQuantity;
    const belowMinimum =
      minimum !== undefined && charge.quantity !== ZERO && compare(charge.quantity, minimum) < 0;
    let rest = afterFreeTier(skuKey, price, belowMinimum ? minimum : charge.quantity);
    let cursor = billed.get(skuKey) ?? ZERO;
    const result: CostLine[] = [];
    for (const tier of price.tiers) {
      if (tier.upTo !== null && compare(cursor, tier.upTo) >= 0) continue;
      const quantity = tier.upTo === null ? rest : least(rest, sub(tier.upTo, cursor));
      const amount = mul(quantity, tier.unitPrice);
      result.push({
        sku: charge.sku,
        quantity,
        unitPrice: tier.unitPrice,
        amount,
        charge: charge.charge,
      });
      cursor = add(cursor, quantity);
      rest = sub(rest, quantity);
      // Nada a cobrar (franquia ou quantidade zero) deixa uma linha zerada, para o SKU aparecer.
      if (rest === ZERO) break;
    }
    billed.set(skuKey, cursor);
    return result;
  }

  return {
    rate(charges) {
      const priced: (readonly [ServiceCharge, Price])[] = [];
      for (const charge of charges) {
        const file = catalog.services.get(charge.service);
        const price = file?.prices.find((candidate) => candidate.sku === charge.sku);
        if (price === undefined || compare(charge.quantity, ZERO) < 0) return undefined;
        priced.push([charge, price]);
      }
      return priced.flatMap(([charge, price]) => lines(charge, price));
    },
  };
}
