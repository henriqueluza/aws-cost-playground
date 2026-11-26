"""Testes do workflow prices.yml (#29, parte 2).

O workflow é lido como texto (sem PyYAML, que o runner não garante), no caminho definitivo
`.github/workflows/prices.yml`. Os passos `gate` e `apply` são executados de verdade com
bash. O script de publicação tem os próprios testes em test_prices_pr_script.py. Sem rede.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "prices.yml"
PENDING = ROOT / ".github" / "workflows-pending" / "prices.yml"
STEP_START = re.compile(r"^      - ", re.M)
GATE_CONDITION = "if: steps.gate.outputs.configured == 'true'"
STEP_IDS = {
    "generate": ["gate", "checkout", "uv", "deps", "aws", "generate", "upload"],
    "publish": ["checkout", "download", "apply", "publish"],
}
ARTIFACT = "path: ${{ runner.temp }}/catalog"
NOTHING = "nenhum serviço com consulta: nada a gravar"
FORBIDDEN = [r"gh pr " + r"merge", r"--label", r"skip-review", r"--force", r"\+refs"]


def text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def strip_comments(raw: str) -> str:
    return "\n".join(ln for ln in raw.splitlines() if not ln.lstrip().startswith("#"))


def code() -> str:
    return strip_comments(text())


def job(name: str) -> str:
    body = text().split("\njobs:\n", 1)[1]
    match = re.search(rf"(?ms)^  {re.escape(name)}:\n(.*?)(?=^  \S|\Z)", body)
    if match is None:
        raise AssertionError(f"job `{name}` não encontrado")
    return match.group(1)


def steps(job_text: str) -> list[tuple[str | None, str]]:
    body = job_text.split("    steps:\n", 1)[1]
    starts = [m.start() for m in STEP_START.finditer(body)]
    out = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(body)
        chunk = body[start:end]
        found = re.search(r"(?m)^(?:      - |        )id:\s*(\S+)", chunk)
        out.append((found.group(1) if found else None, chunk))
    return out


def all_steps() -> list[tuple[str, str | None, str]]:
    return [(name, sid, chunk) for name in STEP_IDS for sid, chunk in steps(job(name))]


def step(job_name: str, sid_wanted: str) -> str:
    for sid, chunk in steps(job(job_name)):
        if sid == sid_wanted:
            return chunk
    raise AssertionError(f"passo `{job_name}.{sid_wanted}` não encontrado")


def permissions(job_name: str) -> list[str]:
    block = job(job_name).split("    permissions:\n", 1)[1]
    perms = []
    for line in block.splitlines():
        if not line.startswith("      "):
            break
        perms.append(line.strip())
    return sorted(perms)


def run_block(step_text: str) -> str:
    lines = step_text.splitlines()
    for i, line in enumerate(lines):
        found = re.match(r"^(?:      - |        )run:\s*(.*)$", line)
        if not found:
            continue
        rest = found.group(1).strip()
        if not re.fullmatch(r"[|>][+-]?", rest):
            return rest
        block = []
        for nxt in lines[i + 1 :]:
            if nxt.strip() and len(nxt) - len(nxt.lstrip()) <= 8:
                break
            block.append(nxt)
        return textwrap.dedent("\n".join(block)).strip("\n")
    return ""


class TriggerAndPermissionsTest(unittest.TestCase):
    def test_workflow_lives_only_in_the_final_path(self) -> None:
        self.assertTrue(WORKFLOW.is_file())
        self.assertFalse(PENDING.exists())

    def test_trigger_is_only_schedule_and_dispatch(self) -> None:
        on = text().split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertEqual(re.findall(r"(?m)^  (\w+):", on), ["schedule", "workflow_dispatch"])
        self.assertIn("cron: '17 9 * * 1'", on.replace('"', "'"))

    def test_no_forbidden_trigger_anywhere(self) -> None:
        for name in ("pull_request", "pull_request_target", "push", "workflow_run"):
            self.assertNotRegex(code(), rf"(?m)^\s*{name}\b", f"gatilho proibido: {name}")

    def test_top_level_permissions_are_empty(self) -> None:
        self.assertRegex(text(), r"(?m)^permissions: \{\}\s*$")

    def test_jobs_are_generate_then_publish(self) -> None:
        body = text().split("\njobs:\n", 1)[1]
        self.assertEqual(re.findall(r"(?m)^  (\w[\w-]*):\s*$", body), list(STEP_IDS))
        self.assertRegex(job("publish"), r"(?m)^    needs: generate\s*$")

    def test_aws_job_cannot_write_and_publish_job_has_no_oidc(self) -> None:
        self.assertEqual(permissions("generate"), ["contents: read", "id-token: write"])
        self.assertEqual(permissions("publish"), ["contents: write", "pull-requests: write"])

    def test_both_jobs_run_only_on_main_and_never_in_an_environment(self) -> None:
        self.assertRegex(job("generate"), r"(?m)^    if: github\.ref == 'refs/heads/main'\s*$")
        self.assertRegex(
            job("publish"),
            r"(?m)^    if: github\.ref == 'refs/heads/main' && "
            r"needs\.generate\.outputs\.configured == 'true'\s*$",
        )
        self.assertNotRegex(code(), r"(?m)^\s*environment:")

    def test_concurrency_never_cancels_a_running_publication(self) -> None:
        self.assertRegex(
            text(), r"(?m)^concurrency:\n  group: prices\n  cancel-in-progress: false$"
        )

    def test_a_change_to_the_workflow_runs_these_tests_in_ci(self) -> None:
        terraform = (WORKFLOW.parent / "terraform.yml").read_text(encoding="utf-8")
        paths = terraform.split("    paths:\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn('- ".github/workflows/prices.yml"', paths)
        self.assertIn("python3 -m unittest discover -s infra/tools/tests", terraform)


class StepsTest(unittest.TestCase):
    def test_step_ids_in_order(self) -> None:
        for name, expected in STEP_IDS.items():
            self.assertEqual([sid for sid, _ in steps(job(name))], expected, name)

    def test_every_generate_step_after_the_gate_requires_it_configured(self) -> None:
        for sid, chunk in steps(job("generate"))[1:]:
            self.assertIn(GATE_CONDITION, chunk, f"passo {sid} sem a condição do gate")
        self.assertIn("configured: ${{ steps.gate.outputs.configured }}", job("generate"))

    def test_gate_reads_role_from_a_variable_only(self) -> None:
        self.assertIn("ROLE: ${{ vars.AWS_PRICES_ROLE_ARN }}", step("generate", "gate"))

    def test_oidc_assumes_the_prices_role_in_us_east_1_only_in_generate(self) -> None:
        aws = step("generate", "aws")
        self.assertIn("role-to-assume: ${{ vars.AWS_PRICES_ROLE_ARN }}", aws)
        self.assertRegex(aws, r"(?m)^\s+aws-region: us-east-1\s*$")
        self.assertNotIn("configure-aws-credentials", job("publish"))
        self.assertNotIn("AWS_", job("publish"))

    def test_checkouts_keep_no_credentials_and_follow_the_branch(self) -> None:
        for name in STEP_IDS:
            checkout = step(name, "checkout")
            self.assertIn("persist-credentials: false", checkout, name)
            self.assertNotRegex(checkout, r"(?m)^\s+ref:", name)

    def test_dependencies_are_installed_locked_before_the_aws_credentials(self) -> None:
        deps = step("generate", "deps")
        self.assertEqual(run_block(deps), "uv sync --locked")
        self.assertRegex(deps, r"(?m)^\s+working-directory: pricing\s*$")

    def test_generate_runs_catalog_and_summary_in_pricing(self) -> None:
        generate = step("generate", "generate")
        self.assertRegex(generate, r"(?m)^\s+working-directory: pricing\s*$")
        run = run_block(generate)
        self.assertRegex(run, r"python -m app(\s|$)")
        self.assertIn("python -m app.summary", run)
        self.assertIn('>> "$GITHUB_STEP_SUMMARY"', run)

    def test_generate_warns_when_the_generator_wrote_nothing(self) -> None:
        run = run_block(step("generate", "generate"))
        self.assertRegex(run, rf"grep -qxF '{NOTHING}' .*\n\s+echo \"::warning::")

    def test_catalog_travels_between_jobs_as_a_short_lived_artifact(self) -> None:
        upload, download = step("generate", "upload"), step("publish", "download")
        for chunk in (upload, download):
            self.assertRegex(chunk, r"(?m)^\s+name: catalog\s*$")
            self.assertIn(ARTIFACT, chunk)
        self.assertRegex(upload, r"(?m)^\s+retention-days: 1\s*$")
        self.assertRegex(upload, r"(?m)^\s+if-no-files-found: error\s*$")

    def test_publish_uses_the_script_and_only_it_gets_the_token(self) -> None:
        publish = step("publish", "publish")
        self.assertIn("GH_TOKEN: ${{ github.token }}", publish)
        self.assertIn(
            'bash scripts/prices-pr.sh "$RUNNER_TEMP/catalog/body.md"', run_block(publish)
        )
        for name, sid, chunk in all_steps():
            if (name, sid) != ("publish", "publish"):
                self.assertNotIn("GH_TOKEN", chunk, sid)
                self.assertNotIn("github.token", chunk, sid)


class HardeningTest(unittest.TestCase):
    def test_every_uses_is_pinned_by_sha_with_version_comment(self) -> None:
        uses = re.findall(r"(?m)^\s*(?:- )?uses:.*$", code())
        self.assertEqual(len(uses), 6)
        for line in uses:
            self.assertRegex(line, r"uses: \S+@[0-9a-f]{40}\s+# v\S+", line)

    def test_run_blocks_never_interpolate_expressions(self) -> None:
        for _, sid, chunk in all_steps():
            self.assertNotIn("${{", run_block(chunk), sid)

    def test_no_secrets_context(self) -> None:
        self.assertNotIn("secrets.", code())

    def test_no_forbidden_publication_command_in_workflow(self) -> None:
        for pattern in FORBIDDEN:
            self.assertNotRegex(code(), pattern)
        self.assertNotIn("git push", code())


def run_step(script: str, env: dict[str, str], cwd: Path) -> subprocess.CompletedProcess[str]:
    if not script:
        raise AssertionError("passo sem bloco run")
    return subprocess.run(
        ["bash", "-euo", "pipefail", "-c", script],
        env={"PATH": os.environ["PATH"], **env},
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def run_gate(role: str) -> tuple[subprocess.CompletedProcess[str], str]:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "output"
        out.write_text("")
        script = run_block(step("generate", "gate"))
        proc = run_step(script, {"ROLE": role, "GITHUB_OUTPUT": str(out)}, Path(tmp))
        return proc, out.read_text()


class GateExecutionTest(unittest.TestCase):
    def test_empty_role_warns_and_skips_without_failing(self) -> None:
        proc, out = run_gate("")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertRegex(proc.stdout, r"(?m)^::warning::")
        self.assertIn("configured=false", out)
        self.assertNotIn("configured=true", out)

    def test_filled_role_is_configured_and_never_printed(self) -> None:
        role = "arn:aws:iam::123456789012:role/acp-prices-secret-marker"
        proc, out = run_gate(role)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("configured=true", out)
        self.assertNotIn("configured=false", out)
        self.assertNotIn(role, proc.stdout + proc.stderr + out)


class ApplyExecutionTest(unittest.TestCase):
    """O passo `apply` troca web/public/prices pelo catálogo do artefato, ou recusa."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Path(tmp.name) / "repo"
        self.catalog = Path(tmp.name) / "temp" / "catalog"
        old = self.repo / "web" / "public" / "prices" / "us-east-1"
        old.mkdir(parents=True)
        (old / "gone.json").write_text("{}")
        (old.parent / "manifest.json").write_text('{"old": true}')
        new = self.catalog / "prices" / "us-east-1"
        new.mkdir(parents=True)
        (new / "s3.json").write_text("{}")
        (new.parent / "manifest.json").write_text('{"new": true}')
        (self.catalog / "body.md").write_text("corpo\n")

    def apply(self) -> subprocess.CompletedProcess[str]:
        script = run_block(step("publish", "apply"))
        return run_step(script, {"RUNNER_TEMP": str(self.catalog.parent)}, self.repo)

    def assert_refused(self) -> None:
        proc = self.apply()
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertRegex(proc.stdout, r"(?m)^::error::")
        self.assertTrue((self.repo / "web/public/prices/us-east-1/gone.json").exists())

    def test_replaces_the_whole_directory(self) -> None:
        proc = self.apply()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        prices = self.repo / "web" / "public" / "prices"
        files = sorted(str(p.relative_to(prices)) for p in prices.rglob("*") if p.is_file())
        self.assertEqual(files, ["manifest.json", "us-east-1/s3.json"])
        self.assertEqual((prices / "manifest.json").read_text(), '{"new": true}')

    def test_refuses_artifact_without_manifest(self) -> None:
        (self.catalog / "prices" / "manifest.json").unlink()
        self.assert_refused()

    def test_refuses_artifact_without_body(self) -> None:
        (self.catalog / "body.md").write_text("")
        self.assert_refused()

    def test_refuses_artifact_with_symlink(self) -> None:
        (self.catalog / "prices" / "link.json").symlink_to("/etc/hosts")
        self.assert_refused()


if __name__ == "__main__":
    unittest.main()
