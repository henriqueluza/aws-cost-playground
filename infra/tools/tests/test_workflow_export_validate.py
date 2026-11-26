"""Testes do workflow export-validate.yml e do script que confere o relatório (#68).

O workflow é lido como texto (sem PyYAML, que o runner não garante). O passo que barra
variável da AWS e o script do relatório são executados de verdade. Sem rede e sem Terraform.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest
import unittest.mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "export-validate.yml"
SCRIPT = ROOT / "infra" / "tools" / "export_validate_report.py"
SCENARIOS = ROOT / "contracts" / "scenarios"
LOCAL_TEST = "web/src/features/export/test/terraform.local.test.ts"
PATHS = [
    "web/src/features/export/**",
    "contracts/**",
    "infra/tools/export_validate_report.py",
    ".github/workflows/export-validate.yml",
]
TITLE = "o export do cenário {} passa no validate com o provider da AWS"
NAMES = ["apiServerless", "appClassico", "pipelineDeFilas"]


def text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def code() -> str:
    return "\n".join(ln for ln in text().splitlines() if not ln.lstrip().startswith("#"))


def run_blocks() -> list[str]:
    """Corpo de cada `run:`, em ordem e com os comentários: o GitHub expande `${{ }}` neles."""
    lines = text().splitlines()
    blocks = []
    for i, line in enumerate(lines):
        found = re.match(r"^(\s*)(?:- )?run:\s*(.*)$", line)
        if not found:
            continue
        if not re.fullmatch(r"[|>][+-]?", found.group(2).strip()):
            blocks.append(found.group(2).strip())
            continue
        body = []
        for nxt in lines[i + 1 :]:
            if nxt.strip() and len(nxt) - len(nxt.lstrip()) <= line.index("run:"):
                break
            body.append(nxt)
        blocks.append(textwrap.dedent("\n".join(body)).strip("\n"))
    return blocks


class HelpersTest(unittest.TestCase):
    def test_run_blocks_reads_every_block_style_and_keeps_comments(self) -> None:
        sample = "      - run: |-\n          # ${{ a }}\n          echo 1\n"
        sample += "      - run: >\n          echo 2\n"
        with unittest.mock.patch(f"{__name__}.text", return_value=sample):
            self.assertEqual(run_blocks(), ["# ${{ a }}\necho 1", "echo 2"])


class TriggerAndPermissionsTest(unittest.TestCase):
    def test_trigger_is_only_pull_request_to_main_with_the_paths(self) -> None:
        on = text().split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertEqual(re.findall(r"(?m)^  (\w+):", on), ["pull_request"])
        self.assertIn("    branches: [main]\n", on)
        self.assertEqual(re.findall(r'(?m)^      - "(.+)"$', on), PATHS)
        self.assertNotIn("pull_request_target", code())

    def test_permissions_are_read_only_and_set_once(self) -> None:
        self.assertEqual(re.findall(r"(?m)^[ \t]*permissions:.*$", code()), ["permissions:"])
        self.assertIn("\npermissions:\n  contents: read\n\n", text())
        for word in ("id-token", "write", "environment:"):
            self.assertNotIn(word, code())

    def test_single_job_with_timeout(self) -> None:
        jobs = code().split("\njobs:\n", 1)[1]
        self.assertEqual(re.findall(r"(?m)^  ([\w-]+):$", jobs), ["export-validate"])
        self.assertRegex(jobs, r"(?m)^    timeout-minutes: \d+$")

    def test_a_change_to_the_workflow_runs_these_tests_in_ci(self) -> None:
        terraform = (WORKFLOW.parent / "terraform.yml").read_text(encoding="utf-8")
        paths = terraform.split("    paths:\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn('- ".github/workflows/export-validate.yml"', paths)
        self.assertIn("python3 -m unittest discover -s infra/tools/tests", terraform)


class HardeningTest(unittest.TestCase):
    def test_every_uses_is_pinned_by_sha_with_version_comment(self) -> None:
        uses = re.findall(r"(?m)^\s*(?:- )?uses:.*$", code())
        self.assertEqual(len(uses), 3)
        for line in uses:
            self.assertRegex(line, r"uses: \S+@[0-9a-f]{40}\s+# v\S+", line)

    def test_checkout_keeps_no_credentials(self) -> None:
        self.assertEqual(code().count("actions/checkout@"), 1)
        self.assertEqual(code().count("persist-credentials: false"), 1)

    def test_run_blocks_never_interpolate_expressions(self) -> None:
        blocks = run_blocks()
        self.assertEqual(len(blocks), 4)
        for block in blocks:
            self.assertNotIn("${{", block)

    def test_no_secret_token_or_aws_credential(self) -> None:
        for word in ("secrets.", "github.token", "GITHUB_TOKEN", "vars.", "configure-aws"):
            self.assertNotIn(word, code())
        # `AWS_` só aparece no passo que recusa essas variáveis; nenhuma é definida.
        self.assertNotRegex(code(), r"(?m)^\s*AWS_\w+\s*:")
        self.assertNotRegex(code(), r"export\s+AWS_|AWS_\w+=")

    def test_terraform_version_matches_infra_and_never_plans(self) -> None:
        terraform = (WORKFLOW.parent / "terraform.yml").read_text(encoding="utf-8")
        version = re.search(r'(?m)^  TF_VERSION: "([\d.]+)"', text())
        self.assertIsNotNone(version)
        self.assertIn(f'TF_VERSION: "{version.group(1)}"', terraform)  # type: ignore[union-attr]
        self.assertIn("terraform_wrapper: false", code())
        runs = "\n".join(run_blocks())
        forbidden = ("plan", "app" + "ly", "des" + "troy")
        for word in [*(f"terraform {verb}" for verb in forbidden), "-backend-config"]:
            self.assertNotIn(word, runs)

    def test_runs_the_local_test_with_both_switches_and_a_shared_plugin_cache(self) -> None:
        self.assertTrue((ROOT / LOCAL_TEST).is_file())
        self.assertIn('EXPORT_TERRAFORM_CHECK: "1"', code())
        self.assertIn('EXPORT_TERRAFORM_AWS: "1"', code())
        run = next(block for block in run_blocks() if "vitest" in block)
        self.assertIn("npx vitest run " + LOCAL_TEST.removeprefix("web/"), run)
        self.assertIn('export TF_PLUGIN_CACHE_DIR="$RUNNER_TEMP/tf-plugin-cache"', run)
        self.assertIn('--outputFile.json="$RUNNER_TEMP/export-validate.json"', run)
        report = 'export_validate_report.py "$RUNNER_TEMP/export-validate.json" contracts/scenarios'
        self.assertEqual(run_blocks()[-1], "python3 infra/tools/" + report)

    def test_local_test_runs_init_without_backend_and_validate(self) -> None:
        source = (ROOT / LOCAL_TEST).read_text(encoding="utf-8")
        self.assertIn("terraform(['init', '-backend=false', '-input=false'])", source)
        self.assertIn("terraform(['validate', '-no-color'])", source)
        for scenario in sorted(p.name for p in SCENARIOS.glob("*.json")):
            self.assertIn(f"contracts/scenarios/{scenario}'", source)


class AwsGuardExecutionTest(unittest.TestCase):
    def guard(self, extra: dict[str, str]) -> subprocess.CompletedProcess[str]:
        script = next(block for block in run_blocks() if "'^AWS_'" in block)
        env = {"PATH": os.environ["PATH"], **extra}
        return subprocess.run(
            ["bash", "-euo", "pipefail", "-c", script],
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_clean_environment_passes(self) -> None:
        self.assertEqual(self.guard({"OTHER": "x"}).returncode, 0)

    def test_any_aws_variable_fails_and_only_its_name_is_printed(self) -> None:
        result = self.guard({"AWS_SECRET_ACCESS_KEY": "valor-de-teste"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("AWS_SECRET_ACCESS_KEY", result.stdout)
        self.assertNotIn("valor-de-teste", result.stdout + result.stderr)


class ReportScriptTest(unittest.TestCase):
    def report(self, statuses: dict[str, str], success: bool = True) -> dict[str, object]:
        tests = [{"title": title, "status": status} for title, status in statuses.items()]
        return {"success": success, "testResults": [{"assertionResults": tests}]}

    def run_script(
        self, report: object, scenarios: list[str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text(report if isinstance(report, str) else json.dumps(report))
            directory = SCENARIOS
            if scenarios is not None:
                directory = Path(tmp) / "scenarios"
                directory.mkdir()
                for name in scenarios:
                    (directory / name).write_text("{}")
            return subprocess.run(
                [sys.executable, str(SCRIPT), str(path), str(directory)],
                check=False,
                capture_output=True,
                text=True,
            )

    def all_passed(self) -> dict[str, str]:
        return {TITLE.format(name): "passed" for name in NAMES}

    def test_the_three_reference_scenarios_passed(self) -> None:
        result = self.run_script(self.report(self.all_passed()))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("3 cenários validados: " + ", ".join(NAMES), result.stdout)

    def test_a_failed_scenario_fails(self) -> None:
        statuses = {**self.all_passed(), TITLE.format("appClassico"): "failed"}
        result = self.run_script(self.report(statuses, success=False))
        self.assertEqual(result.returncode, 1)
        self.assertIn("teste failed: " + TITLE.format("appClassico"), result.stdout)

    def test_skipped_tests_fail_instead_of_passing_empty(self) -> None:
        statuses = {title: "skipped" for title in self.all_passed()}
        result = self.run_script(self.report(statuses))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.count("teste skipped"), 3)

    def test_a_repeated_title_cannot_hide_a_failure(self) -> None:
        report = self.report(self.all_passed())
        tests = report["testResults"][0]["assertionResults"]  # type: ignore[index]
        tests.insert(0, {"title": TITLE.format("appClassico"), "status": "skipped"})
        result = self.run_script(report)
        self.assertEqual(result.returncode, 1)
        self.assertIn("teste skipped: " + TITLE.format("appClassico"), result.stdout)

    def test_empty_report_fails(self) -> None:
        result = self.run_script({"success": True, "testResults": []})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.count("cenário sem teste de validate"), 3)

    def test_a_scenario_file_without_a_test_fails(self) -> None:
        names = [p.name for p in SCENARIOS.glob("*.json")] + ["novo-caso.json"]
        result = self.run_script(self.report(self.all_passed()), names)
        self.assertEqual(result.returncode, 1)
        self.assertIn("cenário sem teste de validate: novoCaso", result.stdout)

    def test_empty_scenarios_directory_fails(self) -> None:
        result = self.run_script(self.report(self.all_passed()), [])
        self.assertEqual(result.returncode, 1)
        self.assertIn("nenhum cenário", result.stdout)

    def test_unreadable_report_fails_closed(self) -> None:
        for broken in ("não é json", "[]", "{}"):
            result = self.run_script(broken)
            self.assertEqual(result.returncode, 2, broken)
            self.assertIn("relatório ilegível", result.stdout)

    def test_wrong_arguments_fail_closed(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], check=False, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
