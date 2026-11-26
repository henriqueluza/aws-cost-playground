"""Registro dos serviços com preço: um módulo por serviço, cada um exporta `SERVICE`.

Os 17 blocos de nível A e B. IAM, CloudFormation e ECS custam zero e não têm arquivo.
"""

from app.model import ServiceSpec
from app.services import (
    alb,
    cloudfront,
    cloudtrail,
    cloudwatch,
    codepipeline,
    cognito,
    dynamodb,
    ec2,
    elasticache,
    lambda_,
    nat_gateway,
    rds,
    route53,
    s3,
    secrets_manager,
    sqs,
    waf,
)

SERVICES: tuple[ServiceSpec, ...] = (
    alb.SERVICE,
    cloudfront.SERVICE,
    cloudtrail.SERVICE,
    cloudwatch.SERVICE,
    codepipeline.SERVICE,
    cognito.SERVICE,
    dynamodb.SERVICE,
    ec2.SERVICE,
    elasticache.SERVICE,
    lambda_.SERVICE,
    nat_gateway.SERVICE,
    rds.SERVICE,
    route53.SERVICE,
    s3.SERVICE,
    secrets_manager.SERVICE,
    sqs.SERVICE,
    waf.SERVICE,
)
