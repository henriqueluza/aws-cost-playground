"""RDS (`aws.rds`), motores PostgreSQL e MySQL: instância sob demanda por hora (Single-AZ e
Multi-AZ com um standby), armazenamento gp3 e backup além do incluído.

Fora: Aurora, MariaDB, Oracle, SQL Server e Db2; armazenamento gp2, io1 e io2; IOPS e throughput
extras do gp3; Multi-AZ com standbys legíveis (cluster); RDS Custom e Outposts; Extended Support;
créditos Unlimited de T3/T4g; instâncias reservadas.

Toda consulta filtra `usagetype`: a AWS publica, com os mesmos atributos da instância, um produto
`UnusedBox:<classe>`, e só o usagetype o separa. Em sa-east-1 o usagetype leva o prefixo da
região (`SAE1-`); em us-east-1 não leva. O RDS não tem franquia nem faixas. Mensagens de erro
levam só o SKU do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec, region_filter
from app.products import tiers

_CODE = "AmazonRDS"
# Prefixo do usagetype por região; as chaves são as de `app.catalog.REGIONS`.
USAGETYPE_PREFIX: Mapping[str, str] = {"us-east-1": "", "sa-east-1": "SAE1-"}

# Conjuntos fechados. Motor do catálogo -> `databaseEngine` da AWS (também vai na descrição).
_ENGINES: Mapping[str, str] = {"postgres": "PostgreSQL", "mysql": "MySQL"}
_CLASSES = (
    "db.t3.micro",
    "db.t3.small",
    "db.t3.medium",
    "db.t4g.micro",
    "db.t4g.small",
    "db.t4g.medium",
    "db.m5.large",
    "db.r5.large",
)
# Implantação do catálogo -> (deploymentOption, usagetype da instância antes de `:<classe>`,
# usagetype do gp3), todos sem o prefixo da região.
_DEPLOYMENTS: Mapping[str, tuple[str, str, str]] = {
    "single-az": ("Single-AZ", "InstanceUsage", "RDS:GP3-Storage"),
    "multi-az": ("Multi-AZ", "Multi-AZUsage", "RDS:Multi-AZ-GP3-Storage"),
}
# O backup não separa por deploymentOption.
_BACKUP_USAGETYPE = "RDS:ChargedBackupUsage"


@dataclass(frozen=True, slots=True)
class _Sku:
    """Atributos que filtram a consulta e selecionam o produto, e unidades.

    `attributes` vem na ordem dos filtros, sem `usagetype`; `usagetype` não leva o prefixo da
    região, que entra em `queries` e em `build`.
    """

    attributes: Mapping[str, str]
    usagetype: str
    aws_unit: str
    unit: str
    description: str


def _engine_skus(engine: str, name: str) -> dict[str, _Sku]:
    """SKUs de um motor na ordem das consultas: instâncias, gp3 e backup."""
    instances = {
        f"rds-{engine}-{klass}-{deployment}": _Sku(
            attributes={"databaseEngine": name, "deploymentOption": option},
            usagetype=f"{usage}:{klass}",
            aws_unit="Hrs",
            unit="instance-hour",
            description=f"Instância {klass} {name} {option}",
        )
        for klass in _CLASSES
        for deployment, (option, usage, _) in _DEPLOYMENTS.items()
    }
    storage = {
        f"rds-{engine}-gp3-{deployment}": _Sku(
            attributes={"databaseEngine": name, "deploymentOption": option},
            usagetype=gp3,
            aws_unit="GB-Mo",
            unit="GB-month",
            description=f"Armazenamento gp3 {name} {option}",
        )
        for deployment, (option, _, gp3) in _DEPLOYMENTS.items()
    }
    backup = _Sku(
        attributes={"databaseEngine": name},
        usagetype=_BACKUP_USAGETYPE,
        aws_unit="GB-Mo",
        unit="GB-month",
        description=f"Backup {name} além do incluído",
    )
    return {**instances, **storage, f"rds-{engine}-backup": backup}


# Na ordem das consultas.
_SKUS: Mapping[str, _Sku] = {
    sku: spec
    for engine, name in _ENGINES.items()
    for sku, spec in _engine_skus(engine, name).items()
}


def _attributes(spec: _Sku, region: str) -> dict[str, str]:
    """Atributos do SKU na ordem dos filtros, com o usagetype prefixado para a região."""
    return {**spec.attributes, "usagetype": USAGETYPE_PREFIX[region] + spec.usagetype}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região, com os atributos que separam o produto."""
    return tuple(
        Query(_CODE, (region_filter(region), *(Filter(k, v) for k, v in attributes.items())))
        for attributes in (_attributes(s, region) for s in _SKUS.values())
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
    found = _select(products, region, **_attributes(spec, region))
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != spec.aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); o RDS não tem faixa grátis.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, spec.description, spec.unit, price_tiers)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto na região; SKU sem produto não sai."""
    prices = (_price(products, region, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="rds",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
