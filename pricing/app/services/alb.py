"""ALB (`aws.alb`): hora do Application Load Balancer e LCU-hora usada.

Fora: LCU reservada, trust store (mTLS), ALB em Outposts, a franquia de 12 meses de conta nova e
os outros tipos de balanceador (Classic, Network, Gateway), que dividem o `usagetype` mas não a
`operation`. Mensagens de erro levam só o SKU do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence

from app.model import Price, Product, Query, ServiceSpec

_CODE = "AWSELB"
_OPERATION = "LoadBalancing:Application"
# Prefixo regional do `usagetype` na AWS: us-east-1 não tem; as outras regiões, sim.
_USAGE_PREFIX: Mapping[str, str] = {"us-east-1": "", "sa-east-1": "SAE1-"}
# Conjunto fechado: SKU do catálogo -> (usagetype sem prefixo, unidade AWS, unidade, descrição).
_SKUS: Mapping[str, tuple[str, str, str, str]] = {
    "alb-hours": ("LoadBalancerUsage", "Hrs", "hour", "Horas do balanceador"),
    "alb-lcu-hours": ("LCUUsage", "LCU-Hrs", "LCU-hour", "LCU-hora usadas"),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU: `regionCode`, `operation` e `usagetype` com o prefixo da região."""
    raise NotImplementedError


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto na região, sem franquia; SKU sem produto não sai."""
    raise NotImplementedError


SERVICE = ServiceSpec(
    slug="alb", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
