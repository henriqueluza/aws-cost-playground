"""EC2 (`aws.ec2`): instâncias On-Demand por hora e volume EBS gp3 por GB-mês.

Entra: os tipos do contrato em Linux, tenancy compartilhada, sem software pré-instalado,
capacidade Used e mercado On-Demand; o gp3 por GB-mês, com o IOPS e a vazão incluídos no volume.
Sem franquia: a de 12 meses do EC2 não entra.

Filtros: cada tipo tem cerca de 60 produtos por região (SO, tenancy, software, capacidade).
Used, UnusedCapacityReservation e AllocatedCapacityReservation têm o mesmo preço e passariam em
silêncio; `marketoption=OnDemand` barra o CapacityBlock. No EBS, `group` separa o gp3 Storage do
IOPS e do Throughput, que dividem `volumeApiName`; `usagetype` muda por região e não serve. O
`GetProducts` real traz também os termos Reserved, que `parse_product` ignora.

Fora: créditos de CPU unlimited, IOPS e vazão provisionados acima do incluído, snapshots, outros
SOs e tenancies, Reserved, Savings Plans, Spot e CapacityBlock. Mensagens de erro levam só o SKU
do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec, region_filter
from app.products import tiers

_CODE = "AmazonEC2"
# Ordem do contrato (`contracts/blocks.json`).
_INSTANCE_TYPES = (
    "t3.micro",
    "t3.small",
    "t3.medium",
    "t3.large",
    "t4g.micro",
    "t4g.small",
    "t4g.medium",
    "m5.large",
    "m5.xlarge",
    "c5.large",
    "r5.large",
)
# Linux On-Demand, compartilhada, sem software e capacidade usada; na ordem dos filtros.
_INSTANCE_ATTRIBUTES: Mapping[str, str] = {
    "operatingSystem": "Linux",
    "tenancy": "Shared",
    "preInstalledSw": "NA",
    "capacitystatus": "Used",
    "marketoption": "OnDemand",
}


@dataclass(frozen=True, slots=True)
class _Sku:
    """Atributos que filtram a consulta e selecionam o produto, e as unidades."""

    attributes: Mapping[str, str]
    aws_unit: str
    unit: str
    description: str


# Conjunto fechado, na ordem das consultas; os atributos seguem a ordem dos filtros.
_SKUS: Mapping[str, _Sku] = {
    **{
        f"ec2-instance-{t}": _Sku(
            attributes={"instanceType": t, **_INSTANCE_ATTRIBUTES},
            aws_unit="Hrs",
            unit="hour",
            description=f"Instância {t} (Linux)",
        )
        for t in _INSTANCE_TYPES
    },
    "ec2-ebs-gp3": _Sku(
        attributes={"volumeApiName": "gp3", "group": "EBS Storage"},
        aws_unit="GB-Mo",
        unit="GB-month",
        description="Volume EBS gp3",
    ),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região, com os atributos que separam o produto."""
    return tuple(
        Query(_CODE, (region_filter(region), *(Filter(k, v) for k, v in s.attributes.items())))
        for s in _SKUS.values()
    )


def _select(products: Sequence[Product], region: str, **attributes: str) -> list[Product]:
    """Produtos da região com todos os atributos iguais: o TERM_MATCH refeito sobre a resposta."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == region
        and all(p.attributes.get(k) == v for k, v in attributes.items())
    ]


def _price(products: Sequence[Product], region: str, sku: str) -> Price | None:
    spec = _SKUS[sku]
    found = _select(products, region, **spec.attributes)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != spec.aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); faixa grátis aqui seria franquia não declarada.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, spec.description, spec.unit, price_tiers)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto na região; SKU sem produto não sai."""
    prices = (_price(products, region, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="ec2", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
