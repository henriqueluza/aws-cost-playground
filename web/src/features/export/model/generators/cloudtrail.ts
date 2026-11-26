import type { BlockGenerator } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { ordinalId } from './network';
import {
  denyInsecureTransport,
  policyDocument,
  policyJson,
  type PolicyStatement,
} from './policyDocument';
import { bucketObjects, bucketRef, privateBucket } from './privateBucket';

const resource = (type: string, name: string, body: readonly HclNode[]): HclNode =>
  hcl.block('resource', [type, name], body);

/**
 * CloudTrail: uma trilha de todas as regiões, com validação dos arquivos de log, gravando num
 * bucket próprio: privado, criptografado, só por TLS e que só aceita escrita desta trilha (a
 * condição `aws:SourceArn` impede que outra conta use o CloudTrail para gravar aqui).
 */
export const cloudtrail: BlockGenerator = (input) => {
  const { block } = input;
  const id = ordinalId(input, 'trilha');
  const logs = `${block.name}__logs`;
  const bucket = (attribute: 'id' | 'arn') => bucketRef(logs, attribute);
  const account = hcl.ref('data', 'aws_caller_identity', block.name, 'account_id');
  const fromThisTrail: Pick<PolicyStatement, 'principal' | 'condition'> = {
    principal: { type: 'Service', identifiers: ['cloudtrail.amazonaws.com'] },
    condition: {
      test: 'StringEquals',
      variable: 'aws:SourceArn',
      values: [
        hcl.call('format', [
          hcl.string(`arn:%s:cloudtrail:%s:%s:trail/${id}`),
          hcl.ref('data', 'aws_partition', block.name, 'partition'),
          hcl.ref('var', 'aws_region'),
          account,
        ]),
      ],
    },
  };
  return {
    exported: true,
    nodes: [
      hcl.comment('Custo: o bucket dos logs cobra armazenamento que o painel não mostra, e nada'),
      hcl.comment('expira sozinho: defina uma regra de ciclo de vida conforme a retenção exigida.'),
      hcl.comment(
        'Só eventos de gerenciamento, numa trilha: o design não diz quais recursos teriam',
      ),
      hcl.comment('eventos de dados. Os logs não vão para o CloudWatch Logs.'),
      hcl.block('data', ['aws_caller_identity', block.name], []),
      hcl.block('data', ['aws_partition', block.name], []),
      ...privateBucket(logs, `${id}-logs-`),
      policyDocument(logs, [
        { actions: ['s3:GetBucketAcl'], resources: [bucket('arn')], ...fromThisTrail },
        // O único curinga é o nome do objeto, dentro do prefixo de logs desta conta.
        {
          actions: ['s3:PutObject'],
          resources: [bucketObjects(logs, '%s/AWSLogs/%s/*', account)],
          ...fromThisTrail,
        },
        denyInsecureTransport('s3:*', [bucket('arn'), bucketObjects(logs)]),
      ]),
      resource('aws_s3_bucket_policy', logs, [
        hcl.attr('bucket', bucket('id')),
        hcl.attr('policy', policyJson(logs)),
        // Em paralelo com o bloqueio de acesso público, a API do S3 às vezes recusa por conflito.
        hcl.attr('depends_on', hcl.list([hcl.ref('aws_s3_bucket_public_access_block', logs)])),
      ]),
      resource('aws_cloudtrail', block.name, [
        hcl.attr('name', hcl.string(id)),
        hcl.attr('s3_bucket_name', bucket('id')),
        hcl.attr('is_multi_region_trail', hcl.bool(true)),
        hcl.attr('include_global_service_events', hcl.bool(true)),
        hcl.attr('enable_log_file_validation', hcl.bool(true)),
        hcl.attr('depends_on', hcl.list([hcl.ref('aws_s3_bucket_policy', logs)])),
      ]),
    ],
  };
};
