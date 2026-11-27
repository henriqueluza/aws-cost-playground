"""Limites de designs da #386 (decisão da #277, opção c): 10 designs de até 100 KB.

Mede, do jeito que a API mede (`doc_size_bytes`: bytes UTF-8 do JSON compacto), o template de 20
blocos e os três cenários de `contracts/`, e confere a folga. Confere também o limite de tamanho
da estimativa para o template (decisão 21 do autor: manter, com esta conferência).
"""

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from app.contracts import get_contracts
from app.design_document import (
    MAX_DESCRIPTION_LENGTH,
    MAX_LABEL_LENGTH,
    DesignDocument,
)
from app.designs.schemas import MAX_DOC_BYTES, doc_size_bytes
from app.designs.service import MAX_DESIGNS
from app.estimates.prompt import MAX_TOKENS, build_plan
from app.estimates.schemas import EstimateIn
from app.routing import MAX_BODY_BYTES

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
TEMPLATE = "templates/reference.json"
SCENARIOS = (
    "scenarios/api-serverless.json",
    "scenarios/app-classico.json",
    "scenarios/pipeline-de-filas.json",
)
WIDEST = "😀"  # 4 bytes em UTF-8: o caractere mais caro que a descrição e o rótulo aceitam
MARGIN = 2  # folga pedida na Issue: o documento cabe pelo menos duas vezes no teto


def load(name: str) -> dict[str, Any]:
    document: dict[str, Any] = json.loads((CONTRACTS / name).read_text("utf-8"))
    return document


def size(document: dict[str, Any]) -> int:
    return doc_size_bytes(DesignDocument.model_validate(document))


def worst_text(document: dict[str, Any]) -> dict[str, Any]:
    """Descrição no limite de 2.000 e todo rótulo no limite de 80, com caracteres de 4 bytes."""
    worst = copy.deepcopy(document)
    worst["workload"]["description"] = WIDEST * MAX_DESCRIPTION_LENGTH
    for block in worst["blocks"]:
        block["label"] = WIDEST * MAX_LABEL_LENGTH
    return worst


def test_os_limites_sao_os_da_decisao_e_a_particao_cheia_tem_1_mb() -> None:
    assert (MAX_DESIGNS, MAX_DOC_BYTES) == (10, 100_000)
    assert MAX_DESIGNS * MAX_DOC_BYTES == 1_000_000  # eram 50 de 350.000: 17,5 MB


def test_o_template_tem_20_blocos_e_cabe_no_teto_mais_de_12_vezes() -> None:
    template = load(TEMPLATE)
    assert len(template["blocks"]) == 20
    assert size(template) == 7_987  # medido em 27/11/2026; se o template mudar, refaça a tabela
    assert size(template) * 12 <= MAX_DOC_BYTES


@pytest.mark.parametrize("name", [TEMPLATE, *SCENARIOS])
def test_template_e_cenarios_cabem_com_o_dobro_de_folga_no_pior_texto(name: str) -> None:
    document = load(name)
    worst = worst_text(document)
    assert size(document) < size(worst)
    assert size(worst) * MARGIN <= MAX_DOC_BYTES
    assert size(worst) <= 22_000  # o maior (template) mede 21.259


def test_o_corpo_maximo_da_requisicao_comporta_o_documento_maximo_e_o_envelope() -> None:
    """O 413 do corpo (`MAX_BODY_BYTES`) é outro limite e não mudou: segue acima do documento."""
    envelope = len(json.dumps({"expectedVersion": 2**53 - 1, "name": WIDEST * 80, "doc": None}))
    assert MAX_DOC_BYTES + envelope <= MAX_BODY_BYTES


def estimate_request(document: dict[str, Any]) -> dict[str, Any]:
    """O pedido que o `web/` monta: tipo e atributos dos blocos, arestas e a descrição."""
    return {
        "region": document["region"],
        "description": document["workload"]["description"],
        "blocks": [{k: b[k] for k in ("id", "type", "attributes")} for b in document["blocks"]],
        "edges": [{k: e[k] for k in ("id", "source", "target", "kind")} for e in document["edges"]],
    }


@pytest.mark.parametrize("text", ["template", "pior-texto"])
def test_estimativa_do_template_passa_no_limite_com_o_dobro_de_folga(text: str) -> None:
    """Decisão 21: o limite da estimativa (413 `too_large`) fica como está.

    O que decide o 413 em `prepare` é a saída esperada contra `MAX_TOKENS`; o corpo cru tem o
    teto de `MAX_BODY_BYTES`. O template passa nos dois com mais do que o dobro de folga.
    """
    document = load(TEMPLATE)
    assert document["workload"]["description"]  # o template já traz descrição de carga
    request = estimate_request(worst_text(document) if text == "pior-texto" else document)
    plan = build_plan(EstimateIn.model_validate(request), get_contracts())
    assert plan.expected_output_tokens == 1_404  # 20 blocos e 21 arestas do template
    assert plan.expected_output_tokens * MARGIN <= MAX_TOKENS
    body = len(json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode())
    assert body * MARGIN <= MAX_BODY_BYTES
