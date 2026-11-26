"""NAT Gateway (`aws.nat-gateway`): hora por gateway e GB processado do NAT Gateway zonal.

Fora: NAT Gateway regional e o processamento via Transit Gateway ou Cloud WAN (outra
`operation`), banda provisionada, NAT privado e a transferência de dados. Mensagens de erro levam
só o SKU do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence

from app.model import Price, Product, Query, ServiceSpec

_CODE = "AmazonEC2"
_OPERATION = "NatGateway"
# Prefixo regional do `usagetype` na AWS: us-east-1 não tem; as outras regiões, sim.
_USAGE_PREFIX: Mapping[str, str] = {"us-east-1": "", "sa-east-1": "SAE1-"}
# Conjunto fechado: SKU do catálogo -> (usagetype sem prefixo, unidade AWS, unidade, descrição).
_SKUS: Mapping[str, tuple[str, str, str, str]] = {
    "nat-gateway-hours": ("NatGateway-Hours", "Hrs", "hour", "Horas do gateway"),
    "nat-gateway-data-processed": ("NatGateway-Bytes", "GB", "GB", "Dados processados"),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU: `regionCode`, `operation` e `usagetype` com o prefixo da região."""
    raise NotImplementedError


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto na região, sem franquia; SKU sem produto não sai."""
    raise NotImplementedError


SERVICE = ServiceSpec(
    slug="nat-gateway",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
