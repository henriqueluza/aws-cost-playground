"""Testes do passo `terraform plan` de .github/workflows/terraform.yml (#171).

Leem o workflow como texto (sem PyYAML, que o runner não garante): o job `plan` recebe as
quatro variáveis sem default das raízes, só o e-mail vem de secret e nenhum valor é impresso.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = (ROOT / ".github" / "workflows" / "terraform.yml").read_text(encoding="utf-8")
AUTHOR_VARS = ["zone_name", "alarm_email", "package_bucket", "package_key"]


def plan_step() -> tuple[str, str]:
    """Devolve (env, run) do passo `terraform plan`."""
    step = WORKFLOW.split("- name: terraform plan\n", 1)[1].split("\n      - name:", 1)[0]
    env, run = step.split("        run: |\n", 1)
    return env, run


class PlanVariablesTest(unittest.TestCase):
    def test_plan_step_passes_every_variable_without_default(self) -> None:
        env, _ = plan_step()
        for name in AUTHOR_VARS:
            self.assertRegex(env, rf"(?m)^          TF_VAR_{name}: \S")

    def test_those_are_all_the_variables_the_tfvars_does_not_give(self) -> None:
        for env_name in ("staging", "production"):
            root = ROOT / "infra" / "envs" / env_name
            variables = (root / "variables.tf").read_text()
            declared = set(re.findall(r'(?m)^variable "(\w+)"', variables))
            given = set(re.findall(r"(?m)^(\w+)\s*=", (root / "terraform.tfvars").read_text()))
            self.assertEqual(declared - given, set(AUTHOR_VARS), env_name)

    def test_author_values_come_from_the_repository_and_the_package_is_a_placeholder(self) -> None:
        env, _ = plan_step()
        self.assertIn("TF_VAR_zone_name: ${{ vars.TF_VAR_ZONE_NAME }}", env)
        self.assertIn("TF_VAR_alarm_email: ${{ secrets.TF_VAR_ALARM_EMAIL }}", env)
        self.assertIn("TF_VAR_package_bucket: acp-plan-placeholder", env)
        self.assertIn("TF_VAR_package_key: plan/placeholder.zip", env)

    def test_the_email_is_the_only_secret_and_stays_in_the_plan_step(self) -> None:
        self.assertEqual(re.findall(r"secrets\.\w+", WORKFLOW), ["secrets.TF_VAR_ALARM_EMAIL"])
        # Sem GitHub Environment: o trust do papel `plan` exige o evento pull_request.
        self.assertNotRegex(WORKFLOW, r"(?m)^\s+environment:")

    def test_run_never_interpolates_nor_prints_a_value(self) -> None:
        _, run = plan_step()
        self.assertNotIn("${{", run)
        self.assertNotRegex(run, r"\b(echo|printf|printenv|env|set -x)\b")
        # A checagem de presença só cita o nome do que falta.
        self.assertEqual(len(re.findall(r'(?m)^\s+: "\$\{TF_VAR_\w+:\?[^$]+\}"$', run)), 2)

    def test_job_is_still_skipped_without_the_plan_role(self) -> None:
        self.assertRegex(WORKFLOW, r"(?m)^    if: vars\.AWS_PLAN_ROLE_ARN != '' && ")


if __name__ == "__main__":
    unittest.main()
