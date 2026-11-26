"""Testes de infra/tools/release_gate.py e scripts/smoke-test.sh (#23).

O release-gate roda como processo, contra um repositório git descartável e arquivos JSON no
formato da API do GitHub. O smoke roda em bash com um `curl` falso no PATH. Sem rede.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GATE = ROOT / "infra" / "tools" / "release_gate.py"
SMOKE = ROOT / "scripts" / "smoke-test.sh"
SHA = "a" * 40
MAIN = "refs/heads/main"
STAGING = ".github/workflows/deploy-staging.yml"


def gate(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), *args], capture_output=True, text=True, timeout=30, check=False
    )


class TempDirTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def write(self, name: str, content: object) -> str:
        path = self.tmp / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
        return str(path)


@unittest.skipUnless(shutil.which("git"), "git ausente")
class ShaTest(TempDirTest):
    def git(self, *args: str) -> str:
        env = {"PATH": os.environ["PATH"], "HOME": str(self.tmp), "GIT_CONFIG_NOSYSTEM": "1"}
        identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]
        done = subprocess.run(
            ["git", "-C", str(self.tmp), *identity, *args], env=env, capture_output=True, text=True, check=True
        )
        return done.stdout.strip()

    def setUp(self) -> None:
        super().setUp()
        self.git("init", "-q", "-b", "main")
        self.git("commit", "-q", "--allow-empty", "-m", "um")
        self.in_main = self.git("rev-parse", "HEAD")
        self.git("checkout", "-q", "-b", "outra")
        self.git("commit", "-q", "--allow-empty", "-m", "dois")
        self.outside = self.git("rev-parse", "HEAD")

    def check(self, sha: str, ref: str = MAIN) -> subprocess.CompletedProcess[str]:
        return gate("sha", sha, "--ref", ref, "--repo", str(self.tmp), "--main", "main")

    def test_commit_of_main_is_accepted_and_echoed(self) -> None:
        done = self.check(self.in_main)
        self.assertEqual((done.returncode, done.stdout.strip()), (0, self.in_main), done.stderr)

    def test_refusals(self) -> None:
        cases = {
            "curto": (self.in_main[:12], MAIN),
            "maiúsculas": (self.in_main.upper(), MAIN),
            "injeção": (self.in_main + "; echo x", MAIN),
            "nome de branch": ("main", MAIN),
            "commit fora de main": (self.outside, MAIN),
            "commit inexistente": (SHA, MAIN),
            "workflow fora de main": (self.in_main, "refs/heads/outra"),
        }
        for name, (sha, ref) in cases.items():
            with self.subTest(name):
                done = self.check(sha, ref)
                self.assertEqual(done.returncode, 1, done.stderr)
                self.assertEqual(done.stdout, "")
                self.assertIn("::error::", done.stderr)


def run(**overrides: object) -> dict[str, object]:
    base = {"id": 7, "head_sha": SHA, "head_branch": "main", "event": "push", "path": STAGING,
            "status": "completed", "conclusion": "success"}  # fmt: skip
    return {**base, **overrides}


def jobs(job_conclusion: str = "success", smoke: str | None = "success") -> dict[str, object]:
    steps = [{"name": "Gate de configuração", "conclusion": "success"}]
    if smoke is not None:
        steps.append({"name": "Smoke test", "conclusion": smoke})
    deploy = {"name": "deploy (staging)", "conclusion": job_conclusion, "steps": steps}
    return {"jobs": [{"name": "build (bundle e zip das Lambdas)", "conclusion": "success"}, deploy]}


class StagingTest(TempDirTest):
    def run_id(self, runs: object) -> subprocess.CompletedProcess[str]:
        return gate("staging-run", SHA, self.write("runs.json", runs))

    def test_successful_run_of_the_sha_gives_its_id(self) -> None:
        done = self.run_id({"workflow_runs": [run(id=3), run(id=9), run(id=11, head_sha="b" * 40)]})
        self.assertEqual((done.returncode, done.stdout.strip()), (0, "9"), done.stderr)

    def test_sha_without_a_successful_staging_run_is_refused(self) -> None:
        others = [
            run(head_sha="b" * 40), run(conclusion="failure"), run(status="in_progress", conclusion=None),
            run(event="workflow_dispatch"), run(head_branch="outra"), run(path=".github/workflows/x.yml"),
        ]  # fmt: skip
        for runs in ([], others):
            with self.subTest(len(runs)):
                done = self.run_id({"workflow_runs": runs})
                self.assertEqual(done.returncode, 1, done.stderr)
                self.assertEqual(done.stdout, "")

    def test_unexpected_payload_is_invalid_input(self) -> None:
        self.assertEqual(self.run_id({"message": "Not Found"}).returncode, 2)
        self.assertEqual(gate("staging-run", SHA, self.write("runs.json", "{")).returncode, 2)
        self.assertEqual(gate("staging-jobs", self.write("jobs.json", [])).returncode, 2)
        self.assertEqual(gate("staging-jobs", str(self.tmp / "ausente.json")).returncode, 2)
        self.assertEqual(gate().returncode, 2)

    def test_deploy_and_smoke_succeeded(self) -> None:
        self.assertEqual(gate("staging-jobs", self.write("jobs.json", jobs())).returncode, 0)

    def test_skipped_or_failed_staging_deploy_is_refused(self) -> None:
        cases = {
            "deploy pulado (sem configuração)": jobs(smoke="skipped"),
            "smoke falhou": jobs(job_conclusion="failure", smoke="failure"),
            "job falhou depois do smoke": jobs(job_conclusion="failure"),
            "sem passo de smoke": jobs(smoke=None),
            "sem job de deploy": {"jobs": [{"name": "build", "conclusion": "success"}]},
        }
        for name, payload in cases.items():
            with self.subTest(name):
                done = gate("staging-jobs", self.write("jobs.json", payload))
                self.assertEqual(done.returncode, 1, done.stderr)
                self.assertIn("::error::", done.stderr)


class PricesTest(TempDirTest):
    def prices(self, manifest: object) -> subprocess.CompletedProcess[str]:
        self.write("release/site/prices/manifest.json", manifest)
        return gate("prices", str(self.tmp / "release"))

    def test_generated_prices_are_accepted(self) -> None:
        self.assertEqual(self.prices({"schemaVersion": 1, "source": "price-list"}).returncode, 0)

    def test_seed_is_refused_naming_the_reason(self) -> None:
        done = self.prices({"schemaVersion": 1, "source": "seed"})
        self.assertEqual(done.returncode, 1)
        self.assertIn("source: seed", done.stderr)

    def test_anything_but_price_list_fails_closed(self) -> None:
        for manifest in ({"source": "outro"}, {"schemaVersion": 1}, {"source": None}, ["seed"]):
            with self.subTest(manifest=manifest):
                self.assertEqual(self.prices(manifest).returncode, 1)
        self.assertEqual(self.prices("{").returncode, 2)
        self.assertEqual(gate("prices", str(self.tmp / "vazio")).returncode, 2)

    def test_the_committed_manifest_is_refused_only_while_it_is_the_seed(self) -> None:
        manifest = json.loads((ROOT / "web/public/prices/manifest.json").read_text("utf-8"))
        self.assertEqual(self.prices(manifest).returncode, 1 if manifest["source"] == "seed" else 0)


FAKE_CURL = """#!/bin/sh
# Último argumento é a URL; --output diz onde gravar; --write-out pede só o código HTTP.
out="" code=""
while [ "$#" -gt 1 ]; do
  case "$1" in
    --output) out="$2"; shift ;;
    --write-out) code=1; shift ;;
  esac
  shift
