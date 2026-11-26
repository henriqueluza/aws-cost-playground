import type { BlockType } from '../../../pricing';
import type { BlockGenerator } from '../generator';
import { notSupportedYet } from './provisional';

/**
 * Registro dos geradores: um por tipo de bloco, cada um no seu arquivo. O compilador recusa um
 * bloco do PRD sem entrada. Hoje todos são provisórios; os reais chegam com as #65, #66 e #67.
 */
export const BLOCK_GENERATORS: Readonly<Record<BlockType, BlockGenerator>> = {
  'aws.lambda': notSupportedYet,
  'aws.s3': notSupportedYet,
  'aws.sqs': notSupportedYet,
  'aws.dynamodb': notSupportedYet,
  'aws.ec2': notSupportedYet,
  'aws.rds': notSupportedYet,
  'aws.elasticache': notSupportedYet,
  'aws.cloudfront': notSupportedYet,
  'aws.alb': notSupportedYet,
  'aws.cloudwatch': notSupportedYet,
  'aws.nat-gateway': notSupportedYet,
  'aws.waf': notSupportedYet,
  'aws.cognito': notSupportedYet,
  'aws.secrets-manager': notSupportedYet,
  'aws.cloudtrail': notSupportedYet,
  'aws.route53': notSupportedYet,
  'aws.codepipeline': notSupportedYet,
  'aws.iam': notSupportedYet,
  'aws.cloudformation': notSupportedYet,
  'aws.ecs': notSupportedYet,
};

/** Tipos que ainda estão no gerador provisório, na ordem do registro. */
export const PROVISIONAL_BLOCK_TYPES: readonly BlockType[] = (
  Object.keys(BLOCK_GENERATORS) as BlockType[]
).filter((type) => BLOCK_GENERATORS[type] === notSupportedYet);
