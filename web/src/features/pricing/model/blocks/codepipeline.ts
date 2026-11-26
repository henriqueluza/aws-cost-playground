import { decimal } from '../../../../shared/lib/money';
import type { BlockCharge, BlockPricer } from '../blockContract';

/** O que cada tipo de pipeline cobra: a chave de uso lida, o SKU do catálogo e o tipo de custo. */
interface PipelineCharge {
  readonly usageKey: 'activePipelines' | 'executionMinutesPerMonth';
  readonly sku: string;
  readonly charge: BlockCharge['charge'];
}

/** Cobrança por tipo de pipeline do contrato. `Map`: chave do protótipo não casa. */
const PIPELINE_TYPE_CHARGE: ReadonlyMap<unknown, PipelineCharge> = new Map([
  ['V1', { usageKey: 'activePipelines', sku: 'codepipeline-active-pipelines', charge: 'fixed' }],
  [
    'V2',
    {
      usageKey: 'executionMinutesPerMonth',
      sku: 'codepipeline-action-minutes',
      charge: 'variable',
    },
  ],
]);

/**
 * `aws.codepipeline`: a cobrança do tipo de pipeline do bloco, emitida mesmo com uso zero.
 * Regra da AWS: V1 paga US$ por pipeline ativo por mês (custo fixo), com 1 pipeline grátis por
 * mês; V2 paga por minuto de execução de ação (custo variável), com 100 minutos grátis por mês.
 * As franquias e os preços ficam no catálogo, não aqui. Só a chave de uso do tipo ativo é lida.
 * Fora de escopo: os 30 dias grátis de pipeline novo, que são temporários, e as cobranças dos
 * outros serviços que as ações usam (ex.: CodeBuild, S3, Lambda).
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceCodePipeline: BlockPricer = ({ attributes, usage }) => {
  const pipeline = PIPELINE_TYPE_CHARGE.get(attributes.pipelineType);
  if (pipeline === undefined) {
    throw new RangeError('aws.codepipeline: tipo de pipeline fora do contrato');
  }
  const quantity = usage[pipeline.usageKey];
  if (quantity === undefined) throw new RangeError('aws.codepipeline: uso fora do contrato');
  return [{ sku: pipeline.sku, quantity: decimal(quantity), charge: pipeline.charge }];
};
