"""Erros estruturados da camada de IA.

Fluxo: services levantam AIProviderError; o exception handler no main.py
traduz para HTTPException-style JSON:

    {"detail": {"error_code": "...", "message": "...", "provider": "..."}}

O error_code é consumido pelo frontend (mapeamento para toasts/ícones/ações).
"""
from enum import Enum


class ErrorCode(str, Enum):
    PROVIDER_UNREACHABLE = "PROVIDER_UNREACHABLE"        # 503 — serviço inacessível
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"                # 504 — não respondeu a tempo
    PROVIDER_INVALID_KEY = "PROVIDER_INVALID_KEY"        # 502 — chave rejeitada
    PROVIDER_REQUEST_FAILED = "PROVIDER_REQUEST_FAILED"  # 502 — outro erro HTTP do provedor
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"                  # 502 — modelo inexistente
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"          # 429 — quota/rate limit
    KEY_NOT_CONFIGURED = "KEY_NOT_CONFIGURED"            # 400 — chave ausente no servidor
    UNKNOWN_PROVIDER = "UNKNOWN_PROVIDER"                # 400 — provedor inexistente


class AIProviderError(Exception):
    """Falha conhecida de um provedor de IA, com código estável para a UI."""

    def __init__(self, code: ErrorCode, message: str, provider: str, status_code: int = 500):
        super().__init__(message)
        self.code = code
        self.message = message
        self.provider = provider
        self.status_code = status_code
