"""Testes das raízes infra/envs/*. Rodam com `python3 -m unittest discover -s infra/tools/tests`.

Os ambientes chamam os mesmos módulos com o mesmo código: o diff fica só no terraform.tfvars
(e no nome do ambiente em backend.tf e versions.tf). O plano da raiz é testado à parte, em
infra/envs/<env>/tests (terraform test).
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ENVS = {
    "staging": {
        "environment": "staging",
        "self_signup_enabled": "false",
        "point_in_time_recovery_enabled": "false",
    },
    # O critério da #21 pede cadastro aberto em produção; fica fechado até o autor decidir a #139.
    "production": {
        "environment": "production",
        "self_signup_enabled": "false",
        "point_in_time_recovery_enabled": "true",
    },
}
PREFIXES = {"staging": "acp-stg", "production": "acp-prod"}
IDENTICAL = ("main.tf", "variables.tf", "outputs.tf", ".terraform.lock.hcl")
SHARED = {
    "llm_enabled": "false",
    "default_throttle": "{ rate_limit = 10, burst_limit = 20 }",
    "estimates_throttle": "{ rate_limit = 1, burst_limit = 5 }",
}
AUTHOR_VARS = ["zone_name", "alarm_email", "package_bucket", "package_key"]
MODULES = {f"../../modules/{m}" for m in "alarms auth database dns functions http-api site".split()}
DEPLOY_OUTPUTS = {"site_bucket_name", "site_distribution_id", "function_names", "site_config"}
RUNBOOK_OUTPUTS = {"api_id", "function_role_names", "llm_api_key_parameter_name", "alarm_topic_arn"}


def read(env: str, name: str) -> str:
    return (ROOT / "infra" / "envs" / env / name).read_text(encoding="utf-8")


def tfvars(env: str) -> dict[str, str]:
    pairs = re.findall(r"^(\w+)\s*=\s*(.+?)\s*$", read(env, "terraform.tfvars"), re.M)
    return {key: value.strip('"') for key, value in pairs}


def files(env: str) -> set[str]:
    """Arquivos do ambiente, sem o diretório de trabalho do Terraform (`.terraform/`)."""
    base = ROOT / "infra" / "envs" / env
    paths = (p.relative_to(base) for p in base.rglob("*") if p.is_file())
    return {p.as_posix() for p in paths if ".terraform" not in p.parts}


def block(text: str, kind: str, name: str) -> str:
    found = re.search(rf'^{kind} "{name}" \{{.*?^\}}', text, re.S | re.M)
    assert found, f"{kind} {name} ausente"
    return found.group(0)


def schema_keys() -> set[str]:
    """Chaves do schema zod do /config.json (web/), para o teste quebrar se ele mudar."""
    text = (ROOT / "web/src/shared/config/runtimeConfig.ts").read_text(encoding="utf-8")
    found = re.search(r"runtimeConfigSchema = z\.object\(\{(.*?)\}\);", text, re.S)
    assert found, "runtimeConfigSchema ausente"
    return set(re.findall(r"^\s*(\w+):", found.group(1), re.M))


class EnvsTest(unittest.TestCase):
    def test_tfvars_has_exact_keys_and_values(self) -> None:
        for env, expected in ENVS.items():
            self.assertEqual(tfvars(env), expected | SHARED, env)

    def test_tfvars_has_no_secret_or_author_data(self) -> None:
        for env in ENVS:
            text = read(env, "terraform.tfvars")
            for forbidden in [*AUTHOR_VARS, "@", "arn:"]:
                self.assertNotIn(forbidden, text)
            self.assertIsNone(re.search(r"(?<!\d)\d{12}(?!\d)", text))

    def test_author_variables_have_no_default_and_email_is_sensitive(self) -> None:
        for env in ENVS:
            text = read(env, "variables.tf")
            for name in AUTHOR_VARS:
                self.assertNotRegex(block(text, "variable", name), r"\bdefault\b")
            self.assertRegex(block(text, "variable", "alarm_email"), r"sensitive\s*=\s*true")

    def test_main_calls_exactly_the_seven_modules_without_env_literals(self) -> None:
        for env in ENVS:
            text = read(env, "main.tf")
            self.assertEqual(set(re.findall(r'source\s*=\s*"([^"]+)"', text)), MODULES)
            self.assertNotIn("depends_on", text)
            code = re.sub(r"(?m)^\s*(#|//).*$", "", text)
            code = code.replace('var.environment == "production"', "")
            self.assertIsNone(re.search(r'"(staging|production)"', code))

    def test_main_wires_auth_domain_and_callback_route(self) -> None:
        router = (ROOT / "web/src/app/router.tsx").read_text(encoding="utf-8")
        self.assertIn("auth/callback", router)
        for env in ENVS:
            text = read(env, "main.tf")
            self.assertRegex(text, r"domain_name\s*=\s*module\.dns\.auth_domain")
            self.assertNotIn("module.auth.domain_name", text)
            self.assertIn("${local.site_origin}/auth/callback", text)

    def test_outputs_and_site_config_follow_the_runtime_schema(self) -> None:
        keys = schema_keys()
        self.assertEqual(keys, {"apiBaseUrl", "cognitoAuthority", "cognitoClientId"})
        for env in ENVS:
            text = read(env, "outputs.tf")
            self.assertEqual(set(re.findall(r'^output "(\w+)"', text, re.M)), DEPLOY_OUTPUTS | RUNBOOK_OUTPUTS)
            site_config = block(text, "output", "site_config")
            config = re.search(r"value = \{(.*?)^  \}", site_config, re.S | re.M)
            assert config, f"{env}: site_config sem objeto"
            self.assertEqual(set(re.findall(r"^\s*(\w+)\s*=", config.group(1), re.M)), keys)

    def test_shared_files_are_identical_across_envs(self) -> None:
        """Mesmos módulos, mesmas variáveis, mesmas saídas e mesmos providers, byte a byte."""
        self.assertEqual(set(ENVS), {"staging", "production"})
        for name in IDENTICAL:
            self.assertEqual(read("production", name), read("staging", name), name)

    def test_envs_have_the_same_files(self) -> None:
        self.assertEqual(files("production"), files("staging"))
        self.assertLessEqual({*IDENTICAL, "terraform.tfvars", "backend.tf", "versions.tf"}, files("staging"))

    def test_backend_and_versions_differ_only_in_the_environment_name(self) -> None:
        for name in ("backend.tf", "versions.tf"):
            generic = {
                env: read(env, name).replace(env, "<env>").replace(prefix, "<prefixo>")
                for env, prefix in PREFIXES.items()
            }
            self.assertEqual(generic["production"], generic["staging"], name)
            self.assertNotEqual(read("production", name), read("staging", name), name)

    def test_tfvars_differ_only_in_environment_and_pitr(self) -> None:
        """Só variáveis mudam entre os ambientes. O cadastro aberto entra aqui quando a #139 sair."""
        staging, production = tfvars("staging"), tfvars("production")
        self.assertEqual(set(production), set(staging))
        changed = {key for key in staging if staging[key] != production[key]}
        self.assertEqual(changed, {"environment", "point_in_time_recovery_enabled"})


if __name__ == "__main__":
    unittest.main()
