import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';
import { lambdaTimeoutSeconds } from './lambda';
import { dataPeers } from './links';
import { denyInsecureTransport, policyDocument, policyJson } from './policyDocument';

/** A AWS recomenda visibilidade de seis vezes o tempo limite da função que consome a fila. */
const VISIBILITY_FACTOR = 6;
const MAX_VISIBILITY_SECONDS = 43_200;

/**
 * Fila com criptografia gerenciada pelo SQS e política que nega chamada sem TLS. O mapeamento de
 * origem de evento sai do gerador do Lambda; aqui a visibilidade acompanha o tempo limite de quem consome.
 */
export const sqs: BlockGenerator = ({ block, links }) => {
  const { name } = block;
  const fifo = block.attributes.queueType === 'fifo';
  const timeouts = dataPeers(links, 'source', 'aws.lambda').map(lambdaTimeoutSeconds);
  const visibility = Math.min(MAX_VISIBILITY_SECONDS, VISIBILITY_FACTOR * Math.max(0, ...timeouts));

  return {
    exported: true,
    nodes: [
      hcl.block(
        'resource',
        ['aws_sqs_queue', name],
        [
          // A AWS exige o sufixo `.fifo` no nome de fila FIFO.
          hcl.attr('name', hcl.string(fifo ? `${name}.fifo` : name)),
          ...(fifo ? [hcl.attr('fifo_queue', hcl.bool(true))] : []),
          hcl.attr('sqs_managed_sse_enabled', hcl.bool(true)),
          ...(visibility > 0
            ? [hcl.attr('visibility_timeout_seconds', hcl.number(visibility))]
            : []),
        ],
      ),
      policyDocument(name, [
        denyInsecureTransport('sqs:*', [hcl.ref('aws_sqs_queue', name, 'arn')]),
      ]),
      hcl.block(
        'resource',
        ['aws_sqs_queue_policy', name],
        [
          hcl.attr('queue_url', hcl.ref('aws_sqs_queue', name, 'url')),
          hcl.attr('policy', policyJson(name)),
        ],
      ),
    ],
  };
};
