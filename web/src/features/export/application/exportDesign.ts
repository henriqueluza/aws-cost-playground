import { designDocumentSchema } from '../../../shared/lib/design';
import { buildExportModel } from '../model/exportBlocks';
import { BLOCK_GENERATORS } from '../model/generators';
import { hcl, renderHcl, type HclNode } from '../model/hcl';

/** Caminhos que o export pode produzir. Lista fixa: nenhum caminho sai de dado do usuário. */
export const EXPORT_PATHS = ['main.tf'] as const;
export type ExportPath = (typeof EXPORT_PATHS)[number];

export interface ExportFile {
  readonly path: ExportPath;
  readonly content: string;
}

export type ExportResult =
  | { readonly ok: true; readonly files: readonly ExportFile[] }
  | { readonly ok: false; readonly error: 'invalid-design' };

/** Mesmas versões de `infra/`: Terraform 1.16 e provider AWS 6.73 ou correção posterior da série 6. */
export const TERRAFORM_VERSION = '~> 1.16.0';
export const AWS_PROVIDER_VERSION = '~> 6.73';

const HEADER = [
  'Gerado pelo AWS Cost Playground a partir de um design.',
  'É um ponto de partida, sem garantia: revise cada recurso antes de aplicar na sua conta.',
  'Os custos mostrados no produto são estimativa, não cotação oficial da AWS.',
  'Este arquivo não contém credenciais nem senhas; não as escreva aqui.',
] as const;

const REJECTION = {
  'unknown-type': 'tipo de bloco fora do contrato',
  'invalid-attribute': 'atributo fora das opções do contrato',
} as const;

function preamble(region: string): HclNode[] {
  return [
    hcl.block(
      'terraform',
      [],
      [
        hcl.attr('required_version', hcl.string(TERRAFORM_VERSION)),
        hcl.block(
          'required_providers',
          [],
          [
            hcl.attr(
              'aws',
              hcl.map({
                source: hcl.string('hashicorp/aws'),
                version: hcl.string(AWS_PROVIDER_VERSION),
              }),
            ),
          ],
        ),
      ],
    ),
    hcl.block(
      'variable',
      ['aws_region'],
      [
        hcl.attr('description', hcl.string('Região da AWS onde os recursos são criados.')),
        hcl.attr('type', hcl.ref('string')),
        hcl.attr('default', hcl.string(region)),
      ],
    ),
    hcl.block(
      'provider',
      ['aws'],
      [
        hcl.attr('region', hcl.ref('var', 'aws_region')),
        hcl.block(
          'default_tags',
          [],
          [
            hcl.attr(
              'tags',
              hcl.map({
                'generated-by': hcl.string('aws-cost-playground'),
                'managed-by': hcl.string('terraform'),
              }),
            ),
          ],
        ),
      ],
    ),
  ];
}

/**
 * Export do design para Terraform (PRD F27): função pura e determinística, sem LLM, rede ou relógio.
 * Recebe o documento como dado não confiável e o valida de novo. Bloco sem gerador real, de tipo
 * desconhecido ou com atributo fora do contrato aparece como comentário e na lista do cabeçalho.
 */
export function exportDesign(input: unknown): ExportResult {
  const parsed = designDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid-design' };
  const design = parsed.data;
  const model = buildExportModel(design);

  const sections: HclNode[] = [];
  const skipped: string[] = [];
  for (const block of model.blocks) {
    const output = BLOCK_GENERATORS[block.type]({
      block,
      links: model.links.get(block.id) ?? [],
      blocks: model.blocks,
      region: design.region,
    });
    const title = `${block.type} "${block.label}"`;
    if (!output.exported) skipped.push(`${title}: sem gerador nesta versão`);
    sections.push(hcl.comment(`Bloco ${title} (${block.name})`), ...output.nodes);
  }
  for (const block of model.rejected) {
    const title = `${block.type} "${block.label}"`;
    skipped.push(`${title}: ${REJECTION[block.reason]}`);
    sections.push(hcl.comment(`Bloco ${title}: não exportado, ${REJECTION[block.reason]}.`));
  }

  const total = design.blocks.length;
  const summary =
    skipped.length === 0
      ? [`Blocos exportados: ${total} de ${total}.`]
      : [
          `Blocos exportados: ${total - skipped.length} de ${total}. Não exportados:`,
          ...skipped.map((line) => `- ${line}`),
        ];
  const header = [...HEADER, '', ...summary].map((line) => hcl.comment(line));
  const content = renderHcl([...header, ...preamble(design.region), ...sections]);
  return { ok: true, files: [{ path: 'main.tf', content }] };
}
