import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { INJECTION_PAYLOADS } from '../test/injectionPayloads';
import { BLOCK_GENERATORS } from '../model/generators';
import { notSupportedYet } from '../model/generators/provisional';
import { hcl } from '../model/hcl';
import { EXPORT_PATHS, createExporter, exportDesign } from './exportDesign';

const mainTf = (design: unknown): string => {
  const result = exportDesign(design);
  if (!result.ok) throw new Error(result.error);
  expect(result.files.map((file) => file.path)).toEqual(['main.tf']);
  return result.files[0]?.content ?? '';
};
/** O núcleo sozinho: registro em que S3 e Lambda (os blocos destes testes) não têm gerador real. */
const provisional = createExporter({
  ...BLOCK_GENERATORS,
  'aws.s3': notSupportedYet,
  'aws.lambda': notSupportedYet,
});
const provisionalTf = (design: unknown): string => {
  const result = provisional(design);
  if (!result.ok) throw new Error(result.error);
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
    const text = provisionalTf(adrExampleDesign);
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

  it('bloco com atributo fora das opções do contrato sai como comentário com o motivo', () => {
    const block = { ...adrExampleDesign.blocks[0], attributes: { architecture: 'x86"\n' } };
    const text = mainTf({ ...adrExampleDesign, blocks: [block], edges: [] });
    expect(text).toContain('# - aws.lambda "API handler": atributo fora das opções do contrato');
    expect(text).toContain(
      '# Bloco aws.lambda "API handler": não exportado, atributo fora das opções do contrato.',
    );
  });

  it('chave herdada de Object.prototype em atributo, uso ou override não chega ao arquivo', () => {
    const json = (fields: string) =>
      JSON.parse(
        JSON.stringify(withLabels('x')).replace('"attributes":{', `"attributes":{${fields}`),
      );
    expect(mainTf(json('"__proto__":"${file(1)}",'))).toBe(mainTf(withLabels('x')));
    for (const key of ['constructor', 'toString']) {
      expect(exportDesign(json(`"${key}":"x",`))).toEqual({ ok: false, error: 'invalid-design' });
    }
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
    const text = provisionalTf(withLabels(label, label));
    expect(code(text)).toEqual(code(provisionalTf(withLabels('ok', 'ok'))));
    expect(text.split('\n')).toHaveLength(provisionalTf(withLabels('ok', 'ok')).split('\n').length);
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

  describe('com um gerador real', () => {
    /** Gerador de teste: põe o rótulo num valor e liga o bloco aos pares das suas arestas. */
    const withS3 = (bucketAttribute: string) =>
      createExporter({
        ...BLOCK_GENERATORS,
        'aws.s3': ({ block, links }) => ({
          exported: true,
          nodes: [
            hcl.block(
              'resource',
              ['aws_s3_bucket', block.name],
              [
                hcl.attr(bucketAttribute, hcl.string(block.label)),
                hcl.attr(
                  'depends_on',
                  hcl.list(
                    links.flatMap((l) => (l.peer ? [hcl.ref('aws_s3_bucket', l.peer.name)] : [])),
                  ),
                ),
              ],
            ),
          ],
        }),
      });

    it.each(INJECTION_PAYLOADS)(
      'a carga "%s" no rótulo não cria nem altera linha de código',
      (_n, p) => {
        const exporter = withS3('bucket');
        const files = (label: string) => {
          const result = exporter(withLabels(label));
          if (!result.ok) throw new Error(result.error);
          return code(result.files[0]?.content ?? '');
        };
        const [evil, safe] = [files(p.slice(0, 80)), files('ok')];
        expect(evil).toHaveLength(safe.length);
        const changed = evil.filter((line, i) => line !== safe[i]);
        expect(
          changed.every((line) =>
            /^(resource "aws_s3_bucket" "[a-z][a-z0-9_]*" \{| {2}bucket {5}= ".*")$/.test(line),
          ),
        ).toBe(true);
      },
    );

    it('conta o bloco como exportado e entrega as ligações com o nome do par', () => {
      const design = withLabels('Origem', 'Destino');
      const edges = [
        { ...adrExampleDesign.edges[0], id: 'edg_1', source: 'blk_0', target: 'blk_1' },
      ];
      const result = withS3('bucket')({ ...design, edges });
      const text = result.ok ? (result.files[0]?.content ?? '') : '';
      expect(text).toContain('# Blocos exportados: 2 de 2.');
      expect(text).toContain(
        'resource "aws_s3_bucket" "origem" {\n  bucket     = "Origem"\n  depends_on = [aws_s3_bucket.destino]',
      );
    });

    it('entrega a cada gerador as arestas do design inteiro, por id do bloco', () => {
      const seen: (readonly string[])[] = [];
      const spy = createExporter({
        ...BLOCK_GENERATORS,
        'aws.s3': ({ block, links, designLinks }) => {
          expect(designLinks.get(block.id)).toBe(links);
          seen.push([...designLinks.keys()]);
          return { exported: true, nodes: [] };
        },
      });
      const edges = [
        { ...adrExampleDesign.edges[0], id: 'edg_1', source: 'blk_0', target: 'blk_1' },
      ];
      expect(spy({ ...withLabels('a', 'b'), edges }).ok).toBe(true);
      expect(seen).toEqual([
        ['blk_0', 'blk_1'],
        ['blk_0', 'blk_1'],
      ]);
    });

    it('gerador que lança não gera arquivo nem repassa a exceção', () => {
      const broken = createExporter({
        ...BLOCK_GENERATORS,
        'aws.s3': () => {
          throw new Error('defeito');
        },
      });
      expect(broken(withLabels('x'))).toEqual({ ok: false, error: 'generation-failed' });
    });

    it('nó que o construtor recusa não gera arquivo', () => {
      expect(withS3('bucket" {}')(withLabels('x'))).toEqual({
        ok: false,
        error: 'generation-failed',
      });
    });
  });

  it('só produz caminhos da lista fixa', () => {
    expect(EXPORT_PATHS).toEqual(['main.tf']);
  });
});
