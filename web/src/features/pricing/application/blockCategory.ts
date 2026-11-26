/** Categorias visuais do DESIGN.md ("Categorias dos blocos"); a lista de custo usa só o ícone. */
export type BlockCategoryId = 'compute' | 'data' | 'network' | 'security' | 'ops';

const CATEGORY_BY_TYPE: Readonly<Record<string, BlockCategoryId>> = {
  'aws.ec2': 'compute',
  'aws.ecs': 'compute',
  'aws.lambda': 'compute',
  'aws.rds': 'data',
  'aws.dynamodb': 'data',
  'aws.elasticache': 'data',
  'aws.s3': 'data',
  'aws.sqs': 'data',
  'aws.route53': 'network',
  'aws.cloudfront': 'network',
  'aws.alb': 'network',
  'aws.nat-gateway': 'network',
  'aws.waf': 'security',
  'aws.cognito': 'security',
  'aws.iam': 'security',
  'aws.secrets-manager': 'security',
  'aws.cloudwatch': 'ops',
  'aws.cloudtrail': 'ops',
  'aws.codepipeline': 'ops',
  'aws.cloudformation': 'ops',
};

export const blockCategory = (type: string): BlockCategoryId | null =>
  Object.hasOwn(CATEGORY_BY_TYPE, type) ? (CATEGORY_BY_TYPE[type] ?? null) : null;
