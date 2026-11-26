import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** Opções do contrato. `Set` compara por igualdade estrita: chave do protótipo não casa. */
const ENGINES: ReadonlySet<string> = new Set(['postgres', 'mysql']);
const INSTANCE_CLASSES: ReadonlySet<string> = new Set([
  'db.t3.micro',
  'db.t3.small',
  'db.t3.medium',
  'db.t4g.micro',
  'db.t4g.small',
  'db.t4g.medium',
  'db.m5.large',
  'db.r5.large',
]);
const DEPLOYMENTS: ReadonlySet<string> = new Set(['single-az', 'multi-az']);
/** Horas de um mês na calculadora da AWS (como no DynamoDB); o contrato do RDS não tem horas. */
const HOURS_PER_MONTH = decimal(730);

/** O valor do atributo, se for uma das opções do contrato. */
const contractOption = (options: ReadonlySet<string>, value: unknown): string | undefined =>
  typeof value === 'string' && options.has(value) ? value : undefined;

/**
 * `aws.rds`: instância, armazenamento gp3 e backup do motor do bloco, emitidos mesmo com uso zero.
 * Instância: 730 h/mês da classe e da implantação. O Multi-AZ não multiplica nada: o preço por hora
 * da AWS já é o da instância com a réplica em espera. Armazenamento: os GB provisionados, custo
 * fixo, porque se paga por existir, não pelo uso. Backup: `backupStorageGb` é só o backup ALÉM do
 * incluído (o campo "Additional backup storage" da calculadora da AWS), cobrado inteiro. A AWS não
 * cobra backup até 100% do armazenamento provisionado da região; esse incluído não entra na chave,
 * e por isso a função não desconta `storageGb`.
 * O atributo `az` não muda o preço e não é lido. Os preços ficam no catálogo, não aqui; o RDS não
 * tem franquia perpétua nem faixas na Price List.
 * Fora de escopo: IOPS e throughput extras do gp3, io1/io2, gp2, Multi-AZ com standbys legíveis
 * (cluster), Aurora, créditos Unlimited de T3/T4g, instâncias reservadas, Extended Support e
 * transferência de dados (aresta).
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceRds: BlockPricer = ({ attributes, usage }) => {
  const engine = contractOption(ENGINES, attributes.engine);
  const instanceClass = contractOption(INSTANCE_CLASSES, attributes.instanceClass);
  const deployment = contractOption(DEPLOYMENTS, attributes.deployment);
  const { storageGb, backupStorageGb } = usage;
  if (engine === undefined) throw new RangeError('aws.rds: motor fora do contrato');
  if (instanceClass === undefined) {
    throw new RangeError('aws.rds: classe de instância fora do contrato');
  }
  if (deployment === undefined) throw new RangeError('aws.rds: implantação fora do contrato');
  if (storageGb === undefined || backupStorageGb === undefined) {
    throw new RangeError('aws.rds: uso fora do contrato');
  }
  return [
    {
      sku: `rds-${engine}-${instanceClass}-${deployment}`,
      quantity: HOURS_PER_MONTH,
      charge: 'fixed',
    },
    { sku: `rds-${engine}-gp3-${deployment}`, quantity: decimal(storageGb), charge: 'fixed' },
    { sku: `rds-${engine}-backup`, quantity: decimal(backupStorageGb), charge: 'variable' },
  ];
};
