import { hcl, renderHcl, type HclNode } from '../model/hcl';
import { bodies, plain, value } from './generatorHarness';

/** Atributo com nome de segredo recebendo um literal. `http_tokens` é o IMDSv2 do EC2, não um segredo. */
export const SENSITIVE_LITERAL =
  /^\s*(?!http_tokens\b)\w*(password|secret|token|private_key|access_key)\w*\s*=\s*"/im;

/** Ações e recursos com `*` nas declarações `Allow` de todas as políticas geradas, como texto de HCL. */
export function allowedWildcards(nodes: readonly HclNode[]): string[] {
  return bodies(nodes, 'data', 'aws_iam_policy_document')
    .flatMap((document) => bodies(document, 'statement'))
    .filter((statement) => plain(value(statement, 'effect')) !== 'Deny')
    .flatMap((statement) =>
      ['actions', 'resources'].flatMap((name) => {
        const list = value(statement, name);
        return list?.kind === 'list' ? list.items : [];
      }),
    )
    .map((item) =>
      renderHcl([hcl.attr('v', item)])
        .slice(4)
        .trimEnd(),
    )
    .filter((text) => text.includes('*'));
}
