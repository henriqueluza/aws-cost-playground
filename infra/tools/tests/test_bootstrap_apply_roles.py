"""Papéis apply do bootstrap: o que o `terraform test` não enxerga (recurso não declarado, lifecycle)."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

BOOTSTRAP = Path(__file__).resolve().parents[2] / "bootstrap"
FORBIDDEN = ("AdministratorAccess", "managed_policy_arns")
# Política gerenciada nova em papel de CI entra aqui de propósito, nunca por acidente.
ALLOWED_ATTACHMENTS = {"plan_read_only"}
ATTACHMENT = re.compile(r'resource\s+"aws_iam_role_policy_attachments?(?:_exclusive)?"\s+"(\w+)"')
APPLY_ROLE = re.compile(r'resource "aws_iam_role" "apply"(.*?)(?=\nresource |\Z)', re.S)
HOSTILE = """
resource "aws_iam_role" "apply" {}
resource "aws_iam_role_policy_attachment" "admin" {
  role       = aws_iam_role.apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
"""


def violations(tf: str) -> list[str]:
    found = [f"proibido no bootstrap: {word}" for word in FORBIDDEN if word in tf]
    names = [name for name in ATTACHMENT.findall(tf) if name not in ALLOWED_ATTACHMENTS]
    found += [f"anexo de política gerenciada fora da lista: {name}" for name in names]
    role = APPLY_ROLE.search(tf)
    if not role or "prevent_destroy = true" not in role.group(1):
        found.append("o papel apply precisa de prevent_destroy = true")
    return found


class BootstrapApplyRolesTest(unittest.TestCase):
    def test_bootstrap_real_nao_tem_violacao(self) -> None:
        tf = "\n".join(path.read_text() for path in sorted(BOOTSTRAP.glob("*.tf")))
        self.assertEqual(violations(tf), [])

    def test_trecho_hostil_e_reprovado(self) -> None:
        expected = [
            "proibido no bootstrap: AdministratorAccess",
            "anexo de política gerenciada fora da lista: admin",
            "o papel apply precisa de prevent_destroy = true",
        ]
        self.assertEqual(violations(HOSTILE), expected)
