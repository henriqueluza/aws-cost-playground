"""Testes do workflow prices.yml (#29, parte 2).

O workflow é lido como texto (sem PyYAML, que o runner não garante) e existe em
`.github/workflows/` ou, até o `git mv` do autor, em `.github/workflows-pending/`: exige-se
exatamente um. O passo `gate` é executado de verdade com bash. O script de publicação tem
os próprios testes em test_prices_pr_script.py. Sem rede.
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
LIVE = ROOT / ".github" / "workflows" / "prices.yml"
PENDING = ROOT / ".github" / "workflows-pending" / "prices.yml"
STEP_START = re.compile(r"^      - ", re.M)
GATE_CONDITION = "if: steps.gate.outputs.configured == 'true'"
STEP_IDS = ["gate", "checkout", "uv", "aws", "generate", "publish"]
FORBIDDEN = [r"gh pr " + r"merge", r"--label", r"skip-review", r"--force", r"\+refs"]


def workflow_path() -> Path:
    found = [p for p in (LIVE, PENDING) if p.exists()]
    if len(found) != 1:
        raise AssertionError(f"esperado exatamente um prices.yml, achei: {found}")
    return found[0]


def text() -> str:
    return workflow_path().read_text(encoding="utf-8")


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


def step(sid_wanted: str) -> str:
    for sid, chunk in steps(job("catalog")):
        if sid == sid_wanted:
            return chunk
    raise AssertionError(f"passo `{sid_wanted}` não encontrado")


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
    def test_exactly_one_workflow_file(self) -> None:
        self.assertTrue(workflow_path().exists())

    def test_trigger_is_only_schedule_and_dispatch(self) -> None:
        on = text().split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertEqual(re.findall(r"(?m)^  (\w+):", on), ["schedule", "workflow_dispatch"])
        self.assertIn("cron: '17 9 * * 1'", on.replace('"', "'"))

    def test_no_forbidden_trigger_anywhere(self) -> None:
        for name in ("pull_request", "pull_request_target", "push"):
            self.assertNotRegex(code(), rf"(?m)^\s*{name}\b", f"gatilho proibido: {name}")

    def test_top_level_permissions_are_empty(self) -> None:
        self.assertRegex(text(), r"(?m)^permissions: \{\}\s*$")

    def test_job_is_main_only_with_exact_permissions(self) -> None:
        catalog = job("catalog")
        self.assertRegex(catalog, r"(?m)^    if: github\.ref == 'refs/heads/main'\s*$")
        block = catalog.split("    permissions:\n", 1)[1]
        perms = []
        for line in block.splitlines():
            if not line.startswith("      "):
                break
            perms.append(line.strip())
        self.assertEqual(
            sorted(perms),
            ["contents: write", "id-token: write", "pull-requests: write"],
        )

    def test_only_one_job(self) -> None:
        body = text().split("\njobs:\n", 1)[1]
        self.assertEqual(re.findall(r"(?m)^  (\w[\w-]*):\s*$", body), ["catalog"])


class StepsTest(unittest.TestCase):
    def test_step_ids_in_order(self) -> None:
        self.assertEqual([sid for sid, _ in steps(job("catalog"))], STEP_IDS)

    def test_every_step_after_the_gate_requires_it_configured(self) -> None:
        for sid, chunk in steps(job("catalog"))[1:]:
            self.assertIn(GATE_CONDITION, chunk, f"passo {sid} sem a condição do gate")

    def test_gate_reads_role_from_a_variable_only(self) -> None:
        self.assertIn("ROLE: ${{ vars.AWS_PRICES_ROLE_ARN }}", step("gate"))

    def test_aws_and_checkout_settings(self) -> None:
        self.assertIn("role-to-assume: ${{ vars.AWS_PRICES_ROLE_ARN }}", step("aws"))
        self.assertIn("persist-credentials: false", step("checkout"))

    def test_generate_runs_catalog_and_summary_in_pricing(self) -> None:
        generate = step("generate")
        self.assertRegex(generate, r"(?m)^\s+working-directory: pricing\s*$")
        run = run_block(generate)
        self.assertRegex(run, r"python -m app(\s|$)")
        self.assertIn("python -m app.summary", run)

    def test_publish_uses_the_script_and_only_it_gets_the_token(self) -> None:
        publish = step("publish")
        self.assertIn("GH_TOKEN: ${{ github.token }}", publish)
        self.assertIn('bash scripts/prices-pr.sh "$RUNNER_TEMP/body.md"', run_block(publish))
        for sid, chunk in steps(job("catalog")):
            if sid != "publish":
                self.assertNotIn("GH_TOKEN", chunk, sid)
                self.assertNotIn("github.token", chunk, sid)


class HardeningTest(unittest.TestCase):
    def test_every_uses_is_pinned_by_sha_with_version_comment(self) -> None:
        uses = re.findall(r"(?m)^\s*(?:- )?uses:.*$", code())
        self.assertTrue(uses)
        for line in uses:
            self.assertRegex(line, r"uses: \S+@[0-9a-f]{40}\s+# v\S+", line)

    def test_run_blocks_never_interpolate_expressions(self) -> None:
        for sid, chunk in steps(job("catalog")):
            self.assertNotIn("${{", run_block(chunk), sid)

    def test_no_secrets_context(self) -> None:
        self.assertNotIn("secrets.", code())

    def test_no_forbidden_publication_command_in_workflow(self) -> None:
        for pattern in FORBIDDEN:
            self.assertNotRegex(code(), pattern)
        for line in code().splitlines():
            if "git push" in line:
                self.assertNotRegex(line, r"\s-f(\s|$)", line)


def run_gate(role: str) -> tuple[subprocess.CompletedProcess[str], str]:
    script = run_block(step("gate"))
    if not script:
        raise AssertionError("o passo gate não tem bloco run")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "output"
        out.write_text("")
        env = {"PATH": os.environ["PATH"], "ROLE": role, "GITHUB_OUTPUT": str(out)}
        proc = subprocess.run(
            ["bash", "-c", script], env=env, capture_output=True, text=True, check=False
        )
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


if __name__ == "__main__":
    unittest.main()
