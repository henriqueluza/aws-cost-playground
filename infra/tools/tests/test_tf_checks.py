"""Testes de infra/tools/tf_checks.sh e do passo do terraform.yml que o chama (#117).

Rodam o script de verdade sobre árvores temporárias que só usam o provider embutido
(`terraform_data`): nada é baixado e nenhuma credencial é lida. Exigem `terraform` no PATH.
"""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "infra" / "tools" / "tf_checks.sh"
WORKFLOW = (ROOT / ".github" / "workflows" / "terraform.yml").read_text(encoding="utf-8")

MAIN = 'variable "name" {\n  type = string\n}\n\nresource "terraform_data" "this" {\n  input = var.name\n}\n'
TEST = (
    'variables {\n  name = "a"\n}\n\nrun "name_is_kept" {\n  command = plan\n\n'
    "  assert {\n    condition     = terraform_data.this.input == %s\n"
    '    error_message = "nome trocado"\n  }\n}\n'
)


def module(infra: Path, path: str, expected: str = '"a"', main: str = MAIN) -> None:
    folder = infra / path
    (folder / "tests").mkdir(parents=True)
    (folder / "main.tf").write_text(main)
    (folder / "tests" / "unit.tftest.hcl").write_text(TEST % expected)


def run(infra: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(SCRIPT), str(infra)], capture_output=True, text=True, timeout=300, check=False
    )


class TfChecksTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.infra = Path(tmp.name)

    def test_passes_when_every_root_and_module_passes(self) -> None:
        for path in ("envs/staging", "bootstrap", "modules/one", "modules/two"):
            module(self.infra, path)
        (self.infra / "modules" / "docs-only").mkdir()  # pasta sem .tf é ignorada
        result = run(self.infra)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK: 4 diretórios.", result.stdout)

    def test_a_broken_module_test_fails_and_the_others_still_run(self) -> None:
        module(self.infra, "modules/broken", expected='"b"')
        module(self.infra, "modules/fine")
        result = run(self.infra)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("Falharam (1 de 2):", result.stdout)
        self.assertIn("::error::validate ou terraform test falhou em", result.stdout)
        self.assertRegex(result.stdout, r"(?m)^  .*modules/broken$")
        self.assertNotRegex(result.stdout, r"(?m)^  .*modules/fine$")

    def test_an_invalid_module_fails(self) -> None:
        module(self.infra, "modules/invalid", main=MAIN.replace("var.name", "var.missing"))
        self.assertEqual(run(self.infra).returncode, 1)

    def test_a_broken_root_test_fails(self) -> None:
        module(self.infra, "envs/staging", expected='"b"')
        module(self.infra, "modules/fine")
        result = run(self.infra)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"(?m)^  .*envs/staging$")

    def test_an_empty_tree_fails_closed(self) -> None:
        result = run(self.infra)
        self.assertEqual(result.returncode, 1)
        self.assertIn("nenhum diretório com .tf", result.stdout)

    def test_modules_get_the_env_lockfile_and_roots_keep_theirs_read_only(self) -> None:
        module(self.infra, "envs/staging")
        module(self.infra, "modules/one")
        lock = "# lockfile do ambiente, sem provider\n"
        (self.infra / "envs" / "staging" / ".terraform.lock.hcl").write_text(lock)
        self.assertEqual(run(self.infra).returncode, 0)
        self.assertEqual((self.infra / "modules" / "one" / ".terraform.lock.hcl").read_text(), lock)
        self.assertEqual((self.infra / "envs" / "staging" / ".terraform.lock.hcl").read_text(), lock)
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(script.count("-lockfile=readonly"), 1)
        self.assertNotRegex(script, r"terraform [^\n]*\b(plan|apply|destroy|import)\b")


class StaticJobTest(unittest.TestCase):
    def setUp(self) -> None:
        self.static = WORKFLOW.split("\n  static:\n", 1)[1].split("\n  plan:\n", 1)[0]

    def test_static_job_runs_the_script_with_a_shared_plugin_cache(self) -> None:
        self.assertRegex(self.static, r"(?m)^          infra/tools/tf_checks\.sh$")
        self.assertIn('export TF_PLUGIN_CACHE_DIR="$RUNNER_TEMP/tf-plugin-cache"', self.static)

    def test_static_job_has_no_aws_credentials(self) -> None:
        for forbidden in ("configure-aws-credentials", "id-token", "secrets.", "AWS_PLAN_ROLE_ARN"):
            self.assertNotIn(forbidden, self.static)

    def test_module_lockfiles_stay_out_of_git(self) -> None:
        ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("infra/modules/**/.terraform.lock.hcl", ignored)
        tracked = subprocess.run(
            ["git", "ls-files", "infra/modules"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout
        self.assertNotIn(".terraform.lock.hcl", tracked)


if __name__ == "__main__":
    unittest.main()
