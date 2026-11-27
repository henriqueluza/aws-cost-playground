"""A condição de colunas do papel do `llm-proxy` acompanha o repositório de quota (#372).

A política `Quota` (`infra/modules/functions/iam.tf`) só deixa passar requisição que cite as
colunas dos contadores e as chaves. Se `api/app/quotas/repository.py` passar a usar outra coluna,
um `GetItem` sem projeção ou um `ReturnValues`, o DynamoDB nega em execução e a estimativa para,
sem erro no plano. Roda com `python3 -m unittest discover -s infra/tools/tests`.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
KEYS = {"PK", "SK"}


def policy_attributes() -> set[str]:
    text = (ROOT / "infra/modules/functions/iam.tf").read_text(encoding="utf-8")
    match = re.search(r"^\s*quota_attributes\s*=\s*\[([^\]]*)\]", text, re.M)
    assert match, "local quota_attributes não encontrado em iam.tf"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def repository_source() -> str:
    return (ROOT / "api/app/quotas/repository.py").read_text(encoding="utf-8")


def repository_attributes(source: str) -> set[str]:
    """Nomes reais por trás dos apelidos `#x` e chaves dos itens, lidos da árvore do módulo."""
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Dict):
            continue
        keys = [k.value for k in node.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)]
        if keys and all(k.startswith("#") for k in keys):
            names |= {v.value for v in node.values if isinstance(v, ast.Constant)}
        elif keys and set(keys) <= KEYS:
            names |= set(keys)
    return names


class QuotaPolicyTest(unittest.TestCase):
    def test_colunas_da_politica_sao_as_do_repositorio_mais_as_chaves(self) -> None:
        self.assertEqual(policy_attributes(), {"PK", "SK", "count", "ttl"})
        self.assertEqual(repository_attributes(repository_source()), policy_attributes())

    def test_expressoes_so_citam_colunas_por_apelido_declarado(self) -> None:
        source = repository_source()
        found = re.findall(r'(?:_UPDATE|_CONDITION|ProjectionExpression)\s*=\s*"([^"]+)"', source)
        self.assertEqual(len(found), 3)
        aliases: set[str] = set()
        for expression in found:
            aliases |= set(re.findall(r"#\w+", expression))
            bare = re.sub(r"[#:]\w+", "", expression)
            words = set(re.findall(r"[A-Za-z_]\w*", bare))
            self.assertLessEqual(words, {"SET", "ADD", "OR", "if_not_exists", "attribute_not_exists"})
        self.assertEqual(aliases, {"#count", "#ttl"})

    def test_leitura_leva_projecao_e_nada_pede_o_item_de_volta(self) -> None:
        source = repository_source()
        self.assertEqual(source.count("get_item("), source.count("ProjectionExpression="))
        self.assertNotIn("ReturnValues", source)
        for call in ("put_item", "delete_item", "update_item(", ".query(", ".scan(", "batch_"):
            self.assertNotIn(call, source)

    def test_extrator_ve_coluna_nova_no_repositorio(self) -> None:
        source = repository_source().replace('"#ttl": "ttl"', '"#ttl": "ttl", "#doc": "doc"')
        self.assertIn("doc", repository_attributes(source))


if __name__ == "__main__":
    unittest.main()
