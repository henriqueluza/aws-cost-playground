"""Testes de scripts/prices-pr.sh (#29, parte 1).

O script é executado de verdade com bash contra um `origin` bare descartável (clone raso via
`file://`) e um `gh` falso no PATH que grava os argumentos num log. Não depende do workflow.
Sem rede.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "prices-pr.sh"
LAMBDA = "web/public/prices/us-east-1/lambda.json"
MANIFEST = "web/public/prices/manifest.json"
BRANCH_REF = "refs/heads/prices/catalogo"
FORBIDDEN = [r"gh pr " + r"merge", r"--label", r"skip-review", r"--force", r"\+refs"]


class ForbiddenCommandTest(unittest.TestCase):
    def test_script_has_no_forbidden_publication_command(self) -> None:
        src = "\n".join(
            ln for ln in SCRIPT.read_text("utf-8").splitlines() if not ln.lstrip().startswith("#")
        )
        for pattern in FORBIDDEN:
            self.assertNotRegex(src, pattern)
        for line in src.splitlines():
            if "git push" in line:
                self.assertNotRegex(line, r"\s-f(\s|$)", line)


FAKE_GH = """#!/bin/sh
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "pr list") [ -f "$GH_STATE" ] && cat "$GH_STATE"; exit 0 ;;
  "pr create") echo 7 > "$GH_STATE"; echo "https://example.invalid/pull/7"; exit 0 ;;
  "pr close") rm -f "$GH_STATE"; exit 0 ;;
  "pr edit") exit 0 ;;
