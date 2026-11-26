"""Testes do workflow deploy-staging.yml (#22).

Leem o workflow como texto (sem PyYAML, que o runner não garante). O arquivo vive em
`.github/workflows/` e, enquanto o autor não faz o `git mv`, em `.github/workflows-pending/`;
o teste usa o que existir. O passo `gate` é executado de verdade com bash.
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
LIVE = ROOT / ".github" / "workflows" / "deploy-staging.yml"
PENDING = ROOT / ".github" / "workflows-pending" / "deploy-staging.yml"
DOCS = ROOT / "docs" / "infra.md"
STEP_START = re.compile(r"^      - ", re.M)
GATE_CONDITION = "if: steps.gate.outputs.configured == 'true'"
DEPLOY_IDS = [
    "gate", "download", "verify", "aws", "package", "terraform",
    "functions", "site", "config", "invalidate", "smoke", "summary",
]  # fmt: skip


def workflow_path() -> Path:
    """Caminho do workflow: o que existir entre o ativo e o pendente."""
    found = [p for p in (LIVE, PENDING) if p.exists()]
    if len(found) != 1:
        raise AssertionError(f"esperado exatamente um deploy-staging.yml, achei: {found}")
    return found[0]


def text() -> str:
    return workflow_path().read_text(encoding="utf-8")


def code() -> str:
    """Workflow sem linhas inteiras de comentário."""
    return "\n".join(ln for ln in text().splitlines() if not ln.lstrip().startswith("#"))


def job(name: str) -> str:
    """Texto do job `name` (do cabeçalho até o próximo job)."""
    body = text().split("\njobs:\n", 1)[1]
    match = re.search(rf"(?ms)^  {re.escape(name)}:\n(.*?)(?=^  \S|\Z)", body)
    if match is None:
        raise AssertionError(f"job `{name}` não encontrado")
    return match.group(1)


def steps(job_text: str) -> list[tuple[str | None, str]]:
    """Lista de (id, texto) dos passos do job; vazia se `steps: []`."""
    if "    steps:\n" not in job_text:
        return []
    body = job_text.split("    steps:\n", 1)[1]
    starts = [m.start() for m in STEP_START.finditer(body)]
    out = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(body)
        chunk = body[start:end]
        found = re.search(r"(?m)^(?:      - |        )id:\s*(\S+)", chunk)
        out.append((found.group(1) if found else None, chunk))
    return out


def step(job_text: str, step_id: str) -> str:
    for sid, chunk in steps(job_text):
        if sid == step_id:
            return chunk
    raise AssertionError(f"passo `{step_id}` não encontrado")


def run_block(step_text: str) -> str:
    """Conteúdo (desindentado) do `run:` do passo; vazio se não houver."""
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


def all_runs(job_text: str) -> list[str]:
    return [r for _, s in steps(job_text) if (r := run_block(s))]


def joined(run: str) -> str:
    """Junta continuações de linha com barra invertida."""
    return re.sub(r"\\\n\s*", " ", run)


def deploy_step_texts() -> dict[str, str]:
    return {sid: s for sid, s in steps(job("deploy")) if sid}


class TriggerAndPermissionsTest(unittest.TestCase):
    def test_trigger_is_only_push_to_main(self) -> None:
        on = text().split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertRegex(on, r"(?m)^  push:\n    branches: \[main\]\s*$")
        self.assertEqual(re.findall(r"(?m)^  (\w+):", on), ["push"])

    def test_no_forbidden_trigger_anywhere(self) -> None:
        for name in ("pull_request", "pull_request_target", "workflow_run", "workflow_dispatch"):
            self.assertNotRegex(code(), rf"(?m)^\s*{name}\b", f"gatilho proibido: {name}")

    def test_top_level_permissions_are_read_only(self) -> None:
        self.assertRegex(text(), r"(?m)^permissions:\n  contents: read\n(?!  \S)")

    def test_concurrency_serializes_without_cancelling(self) -> None:
        self.assertRegex(
            text(),
            r"(?m)^concurrency:\n  group: deploy-staging\n  cancel-in-progress: false\n",
        )


class JobsTest(unittest.TestCase):
    def test_jobs_are_build_then_deploy(self) -> None:
        self.assertEqual(re.findall(r"(?m)^  (\w+):\s*$", text().split("\njobs:\n", 1)[1]), ["build", "deploy"])
        self.assertRegex(job("deploy"), r"(?m)^    needs: build\s*$")

    def test_steps_are_filled_in(self) -> None:
        for name in ("build", "deploy"):
            self.assertTrue(steps(job(name)), f"job `{name}` ainda sem passos (`steps: []`)")

    def test_only_deploy_has_environment_and_oidc(self) -> None:
        deploy, build = job("deploy"), job("build")
        self.assertRegex(deploy, r"(?m)^    environment: staging\s*$")
        self.assertRegex(deploy, r"(?m)^      id-token: write\b")
        self.assertNotIn("id-token", build)
        self.assertNotRegex(build, r"(?m)^    environment:")
        self.assertNotIn("configure-aws-credentials", build)

    def test_every_action_is_pinned_by_sha_with_version_comment(self) -> None:
        uses = [ln for ln in text().splitlines() if re.match(r"^\s*(- )?uses:", ln)]
        self.assertTrue(uses, "nenhum `uses:` encontrado")
        for ln in uses:
            self.assertRegex(ln, r"uses:\s*[\w.-]+/[\w./-]+@[0-9a-f]{40}\s+# v\S+", ln)


class SecretsAndInterpolationTest(unittest.TestCase):
    def test_no_expression_inside_any_run_block(self) -> None:
        for name in ("build", "deploy"):
            for run in all_runs(job(name)):
                self.assertNotIn("${{", run, f"`${{{{` dentro de run no job {name}:\n{run}")

    def test_no_static_aws_credentials(self) -> None:
        for token in (
            "aws-access-key-id", "aws-secret-access-key",
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
        ):  # fmt: skip
            self.assertNotIn(token, code())

    def test_the_email_is_the_only_secret_and_only_in_gate_and_terraform(self) -> None:
        self.assertEqual(set(re.findall(r"secrets\.\w+", code())), {"secrets.TF_VAR_ALARM_EMAIL"})
        for sid, chunk in steps(job("deploy")):
            has = "secrets." in chunk
            self.assertEqual(has, sid in ("gate", "terraform"), f"secret no passo {sid}")
        self.assertNotIn("secrets.", job("build"))
        self.assertIn("secrets.TF_VAR_ALARM_EMAIL != ''", step(job("deploy"), "gate"))

    def test_every_variable_and_secret_is_documented(self) -> None:
        self.assertTrue(DOCS.exists(), "docs/infra.md não existe")
        docs = DOCS.read_text(encoding="utf-8")
        names = set(re.findall(r"(?:vars|secrets)\.(\w+)", code()))
        self.assertTrue(names)
        for name in sorted(names):
            self.assertIn(f"`{name}`", docs, f"{name} falta em docs/infra.md")


class BuildScriptTest(unittest.TestCase):
    def test_build_functions_requires_exactly_one_argument(self) -> None:
        for args in ([], ["a", "b"]):
            proc = subprocess.run(
                ["bash", str(ROOT / "scripts" / "build-functions.sh"), *args],
                capture_output=True, text=True, timeout=30, check=False,
            )  # fmt: skip
            self.assertEqual(proc.returncode, 2, f"{args}: {proc.stdout}{proc.stderr}")


class ArtifactTest(unittest.TestCase):
    def test_build_and_deploy_use_the_same_artifact_name(self) -> None:
        up = step_using("build", "upload-artifact")
        down = step_using("deploy", "download-artifact")
        for chunk in (up, down):
            self.assertRegex(chunk, r"(?m)^\s+name: release-\$\{\{ github\.sha \}\}\s*$")

    def test_artifact_is_kept_for_90_days(self) -> None:
        self.assertRegex(step_using("build", "upload-artifact"), r"(?m)^\s+retention-days: 90\s*$")

    def test_build_builds_functions_and_site(self) -> None:
        runs = "\n".join(all_runs(job("build")))
        self.assertIn("scripts/build-functions.sh", runs)
        self.assertRegex(runs, r"\bnpm run build\b")

    def test_deploy_never_rebuilds(self) -> None:
        runs = "\n".join(all_runs(job("deploy")))
        self.assertNotRegex(runs, r"\b(npm|npx|uv)\b")
        self.assertNotIn("build-functions.sh", runs)


def step_using(job_name: str, action: str) -> str:
    for _, chunk in steps(job(job_name)):
        if re.search(rf"(?m)^\s*(- )?uses:\s*actions/{action}@", chunk):
            return chunk
    raise AssertionError(f"job {job_name} não usa actions/{action}")


class DeployStepsTest(unittest.TestCase):
    def test_step_ids_are_in_the_exact_order(self) -> None:
        ids = [sid for sid, _ in steps(job("deploy")) if sid]
        self.assertEqual(ids, DEPLOY_IDS)

    def test_every_step_after_the_gate_requires_it_configured(self) -> None:
        listed = steps(job("deploy"))
        first_gate = next((i for i, (sid, _) in enumerate(listed) if sid == "gate"), None)
        self.assertIsNotNone(first_gate, "passo gate ausente")
        for sid, chunk in listed[first_gate + 1 :]:
            self.assertIn(GATE_CONDITION, chunk, f"passo {sid or chunk[:40]!r} sem a condição do gate")

    def test_aws_step_assumes_the_apply_role(self) -> None:
        chunk = step(job("deploy"), "aws")
        self.assertIn("role-to-assume: ${{ vars.AWS_APPLY_ROLE_ARN }}", chunk)

    def test_package_is_write_once_under_the_sha_key(self) -> None:
        run = run_block(step(job("deploy"), "package"))
        self.assertIn("functions/$GITHUB_SHA.zip", run)
        self.assertIn("--if-none-match", run)

    def test_terraform_applies_the_saved_plan_after_the_guard(self) -> None:
        chunk = step(job("deploy"), "terraform")
        run = joined(run_block(chunk))
        self.assertIn("plan_guard.py", run)
        for token in ("infra:destroy-approved", "APPROVED"):
            self.assertNotIn(token, chunk)
        self.assertRegex(run, r"\bapply\b(?:\s+-\S+)*\s+[^-\s]\S*", "apply deve receber o arquivo do plano")
        self.assertIn("TF_VAR_package_key: ${{ steps.package.outputs.package_key }}", chunk)

    def test_package_fails_closed_on_a_different_stored_object(self) -> None:
        run = run_block(step(job("deploy"), "package"))
        self.assertIn("ConditionalRequestConflict", run)
        self.assertNotIn("vale o objeto guardado", run)
        self.assertNotIn('b64="$stored"', run)

    def test_functions_wait_and_compare_the_hash_without_redeploying_code(self) -> None:
        chunk = step(job("deploy"), "functions")
        self.assertIn("function-updated-v2", chunk)
        self.assertIn("CodeSha256", chunk)
        self.assertNotIn("update-function-code", chunk)

    def test_site_uploads_assets_first_and_never_deletes(self) -> None:
        run = joined(run_block(step(job("deploy"), "site")))
        self.assertNotIn("--delete", run)
        syncs = [ln for ln in run.splitlines() if re.search(r"s3 (sync|cp)\b", ln)]
        self.assertGreaterEqual(len(syncs), 2, "esperado um envio de assets e um do resto (s3 sync ou s3 cp)")
        assets = next((i for i, ln in enumerate(syncs) if "$site/assets" in ln), None)
        self.assertIsNotNone(assets, "falta o envio de $site/assets")
        for i, ln in enumerate(syncs):
            if i != assets:
                self.assertRegex(ln, r"--exclude\s+\S*config\.json", f"envio sem excluir config.json: {ln}")
        self.assertEqual(assets, 0, "assets deve subir antes do resto")

    def test_invalidation_is_a_single_wildcard_path(self) -> None:
        run = joined(run_block(step(job("deploy"), "invalidate")))
        self.assertEqual(run.count("--paths"), 1)
        self.assertRegex(run, r"--paths '/\*'(?:\s*$|\s+--)")

    def test_smoke_expects_401_from_quota(self) -> None:
        run = run_block(step(job("deploy"), "smoke"))
        self.assertIn("/quota", run)
        self.assertIn("401", run)
        self.assertRegex(run, r'--fail[^\n]*"\$SITE_URL/"|curl_opts=\([^)]*--fail')
        self.assertRegex(run, r'jq -S[^\n]*\$RUNNER_TEMP/config\.json')

    def test_config_is_validated_then_published_from_the_generated_file(self) -> None:
        run = run_block(step(job("deploy"), "config"))
        for key in ("apiBaseUrl", "cognitoAuthority", "cognitoClientId"):
            self.assertIn(key, run.split("jq -c", 1)[0])
        self.assertIn("jq -e", run)
        self.assertRegex(run, r's3 cp "\$RUNNER_TEMP/config\.json" [^\n]*--content-type application/json')
        self.assertNotIn("release/site/config.json", run)

    def test_docs_list_the_deploy_ids_in_order(self) -> None:
        docs = DOCS.read_text(encoding="utf-8")
        section = docs.split("## Ordem do job `deploy`\n", 1)[1].split("\n## ", 1)[0]
        self.assertEqual([i for i in re.findall(r"`(\w+)`", section) if i in DEPLOY_IDS], DEPLOY_IDS)


GATE_FIELDS = {
    "AWS_APPLY_ROLE_ARN": "arn:aws:iam::123456789012:role/papel-secreto-xyz",
    "TF_VAR_PACKAGE_BUCKET": "bucket-pacote-secreto-xyz",
    "TF_STATE_BUCKET_STAGING": "bucket-estado-secreto-xyz",
    "TF_VAR_ZONE_NAME": "zona-secreta-xyz.example",
    "TF_VAR_ALARM_EMAIL_SET": "true",
}


def run_gate(**overrides: str) -> tuple[subprocess.CompletedProcess[str], str]:
    """Executa o `run` do passo gate; devolve (processo, conteúdo de GITHUB_OUTPUT)."""
    script = run_block(step(job("deploy"), "gate"))
    if not script:
        raise AssertionError("o passo gate não tem bloco run")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "output"
        out.touch()
        env = {"PATH": os.environ["PATH"], "GITHUB_OUTPUT": str(out)}
        env.update({k: "" for k in GATE_FIELDS})
        env.update(overrides)
        proc = subprocess.run(
            ["bash", "-eo", "pipefail", "-c", script],
            env=env, capture_output=True, text=True, timeout=30, check=False,
        )  # fmt: skip
        return proc, out.read_text(encoding="utf-8")


class GateBehaviorTest(unittest.TestCase):
    def test_all_empty_warns_and_finishes_green_unconfigured(self) -> None:
        proc, out = run_gate(TF_VAR_ALARM_EMAIL_SET="false")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("::warning::", proc.stdout)
        self.assertIn("AWS_APPLY_ROLE_ARN", proc.stdout)
        self.assertIn("configured=false", out)

    def test_all_filled_is_configured(self) -> None:
        proc, out = run_gate(**GATE_FIELDS)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("configured=true", out)
        self.assertNotIn("configured=false", out)

    def test_role_without_package_bucket_fails_naming_only_the_missing_field(self) -> None:
        proc, out = run_gate(**{**GATE_FIELDS, "TF_VAR_PACKAGE_BUCKET": ""})
        combined = proc.stdout + proc.stderr
        self.assertEqual(proc.returncode, 1, combined)
        self.assertRegex(combined, r"::error::[^\n]*TF_VAR_PACKAGE_BUCKET")
        for key, value in GATE_FIELDS.items():
            if key != "TF_VAR_ALARM_EMAIL_SET" and value:
                self.assertNotIn(value, combined, f"valor de {key} vazou na saída")
        self.assertNotIn("configured=true", out)

    def test_role_without_alarm_email_fails_naming_the_secret(self) -> None:
        proc, _ = run_gate(**{**GATE_FIELDS, "TF_VAR_ALARM_EMAIL_SET": "false"})
        combined = proc.stdout + proc.stderr
        self.assertEqual(proc.returncode, 1, combined)
        self.assertRegex(combined, r"::error::[^\n]*TF_VAR_ALARM_EMAIL")

    def test_role_with_any_other_field_missing_fails_naming_it(self) -> None:
        for field in ("TF_STATE_BUCKET_STAGING", "TF_VAR_ZONE_NAME"):
            with self.subTest(field=field):
                proc, _ = run_gate(**{**GATE_FIELDS, field: ""})
                combined = proc.stdout + proc.stderr
                self.assertEqual(proc.returncode, 1, combined)
                self.assertRegex(combined, rf"::error::[^\n]*{field}")


if __name__ == "__main__":
    unittest.main()
