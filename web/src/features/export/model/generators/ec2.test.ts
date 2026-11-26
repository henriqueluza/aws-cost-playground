import { describe, expect, it } from 'vitest';
import { exportDesign } from '../../application/exportDesign';
import { attrs, block, blocksOf, design, generate, labels, named } from '../../test/generatorKit';
import { INJECTION_PAYLOADS } from '../../test/injectionPayloads';
import { buildExportModel } from '../exportBlocks';

const ec2 = (name: string, attributes = {}, values = {}, label = name) =>
  block(`blk_${name}`, 'aws.ec2', attributes, values, label);
const mainTf = (document: unknown) => {
  const result = exportDesign(document);
  if (!result.ok) throw new Error(result.error);
  return result.files[0]?.content ?? '';
};

describe('gerador de EC2', () => {
  it('gera a instância do design em sub-rede privada, com os padrões seguros', () => {
    const nodes = generate(
      design([
        ec2('web', { instanceType: 'm5.large', az: 'b' }, { instanceCount: 3, rootVolumeGb: 50 }),
      ]),
    );
    expect(attrs(named(nodes, 'aws_instance', 'web'))).toEqual({
      count: '3',
      ami: 'data.aws_ami.al2023_x86_64.id',
      instance_type: '"m5.large"',
      subnet_id: 'aws_subnet.private_b.id',
      vpc_security_group_ids: '[aws_security_group.app.id]',
      associate_public_ip_address: 'false',
      'metadata_options.http_endpoint': '"enabled"',
      'metadata_options.http_tokens': '"required"',
      'metadata_options.http_put_response_hop_limit': '1',
      'root_block_device.encrypted': 'true',
      'root_block_device.volume_type': '"gp3"',
      'root_block_device.volume_size': '50',
    });
  });

  it('usa os padrões do contrato e a zona a quando o design não informa', () => {
    const found = attrs(named(generate(design([ec2('web')])), 'aws_instance', 'web'));
    expect(found).toMatchObject({
      count: '1',
      instance_type: '"t3.small"',
      subnet_id: 'aws_subnet.private_a.id',
      'root_block_device.volume_size': '30',
    });
    expect(Object.keys(found)).not.toContain('key_name');
  });

  it('busca a imagem por data source, uma vez por arquitetura, sem ID fixo', () => {
    const nodes = generate(
      design([
        ec2('a1'),
        ec2('a2', { instanceType: 't4g.small' }),
        ec2('a3'),
        ec2('a4', { instanceType: 't4g.micro' }),
      ]),
    );
    expect(blocksOf(nodes, 'aws_ami', 'data').map((d) => d.labels[1])).toEqual([
      'al2023_x86_64',
      'al2023_arm64',
    ]);
    const [x86] = blocksOf(nodes, 'aws_ami', 'data');
    expect(x86 && attrs(x86)).toEqual({
      most_recent: 'true',
      owners: '["amazon"]',
      'filter.name': '"name"',
      'filter.values': '["al2023-ami-2023.*-x86_64"]',
    });
    expect(attrs(named(nodes, 'aws_instance', 'a4')).ami).toBe('data.aws_ami.al2023_arm64.id');
    expect(mainTf(design([ec2('a1')]))).not.toMatch(/ami-[0-9a-f]{8}/);
  });

  it('atributo fora do contrato recusa o bloco: não vira instância', () => {
    const document = design([ec2('ok'), ec2('ruim', { instanceType: 'x1.32xlarge"\n' })]);
    expect(labels(generate(document), 'aws_instance')).toEqual(['ok']);
    expect(mainTf(document)).toContain('# - aws.ec2 "ruim": atributo fora das opções do contrato');
  });

  it('é determinístico', () => {
    const document = design([ec2('b', { az: 'b' }), ec2('a', { az: 'a' })]);
    expect(mainTf(document)).toBe(mainTf({ ...document, blocks: [...document.blocks].reverse() }));
  });

  it.each(INJECTION_PAYLOADS)(
    'rótulo com a carga "%s" só muda o nome saneado do recurso',
    (_n, p) => {
      const files = (label: string) => {
        const document = design([ec2('web', {}, {}, label), ec2('api', {}, {}, label)]);
        const names = buildExportModel(document).blocks.map((b) => b.name);
        for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
        const code = mainTf(document)
          .split('\n')
          .filter((line) => !line.startsWith('#'));
        return code.map((line) =>
          line.replace(
            /^resource "aws_instance" "[a-z][a-z0-9_]*" \{$/,
            'resource "aws_instance" X {',
          ),
        );
      };
      expect(files(p.slice(0, 80))).toEqual(files('ok'));
    },
  );
});
