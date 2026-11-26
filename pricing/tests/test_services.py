import re

import pytest

from app.model import Query, ServiceSpec
from app.services import SERVICES

EXPECTED = {
    "alb": "AWSELB",
    "cloudfront": "AmazonCloudFront",
    "cloudtrail": "AWSCloudTrail",
    "cloudwatch": "AmazonCloudWatch",
    "codepipeline": "AWSCodePipeline",
    "cognito": "AmazonCognito",
    "data-transfer": "AWSDataTransfer",
    "dynamodb": "AmazonDynamoDB",
    "ec2": "AmazonEC2",
    "elasticache": "AmazonElastiCache",
    "lambda": "AWSLambda",
    "nat-gateway": "AmazonEC2",
    "rds": "AmazonRDS",
    "route53": "AmazonRoute53",
    "s3": "AmazonS3",
    "secrets-manager": "AWSSecretsManager",
    "sqs": "AWSQueueService",
    "waf": "awswaf",
}


def test_services_slugs_unique_sorted_and_valid() -> None:
    slugs = [s.slug for s in SERVICES]
    assert len(slugs) == 18
    assert len(set(slugs)) == len(slugs)
    assert slugs == sorted(slugs)
    assert all(re.fullmatch(r"[a-z][a-z0-9-]{0,39}", slug) for slug in slugs)


def test_service_codes() -> None:
    assert {s.slug: s.service_code for s in SERVICES} == EXPECTED


@pytest.mark.parametrize("slug", ["iam", "cloudformation", "ecs"])
def test_zero_cost_services_absent(slug: str) -> None:
    assert slug not in {s.slug for s in SERVICES}


@pytest.mark.parametrize("region", ["us-east-1", "sa-east-1"])
@pytest.mark.parametrize("spec", SERVICES, ids=lambda s: s.slug)
def test_service_contract(spec: ServiceSpec, region: str) -> None:
    # Vale para o serviço provisório e para o implementado: o bloco não edita este arquivo.
    queries = spec.queries(region)
    assert isinstance(queries, tuple)
    assert all(isinstance(query, Query) for query in queries)
    assert all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", sku) for sku in spec.expected_skus)
