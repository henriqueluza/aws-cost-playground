import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { INJECTION_PAYLOADS } from '../test/injectionPayloads';
import { EXPORT_PATHS, exportDesign } from './exportDesign';

const mainTf = (design: unknown): string => {
  const result = exportDesign(design);
  if (!result.ok) throw new Error(result.error);
  expect(result.files.map((file) => file.path)).toEqual(['main.tf']);
  return result.files[0]?.content ?? '';
};
const withLabels = (...labels: string[]) => ({
  ...adrExampleDesign,
  edges: [],
  blocks: labels.map((label, i) => ({ ...adrExampleDesign.blocks[1], id: `blk_${i}`, label })),
});
const code = (text: string) => text.split('\n').filter((line) => !line.startsWith('#'));

describe('exportDesign', () => {
  it('começa com o aviso, o bloco terraform e o provider com versões fixadas', () => {
    expect(mainTf({ ...adrExampleDesign, blocks: [], edges: [] })).toBe(
      [
        '# Gerado pelo AWS Cost Playground a partir de um design.',
        '# É um ponto de partida, sem garantia: revise cada recurso antes de aplicar na sua conta.',
        '# Os custos mostrados no produto são estimativa, não cotação oficial da AWS.',
        '# Este arquivo não contém credenciais nem senhas; não as escreva aqui.',
        '#',
        '# Blocos exportados: 0 de 0.',
        'terraform {',
        '  required_version = "~> 1.16.0"',
        '',
        '  required_providers {',
        '    aws = {',
        '      "source"  = "hashicorp/aws"',
        '      "version" = "~> 6.73"',
        '    }',
        '  }',
        '}',
        '',
        'variable "aws_region" {',
        '  description = "Região da AWS onde os recursos são criados."',
        '  type        = string',
        '  default     = "us-east-1"',
        '}',
        '',
        'provider "aws" {',
        '  region = var.aws_region',
        '',
        '  default_tags {',
        '    tags = {',
        '      "generated-by" = "aws-cost-playground"',
        '      "managed-by"   = "terraform"',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('a região do design vira o padrão da variável', () => {
    expect(mainTf({ ...adrExampleDesign, region: 'sa-east-1' })).toContain(
      '  default     = "sa-east-1"',
    );
  });

  it('bloco sem gerador real vira comentário e entra na lista de não exportados', () => {
    const text = mainTf(adrExampleDesign);
    expect(text).toContain(
      [
        '# Blocos exportados: 0 de 2. Não exportados:',
        '# - aws.s3 "Uploads": sem gerador nesta versão',
        '# - aws.lambda "API handler": sem gerador nesta versão',
      ].join('\n'),
    );
    expect(text).toContain(
      [
        '# Bloco aws.s3 "Uploads" (uploads)',
        '# Não suportado ainda: este bloco não gera recursos nesta versão do export.',
      ].join('\n'),
    );
  });

  it('bloco de tipo fora do contrato não some: sai como comentário com o motivo', () => {
    const design = withLabels('x');
    const text = mainTf({ ...design, blocks: [{ ...design.blocks[0], type: 'aws.eks' }] });
    expect(text).toContain('# - aws.eks "x": tipo de bloco fora do contrato');
    expect(text).toContain('# Bloco aws.eks "x": não exportado, tipo de bloco fora do contrato.');
  });

  it('é determinístico e não depende da ordem dos blocos e das arestas no documento', () => {
    const edge = (id: string, source: string, target: string) => ({
      ...adrExampleDesign.edges[0],
      id,
      source,
      target,
    });
    const blocks = withLabels('Fila', 'fila', 'Outra').blocks;
    const edges = [edge('edg_a', 'blk_0', 'blk_1'), edge('edg_b', 'blk_2', 'client')];
    const first = mainTf({ ...adrExampleDesign, blocks, edges });
    expect(mainTf({ ...adrExampleDesign, blocks, edges })).toBe(first);
    expect(
      mainTf({ ...adrExampleDesign, blocks: [...blocks].reverse(), edges: [...edges].reverse() }),
    ).toBe(first);
    expect(first).toContain('# Bloco aws.s3 "fila" (fila_2)');
  });

  it.each(INJECTION_PAYLOADS)('rótulo com a carga "%s" só aparece em comentário', (_name, p) => {
    const label = p.slice(0, 80);
    const text = mainTf(withLabels(label, label));
    expect(code(text)).toEqual(code(mainTf(withLabels('ok', 'ok'))));
    expect(text.split('\n')).toHaveLength(mainTf(withLabels('ok', 'ok')).split('\n').length);
    expect(text.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
  });

  it.each([
    ['não é objeto', null],
    ['rótulo acima do limite', withLabels('x'.repeat(81))],
    [
      'id de bloco com aspas',
      { ...withLabels('x'), blocks: [{ ...withLabels('x').blocks[0], id: 'blk_"' }] },
    ],
    ['região fora da lista', { ...adrExampleDesign, region: 'us-east-1"\n}' }],
    [
      'uso não finito',
      {
        ...withLabels('x'),
        blocks: [{ ...withLabels('x').blocks[0], overrides: { storageGb: Infinity } }],
      },
    ],
  ])('recusa design inválido: %s', (_name, design) => {
    expect(exportDesign(design)).toEqual({ ok: false, error: 'invalid-design' });
  });

  it('só produz caminhos da lista fixa', () => {
    expect(EXPORT_PATHS).toEqual(['main.tf']);
  });
});
