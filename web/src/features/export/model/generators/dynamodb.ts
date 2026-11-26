import type { BlockGenerator } from '../generator';
import { hcl, type HclNode } from '../hcl';

const keyAttribute = (name: string): HclNode =>
  hcl.block(
    'attribute',
    [],
    [hcl.attr('name', hcl.string(name)), hcl.attr('type', hcl.string('S'))],
  );

/**
 * Tabela com criptografia em repouso, recuperação pontual e proteção contra exclusão. O modo de
 * cobrança vem do atributo; no provisionado, as capacidades vêm do uso (a AWS exige ao menos 1).
 */
export const dynamodb: BlockGenerator = ({ block }) => {
  const provisioned = block.attributes.capacityMode === 'provisioned';
  const units = (key: string) => hcl.number(Math.max(1, block.usage[key] ?? 0));

  return {
    exported: true,
    nodes: [
      hcl.comment('Ponto de partida: o design não tem esquema. As chaves pk e sk são de exemplo.'),
      hcl.block(
        'resource',
        ['aws_dynamodb_table', block.name],
        [
          hcl.attr('name', hcl.string(block.name)),
          hcl.attr('billing_mode', hcl.string(provisioned ? 'PROVISIONED' : 'PAY_PER_REQUEST')),
          ...(provisioned
            ? [
                hcl.attr('read_capacity', units('provisionedReadUnits')),
                hcl.attr('write_capacity', units('provisionedWriteUnits')),
              ]
            : []),
          hcl.attr('hash_key', hcl.string('pk')),
          hcl.attr('range_key', hcl.string('sk')),
          hcl.attr('deletion_protection_enabled', hcl.bool(true)),
          keyAttribute('pk'),
          keyAttribute('sk'),
          hcl.block('server_side_encryption', [], [hcl.attr('enabled', hcl.bool(true))]),
          hcl.block('point_in_time_recovery', [], [hcl.attr('enabled', hcl.bool(true))]),
        ],
      ),
    ],
  };
};
