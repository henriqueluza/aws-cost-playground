import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';

/** Retenção dos logs em dias: sem ela o log group guarda (e cobra) para sempre. */
const RETENTION_DAYS = 30;

/**
 * CloudWatch: um log group com retenção definida. O contrato do bloco só traz quantidades de
 * métricas e de alarmes, sem dizer o que medir, então nenhum alarme é inventado. As arestas `logs`
 * viram só a lista de quem escreve no grupo: nenhum recurso pago a mais.
 */
export const cloudwatch: BlockGenerator = ({ block, links }) => {
  const sources = links.flatMap(({ kind, role, peer }) =>
    kind === 'logs' && role === 'target' && peer ? [`${peer.type} (${peer.name})`] : [],
  );
  return {
    exported: true,
    nodes: [
      hcl.comment('Métricas e alarmes do design são só quantidades: nenhum alarme é gerado.'),
      hcl.comment('Criptografia padrão do serviço, sem chave KMS própria (que teria custo fixo).'),
      ...(sources.length > 0 ? [hcl.comment(`Origens dos logs: ${sources.join(', ')}.`)] : []),
      hcl.block(
        'resource',
        ['aws_cloudwatch_log_group', block.name],
        [
          hcl.attr('name', hcl.string(`/aws-cost-playground/${block.name}`)),
          hcl.attr('retention_in_days', hcl.number(RETENTION_DAYS)),
        ],
      ),
    ],
  };
};
