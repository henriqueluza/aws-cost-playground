"""Papéis apply do bootstrap: confere o que o `terraform test` não enxerga."""

import re
import unittest
from pathlib import Path

BOOTSTRAP = Path(__file__).resolve().parents[2] / "bootstrap"
# Inventário de IAM do bootstrap: recurso novo entra aqui de propósito, nunca por acidente.
# O conteúdo das políticas dos papéis apply é travado por igualdade em `tests/apply.tftest.hcl`.
IAM_RESOURCES = {
    "aws_iam_openid_connect_provider.github",
    "aws_iam_policy.apply_boundary",
    "aws_iam_role.apply",
    "aws_iam_role.plan",
    "aws_iam_role.prices",
    "aws_iam_role_policy.apply_deny",
    "aws_iam_role_policy.apply_deny_data",
    "aws_iam_role_policy.apply_state",
    "aws_iam_role_policy.plan_deny_data",
    "aws_iam_role_policy.prices_get_products",
    "aws_iam_role_policy_attachment.plan_read_only",
}
FORBIDDEN = ("AdministratorAccess", "managed_policy_arns", "inline_policy")
RESOURCE = re.compile(r'^resource\s+"(aws_iam_\w+)"\s+"(\w+)"', re.M)
# Identidade que o apply não pode perder: o papel e o limite de permissões dos papéis que ele cria.
PROTECTED = {
    "o papel apply": ("aws_iam_role", "apply"),
    "o limite de permissões": ("aws_iam_policy", "apply_boundary"),
    "o papel prices": ("aws_iam_role", "prices"),
}
PREVENT_DESTROY = re.compile(r"^\s*prevent_destroy\s*=\s*true\s*$", re.M)
HOSTILE = """
resource "aws_iam_role" "apply" {
  # prevent_destroy = true
}
resource "aws_iam_policy_attachment" "admin" {
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
resource "aws_iam_role_policy" "apply_extra" {}
resource "aws_iam_policy" "apply_boundary" {
  lifecycle {
    prevent_destroy = false
  }
}
"""


def violations(tf: str) -> list[str]:
    found = [f"proibido no bootstrap: {word}" for word in FORBIDDEN if word in tf]
    declared = {f"{kind}.{name}" for kind, name in RESOURCE.findall(tf)}
    found += [f"IAM fora do inventário: {address}" for address in sorted(declared - IAM_RESOURCES)]
    for label, (kind, name) in PROTECTED.items():
        block = re.search(rf'^resource "{kind}" "{name}"(.*?)(?=^resource |\Z)', tf, re.M | re.S)
        if not block or not PREVENT_DESTROY.search(block.group(1)):
            found.append(f"{label} precisa de prevent_destroy = true")
    return found


class BootstrapApplyRolesTest(unittest.TestCase):
    def test_bootstrap_real_nao_tem_violacao(self) -> None:
        tf = "\n".join(path.read_text() for path in sorted(BOOTSTRAP.glob("*.tf")))
        self.assertEqual(violations(tf), [])

    def test_trecho_hostil_e_reprovado(self) -> None:
        expected = [
            "proibido no bootstrap: AdministratorAccess",
            "IAM fora do inventário: aws_iam_policy_attachment.admin",
            "IAM fora do inventário: aws_iam_role_policy.apply_extra",
            "o papel apply precisa de prevent_destroy = true",
            "o limite de permissões precisa de prevent_destroy = true",
            "o papel prices precisa de prevent_destroy = true",
        ]
        self.assertEqual(violations(HOSTILE), expected)
