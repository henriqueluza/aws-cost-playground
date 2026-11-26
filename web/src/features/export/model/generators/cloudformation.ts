import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';

/**
 * CloudFormation: só um comentário. O arquivo exportado já é a infraestrutura como código do
 * design; uma stack do CloudFormation descreveria os mesmos recursos uma segunda vez.
 */
export const cloudformation: BlockGenerator = () => ({
  exported: true,
  nodes: [
    hcl.comment(
      'Nenhum recurso: este arquivo Terraform já é a infraestrutura como código do design.',
    ),
    hcl.comment('Uma stack do CloudFormation descreveria os mesmos recursos uma segunda vez.'),
  ],
});
