import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';
import { blockAz, ordinalId, securityGroupId, subnetIds, withNetwork, zoneName } from './network';

/**
 * RDS: instância em sub-redes privadas, sem acesso público, criptografada, com proteção contra
 * exclusão, snapshot final e backup. A senha nunca aparece no arquivo: o RDS a gera e guarda.
 */
export const rds: BlockGenerator = (input) => {
  const { block } = input;
  const id = ordinalId(input, 'db');
  const multiAz = block.attributes.deployment === 'multi-az';
  return withNetwork(input, [
    hcl.comment('A senha do usuário mestre é gerada e guardada pelo RDS no Secrets Manager'),
    hcl.comment(
      '(manage_master_user_password). Esse segredo custa cerca de US$ 0,40 por mês e não',
    ),
    hcl.comment('aparece no painel de custo do produto.'),
    hcl.block(
      'resource',
      ['aws_db_subnet_group', block.name],
      [hcl.attr('subnet_ids', subnetIds('private', input.blocks))],
    ),
    hcl.block(
      'resource',
      ['aws_db_instance', block.name],
      [
        hcl.attr('identifier', hcl.string(id)),
        hcl.attr('engine', hcl.string(String(block.attributes.engine))),
        hcl.attr('instance_class', hcl.string(String(block.attributes.instanceClass))),
        hcl.attr('allocated_storage', hcl.number(block.usage.storageGb ?? 20)),
        hcl.attr('storage_type', hcl.string('gp3')),
        hcl.attr('storage_encrypted', hcl.bool(true)),
        hcl.attr('username', hcl.string('dbadmin')),
        hcl.attr('manage_master_user_password', hcl.bool(true)),
        hcl.attr('multi_az', hcl.bool(multiAz)),
        // Com Multi-AZ o RDS escolhe as zonas; a zona do bloco só vale para instância única.
        ...(multiAz ? [] : [hcl.attr('availability_zone', zoneName(blockAz(block)))]),
        hcl.attr('db_subnet_group_name', hcl.ref('aws_db_subnet_group', block.name, 'name')),
        hcl.attr('vpc_security_group_ids', hcl.list([securityGroupId('db')])),
        hcl.attr('publicly_accessible', hcl.bool(false)),
        hcl.attr('deletion_protection', hcl.bool(true)),
        hcl.attr('skip_final_snapshot', hcl.bool(false)),
        hcl.attr('final_snapshot_identifier', hcl.string(`${id}-final`)),
        hcl.attr('backup_retention_period', hcl.number(7)),
        hcl.attr('copy_tags_to_snapshot', hcl.bool(true)),
        hcl.attr('auto_minor_version_upgrade', hcl.bool(true)),
      ],
    ),
  ]);
};
