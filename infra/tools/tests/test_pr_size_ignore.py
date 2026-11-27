"""O kit de agentes conta no tamanho do PR (#387, decisão do autor de 26/11/2026, item 8d).

Roda `scripts/pr-size.py` de verdade, com o `.github/pr-size-ignore` do repositório, num
repositório git temporário: hooks, scripts e JSON de `.claude/` e `.agents/` entram na conta,
e só os Markdown ficam fora.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
IGNORE = ROOT / ".github" / "pr-size-ignore"
FILES = {
    ".claude/hooks/guard.sh": 3,
    ".claude/settings.json": 2,
    ".agents/skills/exemplo/scripts/run.py": 4,
    ".claude/skills/exemplo/SKILL.md": 5,
    ".agents/skills/exemplo/SKILL.md": 5,
    "docs/nota.md": 6,
    "web/public/prices/catalogo.json": 7,
}
COUNTED = [path for path in FILES if not path.endswith(".md") and not path.startswith("web/public/prices/")]


def measure(files: dict[str, int]) -> str:
    """Saída do pr-size.py para um PR que cria `files` (caminho -> número de linhas)."""
    env = {key: value for key, value in os.environ.items() if not key.startswith(("GIT_", "PR_", "GITHUB_"))}
    with tempfile.TemporaryDirectory() as folder:
        repo = Path(folder)

        def git(*args: str) -> None:
            identity = ["-c", "user.name=teste", "-c", "user.email=teste@example.com", "-c", "commit.gpgsign=false"]
            subprocess.run(["git", *identity, *args], cwd=repo, env=env, check=True, capture_output=True)

        git("init", "--quiet", "--initial-branch=base")
        (repo / ".github").mkdir()
        (repo / "scripts").mkdir()
        shutil.copy(IGNORE, repo / ".github" / "pr-size-ignore")
        shutil.copy(ROOT / "scripts" / "pr-size.py", repo / "scripts" / "pr-size.py")
        git("add", "-A")
        git("commit", "--quiet", "-m", "base")
        for path, lines in files.items():
            target = repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("linha\n" * lines, encoding="utf-8")
        git("add", "-A")
        git("commit", "--quiet", "-m", "pr")
        script = [sys.executable, "scripts/pr-size.py", "HEAD~1"]
        return subprocess.run(script, cwd=repo, env=env, check=True, capture_output=True, text=True).stdout


class AgentKitCountsInPrSize(unittest.TestCase):
    def test_ignore_file_no_longer_lists_the_agent_kit(self) -> None:
        patterns = [ln.strip() for ln in IGNORE.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
        self.assertFalse([p for p in patterns if ".claude" in p or ".agents" in p])
        self.assertIn("**/*.md", patterns)
        self.assertIn("web/public/prices/**", patterns)

    def test_non_markdown_files_of_the_kit_are_counted(self) -> None:
        out = measure(FILES)
        total = sum(FILES[path] for path in COUNTED)
        self.assertEqual(total, 9)
        self.assertIn(f"Tamanho do PR: {total} linhas ({total} código + 0 testes); 4 arquivo(s) ignorado(s)", out)
        for path in COUNTED:
            with self.subTest(path=path):
                self.assertRegex(out, rf"(?m)^\s+{FILES[path]}  {path}$")

    def test_markdown_of_the_kit_stays_out(self) -> None:
        out = measure({path: lines for path, lines in FILES.items() if path.endswith(".md")})
        self.assertIn("Tamanho do PR: 0 linhas (0 código + 0 testes); 3 arquivo(s) ignorado(s)", out)


if __name__ == "__main__":
    unittest.main()
