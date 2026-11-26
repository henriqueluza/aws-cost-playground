import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';
import { ordinalId } from './network';

/** Dias em que um segredo apagado ainda pode ser recuperado (o máximo do serviço). */
const RECOVERY_WINDOW_DAYS = 30;

/**
 * Secrets Manager: os segredos do design, criados vazios. Não há `aws_secretsmanager_secret_version`
 * nem valor em variável: quem aplica grava o valor depois, fora do arquivo e do estado do Terraform.
 * A criptografia usa a chave gerenciada do serviço (sem chave KMS própria, que teria custo fixo).
 */
export const secretsManager: BlockGenerator = (input) => {
  const { block, links } = input;
  const peers = links.flatMap(({ kind, peer }) =>
    kind === 'data' && peer ? [`${peer.type} (${peer.name})`] : [],
  );
  return {
    exported: true,
    nodes: [
      hcl.comment(
        'Segredos criados sem valor: grave o valor depois de aplicar, fora deste arquivo.',
      ),
      hcl.comment('Nenhum papel recebe leitura aqui: dê acesso por segredo, só a quem precisa.'),
      ...(peers.length > 0
        ? [hcl.comment(`Ligados ao cofre no design: ${[...new Set(peers)].join(', ')}.`)]
        : []),
      hcl.block(
        'resource',
        ['aws_secretsmanager_secret', block.name],
        [
          hcl.attr('count', hcl.number(block.usage.secrets ?? 0)),
          hcl.attr(
            'name',
            hcl.call('format', [
              hcl.string(`aws-cost-playground/${ordinalId(input, 'cofre')}/%d`),
              hcl.ref('count', 'index'),
            ]),
          ),
          hcl.attr('recovery_window_in_days', hcl.number(RECOVERY_WINDOW_DAYS)),
        ],
      ),
    ],
  };
};