done
echo "$1" >> "$FAKE/log"
case "$1" in https://*) ;; *) exit 3 ;; esac
if [ -n "$code" ]; then printf '%s' "$(cat "$FAKE/quota")"; exit 0; fi
case "$1" in
  */config.json) file=config.json ;;
  */prices/manifest.json) file=manifest.json ;;
  *) file=index.html ;;
esac
[ -f "$FAKE/$file" ] || exit 22
[ "$out" = /dev/null ] || cp "$FAKE/$file" "$out"
"""
CONFIG = {"apiBaseUrl": "https://api.example.invalid", "cognitoClientId": "abc"}
MANIFEST = '{"schemaVersion":1,"source":"price-list"}\n'


@unittest.skipUnless(shutil.which("jq"), "jq ausente")
class SmokeTest(TempDirTest):
    def setUp(self) -> None:
        super().setUp()
        curl = Path(self.write("bin/curl", FAKE_CURL))
        curl.chmod(0o755)
        self.write("fake/index.html", "<html>")
        self.write("fake/config.json", json.dumps(CONFIG, indent=2))  # mesma coisa, outra forma
        self.write("fake/manifest.json", MANIFEST)
        self.write("fake/quota", "401")
        self.config = self.write("config.json", CONFIG)
        self.manifest = self.write("manifest.json", MANIFEST)

    def smoke(self, *args: str) -> subprocess.CompletedProcess[str]:
        defaults = ("https://site.example.invalid", "https://api.example.invalid", self.config, self.manifest)
        env = {"PATH": f"{self.tmp / 'bin'}:{os.environ['PATH']}", "FAKE": str(self.tmp / "fake"),
               "SMOKE_RETRY_DELAY": "0"}  # fmt: skip
        return subprocess.run(
            ["bash", str(SMOKE), *(args or defaults)], env=env, capture_output=True, text=True, timeout=60, check=False
        )

    def test_healthy_deploy_passes_and_hits_the_four_urls(self) -> None:
        done = self.smoke()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(
            (self.tmp / "fake" / "log").read_text("utf-8").split(),
            [
                "https://site.example.invalid/",
                "https://site.example.invalid/config.json",
                "https://site.example.invalid/prices/manifest.json",
                "https://api.example.invalid/quota",
            ],
        )

    def test_each_broken_piece_fails(self) -> None:
        breaks = {
            "site fora do ar": ("index.html", None, "curl"),
            "config diferente": ("config.json", '{"apiBaseUrl": "https://outra.example.invalid"}', "config.json"),
            "manifest de outro release": ("manifest.json", '{"schemaVersion":1,"source":"seed"}\n', "manifest.json"),
            "API aberta sem token": ("quota", "200", "401"),
        }
        for name, (file, content, expected) in breaks.items():
            with self.subTest(name):
                target = self.tmp / "fake" / file
                original = target.read_text("utf-8")
                target.unlink() if content is None else target.write_text(content, "utf-8")
                done = self.smoke()
                target.write_text(original, "utf-8")
                self.assertEqual(done.returncode, 22 if content is None else 1, done.stderr)
                if content is not None:
                    self.assertIn(expected, done.stderr)

    def test_wrong_usage_is_refused_before_any_request(self) -> None:
        site, api = "https://site.example.invalid", "https://api.example.invalid"
        for args in ((site,), ("http://site.example.invalid", api, self.config, self.manifest),
                     (site, "api.example.invalid", self.config, self.manifest),
                     (site, api, str(self.tmp / "ausente.json"), self.manifest)):  # fmt: skip
            with self.subTest(args=args):
                self.assertEqual(self.smoke(*args).returncode, 2)
        self.assertFalse((self.tmp / "fake" / "log").exists())


if __name__ == "__main__":
    unittest.main()
