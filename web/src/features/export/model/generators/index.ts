import type { BlockType } from '../../../pricing';
import type { BlockGenerator } from '../generator';
import { cloudfront } from './cloudfront';
import { ec2 } from './ec2';
import { elasticache } from './elasticache';
import { notSupportedYet } from './provisional';
import { rds } from './rds';
import { s3 } from './s3';

/**
 * Registro dos geradores: um por tipo de bloco, cada um no seu arquivo. O compilador recusa um
 * bloco do PRD sem entrada. Os que ainda não têm gerador real ficam no provisório (#65, #66 e #67).
 */
export const BLOCK_GENERATORS: Readonly<Record<BlockType, BlockGenerator>> = {
  'aws.lambda': notSupportedYet,
  'aws.s3': s3,
  'aws.sqs': notSupportedYet,
  'aws.dynamodb': notSupportedYet,
  'aws.ec2': ec2,
  'aws.rds': rds,
  'aws.elasticache': elasticache,
  'aws.cloudfront': cloudfront,
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
