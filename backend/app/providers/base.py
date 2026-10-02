"""Contrato comum dos provedores de IA (v0.4 — Provider Chain).

Diretrizes do Tech Lead aplicadas:
- complete_stream existe DESDE JÁ (v0.4.5 implementará; hoje levanta
  NotImplementedError) para a interface não quebrar com o SSE.
- compute/complete são funções de chamada; a classificação de erros é
  compartilhada (classify) e refinável por provedor.
"""
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

import httpx

from app.core.errors import ErrorKind

# Marcadores de contexto estourado (corpo da resposta, minúsculas)
_CONTEXT_MARKERS = ("context length", "maximum context", "too many tokens", "context_length_exceeded")


class ProviderCallError(Exception):
    """Falha de chamada crua de um adapter (pré-classificação do chain)."""

    def __init__(self, provider_id: str, kind: ErrorKind, message: str,
                 status_code: int | None = None, retry_after: int | None = None):
        super().__init__(message)
        self.provider_id = provider_id
        self.kind = kind
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


class AIProviderBase(ABC):
    """Contrato do adapter. Implementações: openai_compatible, gemini, ollama."""

    id: str = ""
    label: str = ""
    base_url: str = ""
    default_model: str = ""
    requires_key: bool = True
    local: bool = False
    supports_stream: bool = False  # v0.4.5: complete_stream implementado?

    @abstractmethod
    async def complete(self, prompt: str, model: str, api_key: str | None = None,
                       base_url: str | None = None) -> str:
        """Executa a geração e devolve o texto completo."""

    async def complete_stream(self, prompt: str, model: str, api_key: str | None = None,
                              base_url: str | None = None) -> AsyncIterator[str]:
        """Streaming de tokens. Adapters com supports_stream=False usam complete()."""
        raise NotImplementedError(f"{self.id}: streaming não implementado")
        yield ""  # pragma: no cover — torna a função geradora async

    # --- classificação compartilhada ---

    # 429 cujo corpo contém estes marcadores é COTA (não RPM) — sobrescreva por provedor
    daily_quota_markers: tuple[str, ...] = ()

    def classify(self, status_code: int | None, body: str) -> ErrorKind:
        low = (body or "").lower()
        if status_code in (401, 403):
            return ErrorKind.INVALID_KEY
        if status_code in (400, 401, 403) and "api key" in low:
            return ErrorKind.INVALID_KEY
        if status_code == 402:
            return ErrorKind.QUOTA_EXHAUSTED  # creditos/saldo esgotado (OpenRouter, DeepSeek)
        if status_code == 413 or any(marker in low for marker in _CONTEXT_MARKERS):
            return ErrorKind.CONTEXT_TOO_LARGE
        if status_code == 404:
            return ErrorKind.MODEL_NOT_FOUND
        if status_code == 429:
            if any(marker in low for marker in self.daily_quota_markers):
                return ErrorKind.QUOTA_EXHAUSTED
            return ErrorKind.RATE_LIMIT
        if status_code is not None and status_code >= 500:
            return ErrorKind.PROVIDER_ERROR
        if any(marker in low for marker in _CONTEXT_MARKERS):
            return ErrorKind.CONTEXT_TOO_LARGE
        return ErrorKind.UNKNOWN

    def retry_after_from(self, response: httpx.Response | None) -> int | None:
        if response is None:
            return None
        value = response.headers.get("retry-after")
        if value is None:
            return None
        try:
            return int(value)
        except ValueError:
            return None
