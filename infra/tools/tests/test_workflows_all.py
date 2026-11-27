"""Regras da casa para TODO arquivo de .github/workflows, fixadas pela revisão da #73.

Os testes que já existiam cobrem os dois deploys, o `prices` e o passo de plano. Estes varrem a
pasta inteira: gatilho proibido, expressão dentro de `run:`, OIDC, environment e token de escrita
só onde já estão, e action fixada por SHA. As violações que a revisão achou ficam numa lista de
pendências (corrigir workflow não cabe na #73): pendência nova reprova, e pendência corrigida
também, até sair da lista. Os workflows são lidos como texto, sem PyYAML.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
EXPECTED = {
    "deploy-production.yml",
    "deploy-staging.yml",
    "export-validate.yml",
    "pr-size.yml",
    "prices.yml",
    "review-pr.yml",
    "security.yml",
    "terraform.yml",
    "validate.yml",
}
OIDC = {"deploy-production.yml": 1, "deploy-staging.yml": 1, "prices.yml": 1, "terraform.yml": 1}
ENVIRONMENTS = {"deploy-production.yml": ["production"], "deploy-staging.yml": ["staging"]}
# Escrita no repositório, por arquivo. `contents: write` só no job que abre o PR de preços.
WRITE_SCOPES = {
    "prices.yml": ["contents", "pull-requests"],
    "review-pr.yml": ["pull-requests"],  # só o job publish, que não tem agente (#364)
    "terraform.yml": ["pull-requests"],
}
# Pendências conhecidas (docs/security/revisao.md, achados CI-2 e CI-3). Só diminui: o
# review-pr.yml saiu com a #364 (CI-1), que reescreveu os três passos dele.
UNPINNED = {
    ("pr-size.yml", "actions/checkout@v4"): 1,
    ("security.yml", "actions/checkout@v4"): 2,
}
UNPINNED_CONTAINERS = {("security.yml", "semgrep/semgrep")}
NO_TOP_PERMISSIONS: set[str] = set()
SHA = re.compile(r"@[0-9a-f]{40}$")
RUN = re.compile(r"^(\s*)(?:- )?run:\s*(.*)$")


def workflows() -> dict[str, str]:
    return {path.name: path.read_text(encoding="utf-8") for path in sorted(WORKFLOWS.glob("*.y*ml"))}


def code(raw: str) -> list[str]:
    """Linhas sem comentário de linha inteira e sem o comentário de fim de linha."""
    return [re.sub(r"\s+#\s.*$", "", ln) for ln in raw.splitlines() if not ln.lstrip().startswith("#")]


def run_blocks(raw: str) -> list[str]:
    """O texto de cada `run:`, de uma linha ou em bloco (`|`, `>`), pela indentação."""
    lines, blocks, index = raw.splitlines(), [], 0
    while index < len(lines):
        match = RUN.match(lines[index])
        index += 1
        if match is None:
            continue
        indent, rest = len(match.group(1)), match.group(2)
        if not rest.startswith(("|", ">")):
            blocks.append(rest)
            continue
        body = []
        while index < len(lines) and (not lines[index].strip() or len(lines[index]) - len(lines[index].lstrip()) > indent):
            body.append(lines[index])
            index += 1
        blocks.append("\n".join(body))
    return blocks


def values(lines: list[str], key: str) -> list[str]:
    found = (re.match(rf"\s*(?:- )?{key}:\s*(\S.*)$", ln) for ln in lines)
    return [m.group(1).strip() for m in found if m]


class EveryWorkflow(unittest.TestCase):
    def setUp(self) -> None:
        self.files = workflows()

    def test_a_lista_de_workflows_e_a_conhecida(self) -> None:
        self.assertEqual(set(self.files), EXPECTED, "workflow novo ou removido: revise as listas deste teste")

    def test_nenhum_gatilho_proibido(self) -> None:
        for name, raw in self.files.items():
            with self.subTest(workflow=name):
                self.assertIsNone(re.search(r"pull_request_target|workflow_run", "\n".join(code(raw))))

    def test_nenhuma_expressao_dentro_de_run(self) -> None:
        for name, raw in self.files.items():
            blocks = run_blocks(raw)
            for block in blocks:
                with self.subTest(workflow=name, run=block.strip()[:40]):
                    self.assertNotIn("${{", block)
        self.assertGreater(sum(len(run_blocks(raw)) for raw in self.files.values()), 40)

    def test_o_extrator_de_run_pega_bloco_e_linha_unica(self) -> None:
        sample = "    steps:\n      - run: echo ${{ a }}\n      - name: x\n        run: |\n          one\n\n          ${{ b }}\n        env:\n          X: ${{ ok }}\n"
        self.assertEqual([("${{" in b) for b in run_blocks(sample)], [True, True])
        self.assertNotIn("ok", "".join(run_blocks(sample)))

    def test_permissoes_declaradas_e_escrita_so_onde_ja_existe(self) -> None:
        for name, raw in self.files.items():
            with self.subTest(workflow=name):
                lines = code(raw)
                self.assertNotIn("write-all", "\n".join(lines))
                self.assertTrue(values(lines, "permissions") or any(ln.rstrip().endswith("permissions:") for ln in lines))
                top = any(ln.startswith("permissions:") for ln in lines)
                self.assertEqual(top, name not in NO_TOP_PERMISSIONS)
                writes = sorted(m.group(1) for ln in lines if (m := re.match(r"\s+([a-z-]+):\s*write\b", ln)) and m.group(1) != "id-token")
                self.assertEqual(writes, WRITE_SCOPES.get(name, []))

    def test_oidc_e_environment_so_nos_jobs_conhecidos(self) -> None:
        for name, raw in self.files.items():
            with self.subTest(workflow=name):
                lines = code(raw)
                self.assertEqual(sum(1 for ln in lines if re.match(r"\s+id-token:\s*write\b", ln)), OIDC.get(name, 0))
                self.assertEqual(values([ln for ln in lines if ln.startswith("    environment")], "environment"), ENVIRONMENTS.get(name, []))
                self.assertFalse([ln for ln in lines if re.match(r"\s+environment:\s*$", ln)], "environment em forma de mapa")

    def test_producao_so_por_disparo_manual(self) -> None:
        lines = code(self.files["deploy-production.yml"])
        start = lines.index("on:")
        end = next(i for i in range(start + 1, len(lines)) if lines[i] and not lines[i].startswith(" "))
        triggers = [ln.strip() for ln in lines[start + 1 : end] if re.match(r"  \S", ln)]
        self.assertEqual(triggers, ["workflow_dispatch:"])

    def test_actions_por_sha_fora_as_pendencias_conhecidas(self) -> None:
        unpinned: dict[tuple[str, str], int] = {}
        containers = set()
        for name, raw in self.files.items():
            lines = code(raw)
            for ref in values(lines, "uses"):
                if not SHA.search(ref):
                    unpinned[(name, ref)] = unpinned.get((name, ref), 0) + 1
            containers |= {(name, image) for image in values(lines, "container") + values(lines, "image") if "@sha256:" not in image}
        self.assertEqual(unpinned, UNPINNED)
        self.assertEqual(containers, UNPINNED_CONTAINERS)

    def test_semgrep_e_gitleaks_rodam_em_todo_pr_e_falham_fechado(self) -> None:
        raw = self.files["security.yml"]
        lines = code(raw)
        start = lines.index("on:")
        self.assertEqual(lines[start + 1], "  pull_request:", "sem filtro de caminho nem de branch")
        self.assertTrue(lines[start + 2].startswith("  push:"))
        semgrep, gitleaks = raw.split("\n  gitleaks:\n")
        self.assertRegex(semgrep, r"semgrep scan .*--severity ERROR --error\b")
        self.assertIn("fetch-depth: 0", gitleaks, "gitleaks precisa do histórico inteiro do PR")
        self.assertRegex(gitleaks, r"\./gitleaks detect --redact\b")
        self.assertNotIn("continue-on-error", raw)
        self.assertNotIn("|| true", raw)

    def test_o_plano_em_pr_nao_roda_em_fork(self) -> None:
        plan = "\n".join(code(self.files["terraform.yml"]))
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", plan)


class FunctionsPackageInPullRequests(unittest.TestCase):
    """#211: o zip das funções é montado em todo PR e os testes do deploy rodam quando ele muda."""

    def setUp(self) -> None:
        self.files = workflows()

    def test_validate_monta_o_zip_depois_da_api_e_falha_com_o_script(self) -> None:
        raw = self.files["validate.yml"]
        builds = [block for block in run_blocks(raw) if "build-functions.sh" in block]
        self.assertEqual(len(builds), 1)
        lines = [ln.strip() for ln in builds[0].splitlines() if ln.strip()]
        self.assertEqual(lines[0], 'scripts/build-functions.sh "$RUNNER_TEMP/functions.zip" > /dev/null')
        self.assertRegex(lines[1], r'^echo "functions\.zip: \$\(stat -c %s "\$RUNNER_TEMP/functions\.zip"\) bytes"$')
        self.assertEqual(len(lines), 2, "nada entre o script e a medida: o passo falha com o script")
        self.assertNotRegex(builds[0], r"\|\||set \+e|;\s*true")
        self.assertLess(raw.index("uv sync --locked"), raw.index("build-functions.sh"), "depois do passo da API (uv instalado)")
        self.assertLess(raw.index("astral-sh/setup-uv@"), raw.index("build-functions.sh"))

    def test_validate_nao_publica_o_zip_nem_pula_o_passo(self) -> None:
        raw = self.files["validate.yml"]
        step = raw.split("      - name: Funções", 1)[1].split("\n      - ", 1)[0]
        self.assertNotRegex(step, r"(?m)^\s+(if|continue-on-error|uses):")
        uploads = [block for block in raw.split("\n      - ") if "upload-artifact@" in block]
        self.assertEqual(len(uploads), 1)
        self.assertNotIn("functions", uploads[0])

    def test_mudanca_no_deploy_de_staging_ou_no_script_roda_os_testes_dele(self) -> None:
        terraform = self.files["terraform.yml"]
        paths = terraform.split("    paths:\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn('- ".github/workflows/deploy-staging.yml"', paths)
        self.assertIn('- "scripts/build-functions.sh"', paths)
        static = terraform.split("\n  static:\n", 1)[1].split("\n  plan:\n", 1)[0]
        self.assertIn("python3 -m unittest discover -s infra/tools/tests", static)


if __name__ == "__main__":
    unittest.main()
