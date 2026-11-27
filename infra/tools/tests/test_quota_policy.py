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


def expressions(source: str) -> list[str | None]:
    """Texto de toda `*Expression` (chave de dicionário ou argumento); `None` se não for literal."""
    tree = ast.parse(source)
    constants = {
        target.id: node.value.value
        for node in tree.body
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)
        for target in node.targets
        if isinstance(target, ast.Name)
    }
    values: list[ast.expr] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and str(key.value).endswith("Expression"):
                    values.append(value)
        elif isinstance(node, ast.keyword) and node.arg and node.arg.endswith("Expression"):
            values.append(node.value)
    found: list[str | None] = []
    for value in values:
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            found.append(value.value)
        elif isinstance(value, ast.Name) and isinstance(constants.get(value.id), str):
            found.append(constants[value.id])
        else:
            found.append(None)
    return found


def dict_keys(source: str) -> set[str]:
    return {
        key.value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Dict)
        for key in node.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    }


class QuotaPolicyTest(unittest.TestCase):
    def test_colunas_da_politica_sao_as_do_repositorio_mais_as_chaves(self) -> None:
        self.assertEqual(policy_attributes(), {"PK", "SK", "count", "ttl"})
        self.assertEqual(repository_attributes(repository_source()), policy_attributes())

    def test_expressoes_so_citam_colunas_por_apelido_declarado(self) -> None:
        found = expressions(repository_source())
        self.assertGreaterEqual(len(found), 3)
        aliases: set[str] = set()
        for expression in found:
            self.assertIsNotNone(expression, "expressão montada em execução: o teste não consegue lê-la")
            aliases |= set(re.findall(r"#\w+", expression))
            bare = re.sub(r"[#:]\w+", "", expression)
            words = set(re.findall(r"[A-Za-z_]\w*", bare))
            self.assertLessEqual(words, {"SET", "ADD", "OR", "if_not_exists", "attribute_not_exists"})
        self.assertEqual(aliases, {"#count", "#ttl"})

    def test_leitura_leva_projecao_e_nada_pede_o_item_de_volta(self) -> None:
        source = repository_source()
        self.assertEqual(source.count("get_item("), source.count("ProjectionExpression="))
        self.assertNotIn("ReturnValues", source)
        for call in ("put_item", "delete_item", "update_item(", ".query(", ".scan(", "batch_", "transact_get"):
            self.assertNotIn(call, source)

    def test_transacao_so_leva_update(self) -> None:
        """`Put` e `Delete` pedem ações que o papel não tem; `ConditionCheck`, outra ainda."""
        keys = dict_keys(repository_source())
        self.assertIn("Update", keys)
        self.assertFalse(keys & {"Put", "Delete", "ConditionCheck", "Get"})

    def test_extratores_veem_as_mutacoes(self) -> None:
        source = repository_source()
        inline = source.replace('"UpdateExpression": _UPDATE', '"UpdateExpression": "SET doc = :ttl"')
        self.assertIn("SET doc = :ttl", expressions(inline))
        self.assertIn("Put", dict_keys(source.replace('"Update": {', '"Put": {')))

    def test_extrator_ve_coluna_nova_no_repositorio(self) -> None:
        source = repository_source().replace('"#ttl": "ttl"', '"#ttl": "ttl", "#doc": "doc"')
        self.assertIn("doc", repository_attributes(source))


if __name__ == "__main__":
    unittest.main()
