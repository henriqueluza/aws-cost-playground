import { hcl, type HclNode, type HclValue } from '../hcl';

/**
 * Uma declaração de política de IAM. Ações, principais e a condição são constantes do gerador;
 * os recursos são referências a ARN (`hcl.ref`, ou `hcl.call('format', ...)` sobre uma). Nenhum campo recebe texto do usuário.
 */
export interface PolicyStatement {
  readonly effect?: 'Deny';
  readonly actions: readonly string[];
  readonly resources?: readonly HclValue[];
  readonly principal?: { readonly type: 'Service' | '*'; readonly identifiers: readonly string[] };
  readonly condition?: {
    readonly test: string;
    readonly variable: string;
    readonly values: readonly HclValue[];
  };
}

const strings = (values: readonly string[]): HclValue => hcl.list(values.map(hcl.string));

/**
 * `data "aws_iam_policy_document"`: a política como estrutura conferida pelo provider, sem JSON
 * montado à mão nem `jsonencode`. Rótulos derivados usam `__`, que nenhum nome de bloco contém.
 */
export function policyDocument(label: string, statements: readonly PolicyStatement[]): HclNode {
  return hcl.block(
    'data',
    ['aws_iam_policy_document', label],
    statements.map((statement) =>
      hcl.block(
        'statement',
        [],
        [
          hcl.attr('effect', hcl.string(statement.effect ?? 'Allow')),
          hcl.attr('actions', strings(statement.actions)),
          ...(statement.resources ? [hcl.attr('resources', hcl.list(statement.resources))] : []),
          ...(statement.principal
            ? [
                hcl.block(
                  'principals',
                  [],
                  [
                    hcl.attr('type', hcl.string(statement.principal.type)),
                    hcl.attr('identifiers', strings(statement.principal.identifiers)),
                  ],
                ),
              ]
            : []),
          ...(statement.condition
            ? [
                hcl.block(
                  'condition',
                  [],
                  [
                    hcl.attr('test', hcl.string(statement.condition.test)),
                    hcl.attr('variable', hcl.string(statement.condition.variable)),
                    hcl.attr('values', hcl.list(statement.condition.values)),
                  ],
                ),
              ]
            : []),
        ],
      ),
    ),
  );
}

/** O JSON da política gerada por `policyDocument(label, ...)`. */
export const policyJson = (label: string): HclValue =>
  hcl.ref('data', 'aws_iam_policy_document', label, 'json');

/** Nega qualquer ação do serviço quando a chamada não vem por TLS. */
export const denyInsecureTransport = (
  action: string,
  resources: readonly HclValue[],
): PolicyStatement => ({
  effect: 'Deny',
  actions: [action],
  resources,
  principal: { type: '*', identifiers: ['*'] },
  condition: { test: 'Bool', variable: 'aws:SecureTransport', values: [hcl.string('false')] },
});
