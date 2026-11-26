"""Exclusão de conta: primeiro os dados no DynamoDB, depois o usuário no Cognito.

A ordem é a do ADR-0001. Cada passo é idempotente (partição vazia e usuário inexistente contam
como feitos), então repetir a chamada depois de uma falha parcial termina o trabalho.
"""

import logging
from functools import lru_cache
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.account.repository import AccountRepository, PartitionNotEmptyError
from app.config import get_settings
from app.dynamo import get_table

_CONFIG = Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 2, "mode": "standard"})
_USER_NOT_FOUND = "UserNotFoundException"
_logger = logging.getLogger("app.account")


class AccountDeletionIncompleteError(Exception):
    """A exclusão não terminou. Nada além do que já foi apagado mudou; repetir é seguro."""


def _error_type(exc: Exception) -> str:
    """Código do erro da AWS ou nome da classe. Nunca a mensagem, que cita tabela, pool e chave."""
    if isinstance(exc, ClientError):
        return str(exc.response.get("Error", {}).get("Code", "ClientError"))[:64]
    return type(exc).__name__


class AccountService:
    def __init__(
        self, repository: AccountRepository, identity_client: Any, user_pool_id: str | None
    ) -> None:
        self._repository = repository
        self._identity = identity_client
        self._user_pool_id = user_pool_id

    def delete(self, user_id: str, username: str) -> None:
        """Apaga a partição do usuário e depois o usuário. Os dois valores vêm só do JWT.

        O log não leva `sub`, nome de usuário nem e-mail: o evento é localizado pelo
        `request_id`. Levanta `AccountDeletionIncompleteError` em qualquer falha.
        """
        if self._user_pool_id is None:
            # Sem o pool a segunda etapa nunca terminaria: falha antes de apagar qualquer dado.
            raise self._incomplete("config", "MissingUserPoolId")
        try:
            deleted = self._repository.delete_all(user_id)
        except (PartitionNotEmptyError, ClientError, BotoCoreError) as exc:
            raise self._incomplete("data", _error_type(exc)) from exc
        try:
            self._identity.admin_delete_user(UserPoolId=self._user_pool_id, Username=username)
        except (ClientError, BotoCoreError) as exc:
            # Usuário que já não existe é o estado desejado: a repetição termina sem erro.
            if _error_type(exc) != _USER_NOT_FOUND:
                raise self._incomplete("identity", _error_type(exc)) from exc
        _logger.info("account deleted", extra={"deleted_items": deleted})

    @staticmethod
    def _incomplete(stage: str, error_type: str) -> AccountDeletionIncompleteError:
        _logger.warning(
            "account deletion incomplete", extra={"stage": stage, "error_type": error_type}
        )
        return AccountDeletionIncompleteError(stage)


@lru_cache(maxsize=1)
def get_identity_client() -> Any:
    """Cliente do Cognito, criado sob demanda e reutilizado entre invocações."""
    return boto3.client("cognito-idp", config=_CONFIG)


def get_account_service() -> AccountService:
    return AccountService(
        AccountRepository(get_table()), get_identity_client(), get_settings().user_pool_id
    )
