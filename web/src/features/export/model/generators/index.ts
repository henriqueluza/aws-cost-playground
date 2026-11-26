import type { BlockType } from '../../../pricing';
import type { BlockGenerator } from '../generator';
import { alb } from './alb';
import { cloudwatch } from './cloudwatch';
import { ec2 } from './ec2';
import { elasticache } from './elasticache';
import { natGateway } from './nat-gateway';
import { notSupportedYet } from './provisional';
import { rds } from './rds';

/**
 * Registro dos geradores: um por tipo de bloco, cada um no seu arquivo. O compilador recusa um
 * bloco do PRD sem entrada. Os que ainda não têm gerador real ficam no provisório (#65, #66 e #67).
 */
export const BLOCK_GENERATORS: Readonly<Record<BlockType, BlockGenerator>> = {
  'aws.lambda': notSupportedYet,
  'aws.s3': notSupportedYet,
  'aws.sqs': notSupportedYet,
  'aws.dynamodb': notSupportedYet,
  'aws.ec2': ec2,
  'aws.rds': rds,
  'aws.elasticache': elasticache,
  'aws.cloudfront': notSupportedYet,
  'aws.alb': alb,
  'aws.cloudwatch': cloudwatch,
  'aws.nat-gateway': natGateway,
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
