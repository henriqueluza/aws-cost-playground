"""Testes do workflow deploy-production.yml (#23).

Leem o workflow como texto, com os mesmos auxiliares do teste de staging (sem PyYAML). O
passo `gate` é executado de verdade com bash. Também travam o que o release-gate espera de
`deploy-staging.yml` (nome do job, do passo de smoke e do artefato).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release_gate  # noqa: E402
from test_workflow_deploy_staging import all_runs, run_block, step, steps  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
TEXT = (WORKFLOWS / "deploy-production.yml").read_text(encoding="utf-8")
CODE = "\n".join(ln for ln in TEXT.splitlines() if not ln.lstrip().startswith("#"))
STAGING = (WORKFLOWS / "deploy-staging.yml").read_text(encoding="utf-8")
DOCS = (ROOT / "docs" / "infra.md").read_text(encoding="utf-8")
RUNBOOK = ROOT / "docs" / "runbooks" / "rollback.md"
DEPLOY_IDS = [
    "gate", "source", "download", "verify", "aws", "package", "terraform",
    "functions", "site", "config", "invalidate", "smoke", "summary",
]  # fmt: skip
# Passos que publicam: têm de ser os mesmos comandos de staging, só com o SHA informado.
MIRRORED = ["functions", "site", "config", "invalidate"]


def job(name: str, source: str = TEXT) -> str:
    match = re.search(rf"(?ms)^  {re.escape(name)}:\n(.*?)(?=^  \S|\Z)", source.split("\njobs:\n", 1)[1])
    if match is None:
        raise AssertionError(f"job `{name}` não encontrado")
    return match.group(1)


CHECK, DEPLOY = job("check"), job("deploy")


def joined(run: str) -> str:
    """Junta continuações de linha com barra invertida, com um espaço só."""
    return re.sub(r" *\\\n\s*", " ", run)


class TriggerAndPermissionsTest(unittest.TestCase):
    def test_trigger_is_only_manual_dispatch_with_a_required_sha(self) -> None:
        on = TEXT.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertEqual(re.findall(r"(?m)^  (\w+):", on), ["workflow_dispatch"])
        self.assertRegex(on, r"(?m)^      sha:\n(?:        .*\n)*?        required: true\n")
        for name in ("push", "pull_request", "pull_request_target", "workflow_run", "schedule", "workflow_call"):
            self.assertNotRegex(CODE, rf"(?m)^\s*{name}\b", f"gatilho proibido: {name}")

    def test_permissions_are_minimal_per_job(self) -> None:
        self.assertRegex(TEXT, r"(?m)^permissions:\n  contents: read\n(?!  \S)")
        perms = {name: set(re.findall(r"(?m)^      ([\w-]+: \w+)", text)) for name, text in (("check", CHECK), ("deploy", DEPLOY))}
        self.assertEqual(perms["check"], {"contents: read", "actions: read"})
        self.assertEqual(perms["deploy"], {"contents: read", "actions: read", "id-token: write"})

    def test_concurrency_serializes_without_cancelling(self) -> None:
        self.assertRegex(TEXT, r"(?m)^concurrency:\n  group: deploy-production\n  cancel-in-progress: false\n")

    def test_only_deploy_has_the_production_environment_and_oidc(self) -> None:
        self.assertRegex(DEPLOY, r"(?m)^    environment: production\s*$")
        self.assertRegex(DEPLOY, r"(?m)^    needs: check\s*$")
        self.assertIn("role-to-assume: ${{ vars.AWS_APPLY_ROLE_ARN }}", step(DEPLOY, "aws"))
        for token in ("environment:", "configure-aws-credentials", "vars.", "secrets."):
            self.assertNotIn(token, CHECK)

    def test_every_action_is_pinned_by_a_sha_already_used_in_staging(self) -> None:
        uses = re.findall(r"(?m)^\s*(?:- )?uses:\s*(\S+@[0-9a-f]{40})\s+# v\S+$", TEXT)
        self.assertEqual(len(uses), len(re.findall(r"(?m)^\s*(?:- )?uses:", TEXT)))
        for action in uses:
            self.assertIn(action, STAGING, f"{action} não é a versão fixada em deploy-staging.yml")

    def test_no_expression_inside_any_run_block_and_no_static_credentials(self) -> None:
        for run in all_runs(CHECK) + all_runs(DEPLOY):
            self.assertNotIn("${{", run)
        for token in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "aws-access-key-id", "aws-secret-access-key"):
            self.assertNotIn(token, CODE)

    def test_the_raw_input_only_reaches_the_validation_step(self) -> None:
        self.assertEqual(CODE.count("inputs.sha"), 1)
        chunk = next(s for sid, s in steps(CHECK) if sid == "sha")
        self.assertIn("INPUT_SHA: ${{ inputs.sha }}", chunk)
        self.assertIn('release_gate.py sha "$INPUT_SHA" --ref "$GITHUB_REF"', run_block(chunk))
        self.assertNotIn("github.sha", CODE)

    def test_the_email_is_the_only_secret_and_only_in_gate_and_terraform(self) -> None:
        self.assertEqual(set(re.findall(r"secrets\.\w+", CODE)), {"secrets.TF_VAR_ALARM_EMAIL"})
        for sid, chunk in steps(DEPLOY):
            self.assertEqual("secrets." in chunk, sid in ("gate", "terraform"), f"secret no passo {sid}")

    def test_every_variable_and_secret_is_documented(self) -> None:
        for name in sorted(set(re.findall(r"(?:vars|secrets)\.(\w+)", CODE))):
            self.assertIn(f"`{name}`", DOCS, f"{name} falta em docs/infra.md")


class SameArtifactTest(unittest.TestCase):
    def test_check_finds_the_staging_run_and_requires_its_smoke(self) -> None:
        run = joined(run_block(step(CHECK, "staging")))
        self.assertIn("actions/workflows/deploy-staging.yml/runs", run)
        self.assertRegex(run, r'run_id=\$\(python3 infra/tools/release_gate\.py staging-run "\$SHA" ')
        self.assertRegex(run, r'actions/runs/\$run_id/jobs" -f filter=latest')
        self.assertLess(run.index("release_gate.py staging-jobs"), run.index('>> "$GITHUB_OUTPUT"'))

    def test_staging_still_has_what_the_gate_looks_for(self) -> None:
        staging_deploy = job("deploy", STAGING)
        self.assertIn(f"    name: {release_gate.STAGING_DEPLOY_JOB}\n", staging_deploy)
        self.assertIn(f"      - name: {release_gate.STAGING_SMOKE_STEP}\n        id: smoke\n", staging_deploy)
        self.assertTrue((ROOT / release_gate.STAGING_WORKFLOW).exists())
        self.assertRegex(STAGING, r"(?m)^\s+name: release-\$\{\{ github\.sha \}\}\s*$")

    def test_both_jobs_download_the_artifact_of_that_staging_run(self) -> None:
        for text, prefix in ((CHECK, "steps.sha.outputs.sha"), (DEPLOY, "needs.check.outputs.sha")):
            chunk = next(s for _, s in steps(text) if "actions/download-artifact@" in s)
            self.assertRegex(chunk, rf"(?m)^\s+name: release-\$\{{\{{ {re.escape(prefix)} \}}\}}\s*$")
            self.assertRegex(chunk, r"(?m)^\s+run-id: \$\{\{ \S+\.outputs\.run_id \}\}\s*$")

    def test_integrity_and_price_source_are_checked_before_credentials(self) -> None:
        check_runs = "\n".join(all_runs(CHECK))
        verify = run_block(step(DEPLOY, "verify"))
        for run in (check_runs, verify):
            self.assertIn("sha256sum --check --strict SHA256SUMS", run)
            self.assertIn('release_gate.py prices "$RUNNER_TEMP/release"', run)
        self.assertLess(DEPLOY_IDS.index("verify"), DEPLOY_IDS.index("aws"))

    def test_deploy_never_rebuilds_and_uploads_no_artifact(self) -> None:
        runs = "\n".join(all_runs(CHECK) + all_runs(DEPLOY))
        self.assertNotRegex(runs, r"\b(npm|npx|uv)\b")
        self.assertNotIn("build-functions.sh", runs)
        self.assertNotIn("upload-artifact", CODE)

    def test_publishing_steps_are_the_same_commands_as_staging(self) -> None:
        staging_deploy = job("deploy", STAGING)
        for sid in MIRRORED:
            self.assertEqual(run_block(step(DEPLOY, sid)), run_block(step(staging_deploy, sid)), sid)
        swap = {"$GITHUB_SHA": "$SHA", "staging": "produção"}
        for sid in ("package", "terraform"):
            ours, theirs = (
                [ln for ln in run_block(step(text, sid)).splitlines() if not ln.lstrip().startswith(("#", "echo"))]
                for text in (DEPLOY, staging_deploy)
            )
            for old, new in swap.items():
                theirs = [ln.replace(old, new) for ln in theirs]
            self.assertEqual(ours, theirs, sid)


class DeployStepsTest(unittest.TestCase):
    def test_step_ids_are_in_the_exact_order(self) -> None:
        self.assertEqual([sid for sid, _ in steps(DEPLOY) if sid], DEPLOY_IDS)
        section = DOCS.split("## Ordem do job `deploy` de produção\n", 1)[1].split("\n## ", 1)[0]
        self.assertEqual([i for i in re.findall(r"`(\w+)`", section) if i in DEPLOY_IDS], DEPLOY_IDS)

    def test_terraform_is_the_production_env_of_the_published_sha(self) -> None:
        self.assertRegex(step(DEPLOY, "source"), r"(?m)^\s+ref: \$\{\{ needs\.check\.outputs\.sha \}\}\s*$")
        self.assertRegex(step(DEPLOY, "source"), r"(?m)^\s+path: release-src\s*$")
        chunk = step(DEPLOY, "terraform")
        self.assertRegex(chunk, r"(?m)^\s+working-directory: release-src/infra/envs/production\s*$")
        self.assertIn("TF_STATE_BUCKET: ${{ vars.TF_STATE_BUCKET_PRODUCTION }}", chunk)
        self.assertIn('"$GITHUB_WORKSPACE/infra/tools/plan_guard.py"', run_block(chunk))
        self.assertNotIn("TF_STATE_BUCKET_STAGING", CODE)

    def test_smoke_runs_the_versioned_script_against_the_release_manifest(self) -> None:
        run = joined(run_block(step(DEPLOY, "smoke")))
        self.assertEqual(
            run,
            'scripts/smoke-test.sh "$SITE_URL" "$API_BASE_URL" "$RUNNER_TEMP/config.json" '
            '"$RUNNER_TEMP/release/site/prices/manifest.json"',
        )

    def test_runbook_explains_rollback_through_this_workflow(self) -> None:
        self.assertTrue(RUNBOOK.exists(), "docs/runbooks/rollback.md não existe")
        runbook = RUNBOOK.read_text(encoding="utf-8")
        for token in ("deploy-production.yml", "SHA anterior", "workflow_dispatch", "plan-guard", "90 dias"):
            self.assertIn(token, runbook)


GATE_FIELDS = {
    "AWS_APPLY_ROLE_ARN": "arn:aws:iam::123456789012:role/papel-secreto-xyz",
    "TF_VAR_PACKAGE_BUCKET": "bucket-pacote-secreto-xyz",
    "TF_STATE_BUCKET_PRODUCTION": "bucket-estado-secreto-xyz",
    "TF_VAR_ZONE_NAME": "zona-secreta-xyz.example",
    "TF_VAR_ALARM_EMAIL_SET": "true",
}


class GateBehaviorTest(unittest.TestCase):
    def run_gate(self, **overrides: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            env = {"PATH": os.environ["PATH"], "GITHUB_OUTPUT": str(Path(tmp) / "output"), **GATE_FIELDS, **overrides}
            return subprocess.run(
                ["bash", "-eo", "pipefail", "-c", run_block(step(DEPLOY, "gate"))],
                env=env, capture_output=True, text=True, timeout=30, check=False,
            )  # fmt: skip

    def test_all_filled_passes(self) -> None:
        self.assertEqual(self.run_gate().returncode, 0)

    def test_any_missing_value_fails_closed_naming_only_the_field(self) -> None:
        for field in GATE_FIELDS:
            with self.subTest(field=field):
                done = self.run_gate(**{field: "false" if field.endswith("_SET") else ""})
                combined = done.stdout + done.stderr
                self.assertEqual(done.returncode, 1, combined)
                self.assertRegex(combined, rf"::error::[^\n]*{field.removesuffix('_SET')}")
                self.assertNotIn("::warning::", combined)
                for value in GATE_FIELDS.values():
                    self.assertFalse(value != "true" and value in combined, "valor vazou na saída")


if __name__ == "__main__":
    unittest.main()
