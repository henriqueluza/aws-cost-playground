"""Invariantes de segurança da infra, fixados pela revisão da #73 (docs/security/revisao.md).

Os `.tf` são lidos como texto, sem provider nem credencial. Cada teste fecha uma lacuna que
a revisão achou: a CSP só era conferida por trechos, a ligação dos ambientes (CORS, authorizer,
`connect-src`) não tinha teste, e nada varria os módulos atrás de rota sem JWT, URL de função,
`prevent_destroy` ausente ou exceção nova de scanner. `infra/bootstrap/` tem os testes dele.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INFRA = ROOT / "infra"
ENVS = ("staging", "production")

CSP = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    """connect-src ${join(" ", concat(["'self'"], var.connect_src_origins))}""",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
]
CONNECT_SRC = [
    '"https://${module.dns.domain_names.api}"',
    '"https://${module.dns.domain_names.auth}"',
    '"https://cognito-idp.us-east-1.amazonaws.com"',
]
# Exceções de scanner aceitas, com o motivo em docs/security/revisao.md. Exceção nova muda esta lista.
SCANNER_IGNORES = {
    ("bootstrap/boundary.tf", "AVD-AWS-0057"),
    ("bootstrap/by_id.tf", "AVD-AWS-0057"),
    ("bootstrap/named.tf", "AVD-AWS-0057"),
    ("bootstrap/prices.tf", "AVD-AWS-0057"),
    ("bootstrap/state.tf", "AVD-AWS-0132"),
    ("modules/alarms/main.tf", "AVD-AWS-0095"),
    ("modules/site/cloudfront.tf", "AVD-AWS-0011"),
    ("modules/site/s3.tf", "AVD-AWS-0132"),
}
# Tudo que guarda dado ou identidade (ADR, "Travas contra destruição").
PROTECTED = {
    "modules/database/main.tf": "aws_dynamodb_table",
    "modules/auth/main.tf": "aws_cognito_user_pool",
    "modules/site/s3.tf": "aws_s3_bucket",
    "modules/functions/iam.tf": "aws_iam_role",
}
FORBIDDEN = {
    "URL pública de função": r"aws_lambda_function_url",
    "parâmetro do SSM no Terraform": r'resource\s+"aws_ssm_parameter"',
    "rota sem authorizer": r'authorization_type\s*=\s*"(?!JWT")',
    "CORS com curinga": r'allow_origins\s*=\s*\[[^\]]*"\*"',
    "origem com curinga": r'(cors_allowed_origins|connect_src_origins)\s*=\s*\[[^\]]*"[^"]*\*',
    "CSP com unsafe": r"unsafe-(inline|eval|hashes)",
}
IGNORE = re.compile(r"(?:#|//)\s*(?:trivy:ignore:|tfsec:ignore:|checkov:skip=)(\S+)")
WILDCARD_ACTION = re.compile(r'"(?:[a-z0-9-]+:)?\*"')


def read(relative: str) -> str:
    return (INFRA / relative).read_text(encoding="utf-8")


def code(raw: str) -> str:
    """Sem comentários de linha inteira nem de fim de linha (`# ...` depois de espaço)."""
    lines = (re.sub(r"\s+#\s.*$", "", ln) for ln in raw.splitlines() if not ln.lstrip().startswith("#"))
    return "\n".join(lines)


def sources() -> dict[str, str]:
    """Todo `.tf` de módulos e ambientes, fora os de teste."""
    found = {}
    for base in ("modules", "envs"):
        for path in sorted((INFRA / base).rglob("*.tf")):
            parts = path.relative_to(INFRA).parts
            if "tests" not in parts and ".terraform" not in parts:
                found["/".join(parts)] = code(path.read_text(encoding="utf-8"))
    return found


def block(raw: str, header: str) -> str:
    """Corpo do primeiro bloco cujo cabeçalho casa com `header`, por contagem de chaves."""
    match = re.search(header + r"[^{\n]*\{", raw)
    if match is None:
        raise AssertionError(f"bloco `{header}` não encontrado")
    depth, start = 1, match.end()
    for index in range(start, len(raw)):
        depth += {"{": 1, "}": -1}.get(raw[index], 0)
        if depth == 0:
            return raw[start:index]
    raise AssertionError(f"bloco `{header}` não fecha")


def directives(headers: str) -> list[str]:
    """As diretivas da CSP, na ordem, tiradas da lista que o `join("; ", [...])` recebe."""
    match = re.search(r'content_security_policy\s*=\s*join\("; ",\s*\[\n(.*?)\n\s*\]\)', headers, re.S)
    if match is None:
        raise AssertionError("lista da CSP não encontrada em headers.tf")
    lines = [ln.strip().rstrip(",") for ln in code(match.group(1)).splitlines() if ln.strip()]
    return [ln[1:-1] if ln.startswith('"') and ln.endswith('"') else ln for ln in lines]


class ContentSecurityPolicy(unittest.TestCase):
    def setUp(self) -> None:
        self.headers = read("modules/site/headers.tf")

    def test_csp_inteira_e_fixada_diretiva_a_diretiva(self) -> None:
        self.assertEqual(directives(self.headers), CSP)

    def test_extrator_reprova_csp_afrouxada(self) -> None:
        for loose in ("\"script-src 'self' 'unsafe-eval' https:\"", "\"script-src 'self' https:\""):
            hostile = self.headers.replace("\"script-src 'self'\"", loose)
            self.assertNotEqual(hostile, self.headers)
            self.assertNotEqual(directives(hostile), CSP)
        extra = self.headers.replace('    "object-src', '    "worker-src https:",\n    "object-src')
        self.assertNotEqual(directives(extra), CSP)

    def test_politica_unica_vale_para_os_dois_comportamentos_e_sobrescreve_a_origem(self) -> None:
        self.assertEqual(self.headers.count('resource "aws_cloudfront_response_headers_policy"'), 1)
        policy = block(self.headers, r'resource "aws_cloudfront_response_headers_policy" "this"')
        csp = block(policy, r"content_security_policy ")
        self.assertRegex(csp, r"content_security_policy\s*=\s*local\.content_security_policy\n")
        self.assertRegex(csp, r"override\s*=\s*true")
        cloudfront = code(read("modules/site/cloudfront.tf"))
        behaviors = cloudfront.count("cache_behavior {")
        attached = len(re.findall(r"response_headers_policy_id\s*=\s*aws_cloudfront_response_headers_policy\.this\[", cloudfront))
        self.assertEqual((behaviors, attached), (2, 2))

    def test_cabecalhos_que_acompanham_a_csp(self) -> None:
        policy = block(self.headers, r'resource "aws_cloudfront_response_headers_policy" "this"')
        self.assertRegex(policy, r'frame_option\s*=\s*"DENY"')
        self.assertRegex(policy, r'referrer_policy\s*=\s*"no-referrer"')
        self.assertRegex(policy, r"access_control_max_age_sec\s*=\s*31536000")
        self.assertIn("content_type_options {", policy)

    def test_connect_src_dos_ambientes_tem_so_api_login_e_descoberta(self) -> None:
        for env in ENVS:
            with self.subTest(env=env):
                site = block(code(read(f"envs/{env}/main.tf")), r'module "site"')
                origins = block(site.replace("[", "{").replace("]", "}"), r"connect_src_origins\s*=\s*")
                self.assertEqual([ln.strip().rstrip(",") for ln in origins.strip().splitlines()], CONNECT_SRC)


class ApiEdge(unittest.TestCase):
    def test_cors_do_gateway_so_tem_a_origem_do_site(self) -> None:
        cors = block(code(read("modules/http-api/main.tf")), r"cors_configuration ")
        self.assertRegex(cors, r"allow_origins\s*=\s*var\.cors_allowed_origins\n")
        self.assertRegex(cors, r"allow_credentials\s*=\s*false")
        for env in ENVS:
            with self.subTest(env=env):
                main = code(read(f"envs/{env}/main.tf"))
                self.assertRegex(main, r'site_origin\s*=\s*"https://\$\{module\.dns\.domain_names\.site\}"')
                self.assertRegex(main, r"cors_allowed_origins\s*=\s*\[local\.site_origin\]\n")

    def test_toda_rota_usa_o_authorizer_jwt_do_pool_do_ambiente(self) -> None:
        main = code(read("modules/http-api/main.tf"))
        self.assertEqual(main.count('resource "aws_apigatewayv2_route"'), 1)
        route = block(main, r'resource "aws_apigatewayv2_route" "this"')
        self.assertRegex(route, r'authorization_type\s*=\s*"JWT"')
        self.assertRegex(route, r"authorizer_id\s*=\s*aws_apigatewayv2_authorizer\.jwt\.id")
        self.assertRegex(main, r"disable_execute_api_endpoint\s*=\s*true")
        for env in ENVS:
            with self.subTest(env=env):
                api = block(code(read(f"envs/{env}/main.tf")), r'module "http_api"')
                self.assertRegex(api, r"jwt_issuer\s*=\s*module\.auth\.issuer\n")
                self.assertRegex(api, r"jwt_audience\s*=\s*\[module\.auth\.client_id\]\n")
                self.assertRegex(api, r'"POST /estimates"\s*=\s*\{ throttle = var\.estimates_throttle \}')


class ModulesAndEnvs(unittest.TestCase):
    def test_nada_proibido_em_modulos_e_ambientes(self) -> None:
        for name, text in sources().items():
            for label, pattern in FORBIDDEN.items():
                with self.subTest(file=name, rule=label):
                    self.assertIsNone(re.search(pattern, text))

    def test_as_proibicoes_pegam_o_trecho_hostil(self) -> None:
        hostile = {
            "URL pública de função": 'resource "aws_lambda_function_url" "x" {}',
            "parâmetro do SSM no Terraform": 'resource "aws_ssm_parameter" "key" {}',
            "rota sem authorizer": 'authorization_type = "NONE"',
            "CORS com curinga": 'allow_origins = ["https://a.example", "*"]',
            "origem com curinga": 'connect_src_origins = ["https://*.example.com"]',
            "CSP com unsafe": "\"script-src 'self' 'unsafe-inline'\"",
        }
        self.assertEqual(set(hostile), set(FORBIDDEN))
        for label, snippet in hostile.items():
            with self.subTest(rule=label):
                self.assertIsNotNone(re.search(FORBIDDEN[label], snippet))

    def test_curinga_em_acao_so_aparece_em_negacao(self) -> None:
        for name, text in sources().items():
            for match in re.finditer(r"\bAction\s*=\s*(\[[^\]]*\]|\"[^\"]*\")", text):
                if not WILDCARD_ACTION.search(match.group(1)):
                    continue
                with self.subTest(file=name, action=match.group(1)):
                    statement = text[text.rfind("{", 0, match.start()) : match.start()]
                    self.assertRegex(statement, r'Effect\s*=\s*"Deny"')

    def test_nenhum_recurso_curinga_inteiro_nos_modulos(self) -> None:
        for name, text in sources().items():
            with self.subTest(file=name):
                self.assertIsNone(re.search(r'\bResource\s*=\s*(\[\s*)?"\*"', text))

    def test_dado_e_identidade_tem_prevent_destroy(self) -> None:
        for name, kind in PROTECTED.items():
            with self.subTest(file=name):
                text = code(read(name))
                self.assertEqual(text.count(f'resource "{kind}"'), 1)
                lifecycle = block(block(text, rf'resource "{kind}" "this"'), r"lifecycle ")
                self.assertRegex(lifecycle, r"(?m)^\s*prevent_destroy\s*=\s*true\s*$")

    def test_excecoes_de_scanner_sao_so_as_listadas_e_tem_motivo(self) -> None:
        found = set()
        for path in sorted(INFRA.rglob("*.tf")):
            lines = path.read_text(encoding="utf-8").splitlines()
            for index, line in enumerate(lines):
                match = IGNORE.search(line)
                if match is None:
                    continue
                name = "/".join(path.relative_to(INFRA).parts)
                found.add((name, match.group(1)))
                with self.subTest(file=name, line=index + 1):
                    reason = lines[index - 1].strip() if index else ""
                    self.assertTrue(reason.startswith("#") and len(reason) > 20, "exceção sem motivo na linha de cima")
        self.assertEqual(found, SCANNER_IGNORES)


if __name__ == "__main__":
    unittest.main()