esac
exit 0
"""


@unittest.skipUnless(shutil.which("git"), "git ausente")
class PublishScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        base = Path(tmp.name)
        self.origin = base / "origin.git"
        self.clone = base / "clone"
        self.log = base / "gh.log"
        self.state = base / "gh.state"
        self.log.write_text("")
        bindir = base / "bin"
        bindir.mkdir()
        gh = bindir / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.body = base / "body.md"
        self.body.write_text("corpo\n")
        self.env = {
            "PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}",
            "HOME": str(base),
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_SYSTEM": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_AUTHOR_NAME": "Teste",
            "GIT_AUTHOR_EMAIL": "teste@example.invalid",
            "GIT_COMMITTER_NAME": "Teste",
            "GIT_COMMITTER_EMAIL": "teste@example.invalid",
            "GH_LOG": str(self.log),
            "GH_STATE": str(self.state),
        }
        self.git(base, "init", "--bare", "-b", "main", str(self.origin))
        seed = base / "seed"
        self.git(base, "init", "-b", "main", str(seed))
        for rel, content in {
            LAMBDA: '{"price": 1}\n',
            MANIFEST: '{"generated": "a"}\n',
            "README.md": "fora de prices\n",
        }.items():
            path = seed / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.git(seed, "add", ".")
        self.git(seed, "commit", "-m", "seed")
        self.git(seed, "push", str(self.origin), "main")
        self.git(base, "clone", "--depth=1", f"file://{self.origin}", str(self.clone))
        (self.clone / "scripts").mkdir()
        shutil.copy(SCRIPT, self.clone / "scripts" / "prices-pr.sh")
        self.main_sha = self.remote_sha("refs/heads/main")

    def git(self, cwd: Path, *args: str) -> str:
        proc = subprocess.run(
            ["git", *args], cwd=cwd, env=self.env, capture_output=True, text=True, check=False
        )
        self.assertEqual(proc.returncode, 0, f"git {args}: {proc.stderr}")
        return proc.stdout.strip()

    def remote_sha(self, ref: str) -> str:
        proc = subprocess.run(
            ["git", "rev-parse", "--verify", "-q", ref],
            cwd=self.origin, env=self.env, capture_output=True, text=True, check=False,
        )  # fmt: skip
        return proc.stdout.strip()

    def write(self, rel: str, content: str) -> None:
        path = self.clone / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def publish(self, *args: str) -> subprocess.CompletedProcess[str]:
        call = args if args else (str(self.body),)
        proc = subprocess.run(
            ["bash", "scripts/prices-pr.sh", *call],
            cwd=self.clone, env=self.env, capture_output=True, text=True, check=False,
        )  # fmt: skip
        self.assertEqual(self.remote_sha("refs/heads/main"), self.main_sha, "main do origin mudou")
        return proc

    def ok(self, expected: str) -> None:
        proc = self.publish()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), expected, proc.stderr)

    def gh_calls(self) -> list[str]:
        return self.log.read_text().splitlines()

    def tip(self) -> str:
        return self.remote_sha(BRANCH_REF)

    def test_change_creates_branch_and_pr(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        self.ok("pr criado")
        tip = self.tip()
        self.assertTrue(tip)
        parents = self.git(self.origin, "rev-list", "--parents", "-n1", tip).split()[1:]
        self.assertEqual(parents, [self.main_sha])
        changed = self.git(self.origin, "diff", "--name-only", self.main_sha, tip).splitlines()
        self.assertTrue(changed)
        self.assertTrue(all(p.startswith("web/public/prices/") for p in changed), changed)
        self.assertIn(LAMBDA, changed)
        create = [c for c in self.gh_calls() if c.startswith("pr create")]
        self.assertEqual(len(create), 1)
        for part in ("--base main", "--head prices/catalogo", f"--body-file {self.body}"):
            self.assertIn(part, create[0])

    def test_second_change_fast_forwards_and_edits_the_pr(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        self.ok("pr criado")
        first = self.tip()
        self.write(LAMBDA, '{"price": 3}\n')
        self.ok("pr atualizado")
        second = self.tip()
        self.assertNotEqual(first, second)
        self.git(self.origin, "merge-base", "--is-ancestor", first, second)
        parents = self.git(self.origin, "rev-list", "--parents", "-n1", second).split()[1:]
        self.assertEqual(parents, [self.main_sha, first])
        edit = [c for c in self.gh_calls() if c.startswith("pr edit")]
        self.assertEqual(len(edit), 1)
        self.assertIn("7", edit[0].split())
        self.assertIn(f"--body-file {self.body}", edit[0])
        self.assertEqual(len([c for c in self.gh_calls() if c.startswith("pr create")]), 1)

    def test_only_manifest_changed_is_no_change(self) -> None:
        self.write(MANIFEST, '{"generated": "b"}\n')
        self.ok("sem mudança")
        self.assertEqual(self.tip(), "")
        self.assertEqual([c for c in self.gh_calls() if c.startswith("pr create")], [])

    def test_same_content_as_remote_tip_is_no_change_without_push(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        self.ok("pr criado")
        tip = self.tip()
        self.write(MANIFEST, '{"generated": "c"}\n')  # só o manifest difere da ponta
        self.ok("sem mudança")
        self.assertEqual(self.tip(), tip)
        self.assertEqual([c for c in self.gh_calls() if c.startswith("pr edit")], [])

    def test_same_content_as_tip_without_open_pr_creates_pr_without_push(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        self.ok("pr criado")
        tip = self.tip()
        self.state.unlink()  # o PR foi fechado por fora
        self.ok("pr criado")
        self.assertEqual(self.tip(), tip)
        self.assertEqual(len([c for c in self.gh_calls() if c.startswith("pr create")]), 2)
        self.assertEqual([c for c in self.gh_calls() if c.startswith("pr edit")], [])

    def test_equal_to_main_with_open_pr_closes_it(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        self.ok("pr criado")
        self.write(LAMBDA, '{"price": 1}\n')  # volta ao conteúdo de main
        self.ok("pr fechado")
        close = [c for c in self.gh_calls() if c.startswith("pr close")]
        self.assertEqual(len(close), 1)
        self.assertIn("7", close[0].split())
        self.assertIn("--comment", close[0])

    def test_equal_to_main_without_pr_is_no_change(self) -> None:
        self.ok("sem mudança")
        self.assertEqual(self.tip(), "")
        self.assertEqual([c for c in self.gh_calls() if c.startswith("pr close")], [])

    def test_new_untracked_file_counts_as_change(self) -> None:
        self.write("web/public/prices/us-east-1/ec2.json", '{"price": 9}\n')
        self.ok("pr criado")
        changed = self.git(self.origin, "diff", "--name-only", self.main_sha, self.tip())
        self.assertEqual(changed.splitlines(), ["web/public/prices/us-east-1/ec2.json"])

    def test_pr_discovery_uses_the_documented_query(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        self.ok("pr criado")
        listing = [c for c in self.gh_calls() if c.startswith("pr list")]
        self.assertTrue(listing)
        for part in ("--head prices/catalogo", "--base main", "--state open"):
            self.assertIn(part, listing[0])
        self.assertRegex(listing[0], r"--json \S*isCrossRepository")
        self.assertIn("select(.isCrossRepository | not)", listing[0])

    def test_without_argument_exits_2(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        proc = subprocess.run(
            ["bash", "scripts/prices-pr.sh"],
            cwd=self.clone, env=self.env, capture_output=True, text=True, check=False,
        )  # fmt: skip
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(self.tip(), "")
        self.assertEqual(self.remote_sha("refs/heads/main"), self.main_sha)

    def test_missing_body_file_exits_2(self) -> None:
        self.write(LAMBDA, '{"price": 2}\n')
        proc = self.publish(str(self.body) + ".nao-existe")
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(self.tip(), "")



if __name__ == "__main__":
    unittest.main()
