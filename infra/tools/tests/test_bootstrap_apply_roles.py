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
    "aws_iam_policy.apply_named",
    "aws_iam_role.apply",
    "aws_iam_role.plan",
    "aws_iam_role_policy.apply_deny",
    "aws_iam_role_policy.apply_deny_data",
    "aws_iam_role_policy.apply_state",
    "aws_iam_role_policy.plan_deny_data",
    "aws_iam_role_policy_attachment.apply_named",
    "aws_iam_role_policy_attachment.plan_read_only",
}
FORBIDDEN = ("AdministratorAccess", "managed_policy_arns", "inline_policy")
RESOURCE = re.compile(r'^resource\s+"(aws_iam_\w+)"\s+"(\w+)"', re.M)
# Identidade que o apply não pode perder: o papel, o limite de permissões dos papéis que ele cria
# e a política de escrita por nome.
PROTECTED = {
    "o papel apply": ("aws_iam_role", "apply"),
    "o limite de permissões": ("aws_iam_policy", "apply_boundary"),
    "a política de escrita por nome": ("aws_iam_policy", "apply_named"),
}
# O nome do bucket do site é fixado em `named.tf` e definido de verdade em cada ambiente.
ENVS = Path(__file__).resolve().parents[2] / "envs"
BUCKET_ENV = re.compile(r'^\s*bucket_name\s*=\s*"\$\{local\.name_prefix\}-([^"$]+)"', re.M)
BUCKET_NAMED = re.compile(r'arn:aws:s3:::acp-\$\{prefix\}-([^"$/]+)"')
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
resource "aws_iam_policy" "apply_named" {
  lifecycle {
    # prevent_destroy = true
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


def bucket_suffix_mismatches(named_tf: str, env_tfs: dict[str, str]) -> list[str]:
    """Reprova se o sufixo do bucket em `named.tf` diverge do de algum ambiente (falha fechada)."""
    named = BUCKET_NAMED.findall(named_tf)
    if len(named) != 1:
        return [f"named.tf precisa de exatamente 1 ARN de bucket do site, achou {len(named)}"]
    if not {"staging", "production"} <= env_tfs.keys():
        return ["faltam os ambientes staging e production"]
    found = []
    for env, tf in sorted(env_tfs.items()):
        suffixes = BUCKET_ENV.findall(tf)
        if len(suffixes) != 1:
            found.append(f"{env}: precisa de exatamente 1 bucket_name, achou {len(suffixes)}")
        elif suffixes[0] != named[0]:
            found.append(f"{env}: bucket '{suffixes[0]}' difere de '{named[0]}' em named.tf")
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
            "a política de escrita por nome precisa de prevent_destroy = true",
        ]
        self.assertEqual(violations(HOSTILE), expected)

    def test_nome_do_bucket_do_site_confere_com_os_ambientes(self) -> None:
        env_tfs = {path.parent.name: path.read_text() for path in sorted(ENVS.glob("*/main.tf"))}
        self.assertEqual(bucket_suffix_mismatches((BOOTSTRAP / "named.tf").read_text(), env_tfs), [])

    def test_sufixo_do_bucket_divergente_ou_ausente_e_reprovado(self) -> None:
        named = 'x = "arn:aws:s3:::acp-${prefix}-site-aws-cost-playground"'
        ok = 'bucket_name = "${local.name_prefix}-site-aws-cost-playground"'
        bad = 'bucket_name = "${local.name_prefix}-site-outro"'
        self.assertEqual(bucket_suffix_mismatches(named, {"staging": ok, "production": ok}), [])
        self.assertEqual(
            bucket_suffix_mismatches(named, {"staging": ok, "production": bad}),
            ["production: bucket 'site-outro' difere de 'site-aws-cost-playground' em named.tf"],
        )
        self.assertEqual(len(bucket_suffix_mismatches(named, {"staging": ok, "production": ""})), 1)
        self.assertEqual(len(bucket_suffix_mismatches("", {"staging": ok, "production": ok})), 1)
        self.assertEqual(len(bucket_suffix_mismatches(named, {"staging": ok})), 1)
