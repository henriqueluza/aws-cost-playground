#!/usr/bin/env python3
"""release-gate: recusas do deploy de produção (#23), antes de qualquer credencial da AWS.

Uso:
  release_gate.py sha <sha> --ref <GITHUB_REF> [--repo <dir>] [--main <ref>]
      O SHA tem 40 caracteres hexadecimais minúsculos, o workflow roda em `refs/heads/main`
      e o commit pertence a `main`. Imprime o SHA validado.
  release_gate.py staging-run <sha> <runs.json>
      `runs.json` é a resposta de `GET /actions/workflows/deploy-staging.yml/runs`. Imprime
      o id do run de staging concluído com sucesso para o SHA (push em `main`).
  release_gate.py staging-jobs <jobs.json>
      `jobs.json` é a resposta de `GET /actions/runs/<id>/jobs`. Exige que o job de deploy e
      o smoke test de staging tenham terminado com sucesso. Run verde com o deploy pulado
      (staging sem configuração) não conta: o smoke fica `skipped`.
  release_gate.py prices <diretório do release>
      Lê `site/prices/manifest.json` e só aceita `source: price-list`.

Saída: 0 aceito; 1 recusado; 2 entrada inválida. Mensagem na stderr. Falha fechada.
Só a biblioteca padrão: roda no runner do CI sem instalar nada.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_INVALID = 2

SHA_PATTERN = re.compile(r"[0-9a-f]{40}")
MAIN_REF = "refs/heads/main"
STAGING_WORKFLOW = ".github/workflows/deploy-staging.yml"
# Nomes do job e do passo em deploy-staging.yml; o teste do workflow de produção os trava.
STAGING_DEPLOY_JOB = "deploy (staging)"
STAGING_SMOKE_STEP = "Smoke test"
MANIFEST_PATH = Path("site") / "prices" / "manifest.json"
PUBLISHABLE_SOURCE = "price-list"


class RefusedError(Exception):
    """O release não pode ir para produção."""


class InvalidInputError(Exception):
    """A entrada não tem o formato esperado."""


def load_json(path: str | Path) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InvalidInputError(f"não foi possível ler o JSON de {Path(path).name}") from exc


def check_sha(sha: str, ref: str, repo: str, main: str) -> str:
    if not SHA_PATTERN.fullmatch(sha):
        raise RefusedError("o SHA informado não tem 40 caracteres hexadecimais minúsculos")
    if ref != MAIN_REF:
        raise RefusedError(f"o workflow de produção só roda a partir de {MAIN_REF}")
    for args in (["cat-file", "-e", f"{sha}^{{commit}}"], ["merge-base", "--is-ancestor", sha, main]):
        done = subprocess.run(["git", "-C", repo, *args], capture_output=True, check=False)
        if done.returncode != 0:
            raise RefusedError(f"o commit {sha} não pertence a main")
    return sha


def staging_run_id(sha: str, payload: Any) -> int:
    runs = payload.get("workflow_runs") if isinstance(payload, dict) else None
    if not isinstance(runs, list):
        raise InvalidInputError("resposta sem `workflow_runs`")
    ids = [
        run["id"]
        for run in runs
        if isinstance(run, dict)
        and isinstance(run.get("id"), int)
        and run.get("head_sha") == sha
        and run.get("head_branch") == "main"
        and run.get("event") == "push"
        and run.get("path") == STAGING_WORKFLOW
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
    ]
    if not ids:
        raise RefusedError(f"nenhum deploy de staging concluído com sucesso para {sha}")
    return max(ids)


def check_staging_jobs(payload: Any) -> None:
    jobs = payload.get("jobs") if isinstance(payload, dict) else None
    if not isinstance(jobs, list):
        raise InvalidInputError("resposta sem `jobs`")
    for job in jobs:
        if not isinstance(job, dict) or job.get("name") != STAGING_DEPLOY_JOB:
            continue
        steps = job.get("steps") if isinstance(job.get("steps"), list) else []
        smoke = [s for s in steps if isinstance(s, dict) and s.get("name") == STAGING_SMOKE_STEP]
        if job.get("conclusion") == "success" and [s.get("conclusion") for s in smoke] == ["success"]:
            return
        raise RefusedError("o deploy de staging deste SHA foi pulado ou não passou no smoke test")
    raise RefusedError("o run de staging não tem o job de deploy")


def check_prices(release_dir: str) -> None:
    manifest = load_json(Path(release_dir) / MANIFEST_PATH)
    source = manifest.get("source") if isinstance(manifest, dict) else None
    if source == "seed":
        raise RefusedError("o manifest.json de preços tem `source: seed`: produção só recebe preços gerados")
    if source != PUBLISHABLE_SOURCE:
        raise RefusedError(f"o manifest.json de preços não tem `source: {PUBLISHABLE_SOURCE}`")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="release_gate.py")
    sub = parser.add_subparsers(dest="command", required=True)
    sha = sub.add_parser("sha")
    sha.add_argument("sha")
    sha.add_argument("--ref", required=True)
    sha.add_argument("--repo", default=".")
    sha.add_argument("--main", default="origin/main")
    run = sub.add_parser("staging-run")
    run.add_argument("sha")
    run.add_argument("runs")
    sub.add_parser("staging-jobs").add_argument("jobs")
    sub.add_parser("prices").add_argument("release_dir")
    return parser


def main(argv: list[str]) -> int:
    try:
        args = build_parser().parse_args(argv)
    except SystemExit:
        return EXIT_INVALID
    try:
        if args.command == "sha":
            print(check_sha(args.sha, args.ref, args.repo, args.main))
        elif args.command == "staging-run":
            print(staging_run_id(args.sha, load_json(args.runs)))
        elif args.command == "staging-jobs":
            check_staging_jobs(load_json(args.jobs))
        else:
            check_prices(args.release_dir)
    except RefusedError as exc:
        print(f"::error::release-gate: {exc}", file=sys.stderr)
        return EXIT_REFUSED
    except InvalidInputError as exc:
        print(f"::error::release-gate: entrada inválida: {exc}", file=sys.stderr)
        return EXIT_INVALID
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
