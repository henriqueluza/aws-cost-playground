import { describe, expect, it } from 'vitest';
import { exportDesign } from '../../application/exportDesign';
import { attrs, block, blocksOf, design, generate, labels, named } from '../../test/generatorKit';
import { INJECTION_PAYLOADS } from '../../test/injectionPayloads';
import { renderHcl } from '../hcl';

const rds = (name: string, attributes = {}, values = {}, label = name) =>
  block(`blk_${name}`, 'aws.rds', attributes, values, label);
const mainTf = (document: unknown) => {
  const result = exportDesign(document);
  if (!result.ok) throw new Error(result.error);
  return result.files[0]?.content ?? '';
};

describe('gerador de RDS', () => {
  it('gera a instância do design, fechada e protegida, com a senha gerenciada pelo RDS', () => {
    const attributes = {
      engine: 'postgres',
      instanceClass: 'db.t3.medium',
      deployment: 'multi-az',
    };
    const nodes = generate(design([rds('banco', { ...attributes, az: 'a' }, { storageGb: 100 })]));
    expect(attrs(named(nodes, 'aws_db_instance', 'banco'))).toEqual({
      identifier: '"db-1"',
      engine: '"postgres"',
      instance_class: '"db.t3.medium"',
      allocated_storage: '100',
      storage_type: '"gp3"',
      storage_encrypted: 'true',
      username: '"dbadmin"',
      manage_master_user_password: 'true',
      multi_az: 'true',
      db_subnet_group_name: 'aws_db_subnet_group.banco.name',
      vpc_security_group_ids: '[aws_security_group.db.id]',
      publicly_accessible: 'false',
      deletion_protection: 'true',
      skip_final_snapshot: 'false',
      final_snapshot_identifier: '"db-1-final"',
      backup_retention_period: '7',
      copy_tags_to_snapshot: 'true',
      auto_minor_version_upgrade: 'true',
    });
  });

  it('instância única fica na zona do bloco; MySQL e os padrões do contrato', () => {
    const nodes = generate(design([rds('a', { engine: 'mysql', az: 'c' }), rds('b')]));
    expect(attrs(named(nodes, 'aws_db_instance', 'a'))).toMatchObject({
      engine: '"mysql"',
      multi_az: 'false',
      availability_zone: 'format("%s%s", var.aws_region, "c")',
    });
    expect(attrs(named(nodes, 'aws_db_instance', 'b'))).toMatchObject({
      identifier: '"db-2"',
      final_snapshot_identifier: '"db-2-final"',
      engine: '"postgres"',
      instance_class: '"db.t3.micro"',
      allocated_storage: '20',
      availability_zone: 'format("%s%s", var.aws_region, "a")',
    });
  });

  it('o grupo de sub-redes tem duas zonas privadas mesmo com o design numa zona só', () => {
    const nodes = generate(design([rds('banco', { az: 'b' })]));
    expect(labels(nodes, 'aws_vpc')).toEqual(['main']);
    expect(attrs(named(nodes, 'aws_db_subnet_group', 'banco')).subnet_ids).toBe(
      '[aws_subnet.private_a.id, aws_subnet.private_b.id]',
    );
  });

  it('nenhum atributo de senha, segredo ou token recebe literal em lugar nenhum do arquivo', () => {
    const text = mainTf(design([rds('a'), rds('b', { engine: 'mysql', deployment: 'multi-az' })]));
    expect(text).not.toMatch(/^\s*\w*(password|secret|token|passwd)\w*\s*=\s*"/im);
    const code = text.split('\n').filter((line) => !line.startsWith('#'));
    expect(code.filter((line) => /password|secret|token/i.test(line))).toEqual([
      '  manage_master_user_password = true',
      '  manage_master_user_password = true',
    ]);
    expect(text).not.toMatch(/^variable "(?!aws_region")/m);
    const nodes = generate(design([rds('a')]));
    const names = blocksOf(nodes).flatMap((node) => Object.keys(attrs(node)));
    expect(names.filter((name) => /password|secret|token/.test(name))).toEqual([
      'manage_master_user_password',
    ]);
  });

  it('avisa do custo do segredo que o painel não mostra', () => {
    expect(mainTf(design([rds('a')]))).toContain(
      '# (manage_master_user_password). Esse segredo custa',
    );
  });

  it('atributo fora do contrato recusa o bloco', () => {
    const document = design([rds('ok'), rds('ruim', { engine: 'oracle-ee' })]);
    expect(labels(generate(document), 'aws_db_instance')).toEqual(['ok']);
    expect(mainTf(document)).toContain('# - aws.rds "ruim": atributo fora das opções do contrato');
  });

  it.each(INJECTION_PAYLOADS)('rótulo com a carga "%s" só muda o nome saneado', (_n, p) => {
    const code = (label: string) => {
      const nodes = generate(design([rds('a', {}, {}, label), rds('b', {}, {}, label)]));
      const names = [...labels(nodes, 'aws_db_instance')].sort(
        (x, y) => (y?.length ?? 0) - (x?.length ?? 0),
      );
      for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      return names.reduce<string>(
        (text, name, i) => text.replaceAll(`${name}`, `N${i}`),
        renderHcl(nodes),
      );
    };
    expect(code(p.slice(0, 80))).toBe(code('ok'));
  });
});
