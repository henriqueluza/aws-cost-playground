import type { BlockPricer, BlockType } from '../blockContract';
import { priceAlb } from './alb';
import { priceCloudFront } from './cloudfront';
import { priceCloudWatch } from './cloudwatch';
import { priceDynamoDb } from './dynamodb';
import { priceEc2 } from './ec2';
import { priceElastiCache } from './elasticache';
import { priceLambda } from './lambda';
import { priceNatGateway } from './natGateway';
import { priceRds } from './rds';
import { priceS3 } from './s3';
import { priceSqs } from './sqs';

/** Registro das funções de preço: um arquivo por bloco. Os níveis B e C entram na continuação. */
export const BLOCK_PRICERS: Readonly<Partial<Record<BlockType, BlockPricer>>> = {
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
};
