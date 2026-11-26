import type { BlockPricer, BlockType } from '../blockContract';
import { priceAlb } from './alb';
import { priceCloudFormation } from './cloudformation';
import { priceCloudFront } from './cloudfront';
import { priceCloudTrail } from './cloudtrail';
import { priceCloudWatch } from './cloudwatch';
import { priceCodePipeline } from './codepipeline';
import { priceCognito } from './cognito';
import { priceDynamoDb } from './dynamodb';
import { priceEc2 } from './ec2';
import { priceEcs } from './ecs';
import { priceElastiCache } from './elasticache';
import { priceIam } from './iam';
import { priceLambda } from './lambda';
import { priceNatGateway } from './natGateway';
import { priceRds } from './rds';
import { priceRoute53 } from './route53';
import { priceS3 } from './s3';
import { priceSecretsManager } from './secretsManager';
import { priceSqs } from './sqs';
import { priceWaf } from './waf';

/** Registro das funções de preço: um arquivo por bloco. O compilador recusa um bloco do PRD sem função. */
export const BLOCK_PRICERS: Readonly<Record<BlockType, BlockPricer>> = {
  'aws.lambda': priceLambda,
  'aws.s3': priceS3,
  'aws.sqs': priceSqs,
  'aws.dynamodb': priceDynamoDb,
  'aws.ec2': priceEc2,
  'aws.rds': priceRds,
  'aws.elasticache': priceElastiCache,
  'aws.cloudfront': priceCloudFront,
  'aws.alb': priceAlb,
  'aws.cloudwatch': priceCloudWatch,
  'aws.nat-gateway': priceNatGateway,
  'aws.waf': priceWaf,
  'aws.cognito': priceCognito,
  'aws.secrets-manager': priceSecretsManager,
  'aws.cloudtrail': priceCloudTrail,
  'aws.route53': priceRoute53,
  'aws.codepipeline': priceCodePipeline,
  'aws.iam': priceIam,
  'aws.cloudformation': priceCloudFormation,
  'aws.ecs': priceEcs,
};
