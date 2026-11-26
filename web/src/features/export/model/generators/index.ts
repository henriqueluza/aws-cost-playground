import type { BlockType } from '../../../pricing';
import type { BlockGenerator } from '../generator';
import { alb } from './alb';
import { cloudformation } from './cloudformation';
import { cloudfront } from './cloudfront';
import { cloudtrail } from './cloudtrail';
import { cloudwatch } from './cloudwatch';
import { codepipeline } from './codepipeline';
import { cognito } from './cognito';
import { dynamodb } from './dynamodb';
import { ec2 } from './ec2';
import { ecs } from './ecs';
import { elasticache } from './elasticache';
import { iam } from './iam';
import { lambda } from './lambda';
import { natGateway } from './nat-gateway';
import { notSupportedYet } from './provisional';
import { rds } from './rds';
import { route53 } from './route53';
import { s3 } from './s3';
import { secretsManager } from './secrets-manager';
import { sqs } from './sqs';
import { waf } from './waf';

/**
 * Registro dos geradores: um por tipo de bloco, cada um no seu arquivo. O compilador recusa um
 * bloco do PRD sem entrada. Os que ainda não têm gerador real ficam no provisório (#65, #66 e #67).
 */
export const BLOCK_GENERATORS: Readonly<Record<BlockType, BlockGenerator>> = {
  'aws.lambda': lambda,
  'aws.s3': s3,
  'aws.sqs': sqs,
  'aws.dynamodb': dynamodb,
  'aws.ec2': ec2,
  'aws.rds': rds,
  'aws.elasticache': elasticache,
  'aws.cloudfront': cloudfront,
  'aws.alb': alb,
  'aws.cloudwatch': cloudwatch,
  'aws.nat-gateway': natGateway,
  'aws.waf': waf,
  'aws.cognito': cognito,
  'aws.secrets-manager': secretsManager,
  'aws.cloudtrail': cloudtrail,
  'aws.route53': route53,
  'aws.codepipeline': codepipeline,
  'aws.iam': iam,
  'aws.cloudformation': cloudformation,
  'aws.ecs': ecs,
};

/** Tipos que ainda estão no gerador provisório, na ordem do registro. */
export const PROVISIONAL_BLOCK_TYPES: readonly BlockType[] = (
  Object.keys(BLOCK_GENERATORS) as BlockType[]
).filter((type) => BLOCK_GENERATORS[type] === notSupportedYet);
