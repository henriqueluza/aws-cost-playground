import { decimal, mul } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** Tipos de instância do contrato. `Set`: chave do protótipo não casa. */
const INSTANCE_TYPES: ReadonlySet<unknown> = new Set([
  't3.micro',
  't3.small',
  't3.medium',
  't3.large',
  't4g.micro',
  't4g.small',
  't4g.medium',
  'm5.large',
  'm5.xlarge',
  'c5.large',
  'r5.large',
]);

/**
 * `aws.ec2`: Linux, tenancy compartilhada, On-Demand. Horas = instâncias × horas, `fixed`. O
 * volume raiz gp3 sai em linha separada: GB × instâncias pelo mês inteiro (volume de instância
 * parada segue cobrado; não rateia por hora), `fixed`, com os 3.000 IOPS e 125 MB/s incluídos.
 * As duas linhas saem mesmo com zero hora. Sem franquia (a de 12 meses não entra) e faixa única.
 * O atributo `az` não entra no preço.
 * Fora de escopo: créditos de CPU do modo unlimited (T3/T4g), IOPS e vazão acima do incluído,
 * snapshots, IP elástico, monitoramento detalhado, transferência de dados (vem das arestas) e
 * Reserved, Savings Plans e Spot.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceEc2: BlockPricer = ({ attributes, usage }) => {
  const { instanceType } = attributes;
  const { instanceCount, hoursPerMonth, rootVolumeGb } = usage;
  if (typeof instanceType !== 'string' || !INSTANCE_TYPES.has(instanceType)) {
    throw new RangeError('aws.ec2: tipo de instância fora do contrato');
  }
  if (instanceCount === undefined || hoursPerMonth === undefined || rootVolumeGb === undefined) {
    throw new RangeError('aws.ec2: uso fora do contrato');
  }
  const instances = decimal(instanceCount);
  return [
    {
      sku: `ec2-instance-${instanceType}`,
      quantity: mul(instances, decimal(hoursPerMonth)),
      charge: 'fixed',
    },
    { sku: 'ec2-ebs-gp3', quantity: mul(instances, decimal(rootVolumeGb)), charge: 'fixed' },
  ];
};
