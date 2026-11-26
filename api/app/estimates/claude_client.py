"""Cliente da Claude API para a estimativa de uso (ADR-0001, "Fluxo da estimativa de carga").

Uso pela rota (#62): `prepare(body)` antes de consumir quota (sem rede e sem custo) e
`estimate(plan)` depois. Toda falha vira `EstimateError`, com código e mensagem fixos: nada da
AWS, da Anthropic, da descrição ou do diagrama chega à exceção, ao log ou à resposta.
"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Literal

import anthropic
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings
from app.contracts import Contracts, get_contracts
from app.estimates.prompt import MAX_TOKENS, SYSTEM_PROMPT, EstimatePlan, build_plan, output_schema
from app.estimates.revalidation import ItemUsage, revalidate
from app.estimates.schemas import EstimateIn

ErrorCode = Literal[
    "disabled", "too_large", "unavailable", "timeout", "rate_limited", "overloaded",
    "refused", "truncated", "invalid_output",
]  # fmt: skip
_MESSAGES: dict[ErrorCode, str] = {
    "disabled": "Estimates are disabled.",
    "too_large": "The diagram is too large to estimate.",
    "unavailable": "The estimate service is unavailable.",
    "timeout": "The estimate timed out.",
    "rate_limited": "The estimate service is busy.",
    "overloaded": "The estimate service is busy.",
    "refused": "The estimate was refused.",
    "truncated": "The estimate was incomplete.",
    "invalid_output": "The estimate was invalid.",
}
# A Lambda do proxy tem 29 s. Sobra para o início a frio, a leitura do SSM (até 5 s) e a quota.
LLM_TIMEOUT = anthropic.Timeout(20.0, connect=3.0)
# Sem nova tentativa: uma segunda chamada depois de um timeout não cabe nos 29 s, e repetir
# sozinho multiplicaria o custo de uma estimativa que já consumiu quota. O padrão do SDK é 2.
LLM_MAX_RETRIES = 0
_SSM_CONFIG = Config(connect_timeout=2, read_timeout=3, retries={"total_max_attempts": 1})
# Tuplas nomeadas: `except A, B:` sem parênteses só existe a partir do Python 3.14.
_SSM_ERRORS = (BotoCoreError, ClientError, KeyError)
_OUTPUT_ERRORS = (ValueError, RecursionError)
_logger = logging.getLogger("app.estimates.claude_client")


class EstimateError(Exception):
    """Falha tratada. `code` decide o status na rota; os tokens valem quando a chamada foi paga."""

    def __init__(self, code: ErrorCode, input_tokens: int = 0, output_tokens: int = 0) -> None:
        super().__init__(_MESSAGES[code])
        self.code, self.input_tokens, self.output_tokens = code, input_tokens, output_tokens


@dataclass(frozen=True)
class UsageEstimate:
    """Saída revalidada: um item por bloco e por aresta do pedido, na ordem de entrada."""

    blocks: tuple[ItemUsage, ...]
    edges: tuple[ItemUsage, ...]
    input_tokens: int
    output_tokens: int


def _ssm_client() -> Any:
    return boto3.client("ssm", config=_SSM_CONFIG)


def _anthropic_client(api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=api_key, timeout=LLM_TIMEOUT, max_retries=LLM_MAX_RETRIES)


def _failure(exc: anthropic.APIError) -> ErrorCode:
    if isinstance(exc, anthropic.APITimeoutError):
        return "timeout"
    if isinstance(exc, anthropic.RateLimitError):
        return "rate_limited"
    if isinstance(exc, anthropic.InternalServerError):  # 5xx, inclusive 529 (sobrecarga)
        return "overloaded"
    return "unavailable"  # 400, 401, 402 (cota), 403, 404, 413 e falha de conexão


class ClaudeClient:
    """Guarda só o cliente do SDK, criado na 1ª chamada: o SSM é lido uma vez por execução fria.

    A chave vive apenas dentro do cliente do SDK: não há atributo com o valor, e o `repr` desta
    classe é o padrão do Python.
    """

    def __init__(
        self,
        *,
        enabled: bool,
        model: str,
        key_parameter: str | None,
        contracts: Contracts,
        ssm_factory: Callable[[], Any] = _ssm_client,
        anthropic_factory: Callable[[str], anthropic.Anthropic] = _anthropic_client,
    ) -> None:
        self._enabled, self._model, self._parameter_name = enabled, model, key_parameter
        self._contracts, self._schema = contracts, output_schema(contracts)
        self._ssm_factory, self._anthropic_factory = ssm_factory, anthropic_factory
        self._sdk: anthropic.Anthropic | None = None

    def prepare(self, body: EstimateIn) -> EstimatePlan:
        """Confere o interruptor e o tamanho. Não lê a chave nem chama a API."""
        if not self._enabled:
            raise EstimateError("disabled")
        try:
            plan = build_plan(body, self._contracts)
        except ValueError:
            plan = None
        if plan is None or plan.expected_output_tokens > MAX_TOKENS:
            raise self._fail("too_large")
        return plan

    def estimate(self, plan: EstimatePlan) -> UsageEstimate:
        """Uma chamada à Claude API, sem nova tentativa. Resposta parcial nunca é usada."""
        if plan.expected_output_tokens == 0:  # nada a estimar: só padrões, sem chamada nem custo
            return UsageEstimate(
                *revalidate({"blocks": [], "edges": []}, plan.blocks, plan.edges), 0, 0
            )
        sdk = self._client()
        failure: ErrorCode | None = None
        try:
            response = sdk.messages.create(
                model=self._model,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": plan.user_message}],
                thinking={"type": "disabled"},
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": self._schema},
                },
            )
        except anthropic.APIError as exc:
            failure = _failure(exc)
            if isinstance(exc, anthropic.AuthenticationError):
                self._sdk = None  # chave trocada ou revogada: a próxima chamada relê o SSM
        if failure is not None:  # fora do `except`: a exceção do SDK não fica encadeada
            raise self._fail(failure)
        tokens = (response.usage.input_tokens, response.usage.output_tokens)
        if response.stop_reason != "end_turn":
            reasons: dict[str | None, ErrorCode] = {"refusal": "refused", "max_tokens": "truncated"}
            raise self._fail(reasons.get(response.stop_reason, "invalid_output"), *tokens)
        texts = [block.text for block in response.content if block.type == "text"]
        try:
            usage = revalidate(json.loads("".join(texts)), plan.blocks, plan.edges)
        except _OUTPUT_ERRORS:
            usage = None
        if usage is None:
            raise self._fail("invalid_output", *tokens)
        return UsageEstimate(*usage, *tokens)

    def _client(self) -> anthropic.Anthropic:
        if self._sdk is not None:
            return self._sdk
        if not self._enabled:
            raise EstimateError("disabled")
        key = ""
        if self._parameter_name is not None:
            try:
                name = self._parameter_name
                parameter = self._ssm_factory().get_parameter(Name=name, WithDecryption=True)
                key = str(parameter["Parameter"]["Value"]).strip()
            except _SSM_ERRORS:
                key = ""  # parâmetro ausente, sem permissão ou SSM fora do ar: falha fechada
        if not key:
            raise self._fail("unavailable")
        self._sdk = self._anthropic_factory(key)
        return self._sdk

    @staticmethod
    def _fail(code: ErrorCode, input_tokens: int = 0, output_tokens: int = 0) -> EstimateError:
        _logger.warning("llm estimate failed", extra={"error_type": code})
        return EstimateError(code, input_tokens, output_tokens)


@lru_cache(maxsize=1)
def get_claude_client() -> ClaudeClient:
    """Cliente do processo, configurado pelo ambiente e reutilizado entre invocações."""
    settings = get_settings()
    return ClaudeClient(
        enabled=settings.llm_enabled,
        model=settings.llm_model,
        key_parameter=settings.anthropic_api_key_parameter,
        contracts=get_contracts(),
    )
