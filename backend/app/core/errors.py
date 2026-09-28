"""Erros estruturados da camada de IA.

Fluxo: services levantam AIProviderError; o exception handler no main.py
traduz para HTTPException-style JSON:

    {"detail": {"error_code": "...", "message": "...", "provider": "..."}}

O error_code é consumido pelo frontend (mapeamento para toasts/ícones/ações).
O ErrorKind (v0.4) é a taxonomia que orienta as DECISÕES do chain executor.
"""
from enum import Enum


class ErrorCode(str, Enum):
    PROVIDER_UNREACHABLE = "PROVIDER_UNREACHABLE"        # 503 — serviço inacessível
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"                # 504 — não respondeu a tempo
    PROVIDER_INVALID_KEY = "PROVIDER_INVALID_KEY"        # 502 — chave rejeitada
    PROVIDER_REQUEST_FAILED = "PROVIDER_REQUEST_FAILED"  # 502 — outro erro HTTP do provedor
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"                  # 502 — modelo inexistente
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"          # 429 — rate limit (RPM)
    QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED"                  # 429 — cota diária/mensal esgotada
    CONTEXT_TOO_LARGE = "CONTEXT_TOO_LARGE"              # 400 — prompt excede o contexto
    KEY_NOT_CONFIGURED = "KEY_NOT_CONFIGURED"            # 400 — chave ausente no servidor
    UNKNOWN_PROVIDER = "UNKNOWN_PROVIDER"                # 400 — provedor inexistente


class ErrorKind(str, Enum):
    """Taxonomia de decisão do chain executor (v0.4).

    Diferença chave: RATE_LIMIT -> cooldown curto (segundos);
    QUOTA_EXHAUSTED -> provedor fora até o reset (horas).
    """

    QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED"
    RATE_LIMIT = "RATE_LIMIT"
    INVALID_KEY = "INVALID_KEY"
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    CONTEXT_TOO_LARGE = "CONTEXT_TOO_LARGE"
    NETWORK_ERROR = "NETWORK_ERROR"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    UNKNOWN = "UNKNOWN"


# Mapeamento ErrorKind -> (ErrorCode, HTTP status) na resposta ao frontend
KIND_TO_RESPONSE: dict["ErrorKind", tuple["ErrorCode", int]] = {
    ErrorKind.QUOTA_EXHAUSTED: (ErrorCode.QUOTA_EXHAUSTED, 429),
    ErrorKind.RATE_LIMIT: (ErrorCode.RATE_LIMIT_EXCEEDED, 429),
    ErrorKind.INVALID_KEY: (ErrorCode.PROVIDER_INVALID_KEY, 502),
    ErrorKind.MODEL_NOT_FOUND: (ErrorCode.MODEL_NOT_FOUND, 502),
    ErrorKind.CONTEXT_TOO_LARGE: (ErrorCode.CONTEXT_TOO_LARGE, 400),
    ErrorKind.NETWORK_ERROR: (ErrorCode.PROVIDER_UNREACHABLE, 503),
    ErrorKind.PROVIDER_ERROR: (ErrorCode.PROVIDER_REQUEST_FAILED, 502),
    ErrorKind.UNKNOWN: (ErrorCode.PROVIDER_REQUEST_FAILED, 500),
}


class AIProviderError(Exception):
    """Falha conhecida de um provedor de IA, com código estável para a UI.

    kind orienta o chain executor; trail registra os fallbacks tentados.
    retry_after carrega o cooldown sugerido pelo provedor (segundos).
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        provider: str,
        status_code: int = 500,
        kind: ErrorKind | None = None,
        trail: list[dict] | None = None,
        retry_after: int | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.provider = provider
        self.status_code = status_code
        self.kind = kind
        self.trail = trail or []
        self.retry_after = retry_after
