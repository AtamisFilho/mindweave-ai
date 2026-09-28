"""Chain executor (v0.4): tenta a cadeia de provedores em ordem.

Decisões (design doc §3/§4 + Diretriz 2 do B1):
- RATE_LIMIT -> pula o provedor NESTA request + cooldown 30s
  (Retry-After do provedor tem precedência).
- QUOTA_EXHAUSTED -> provedor fora até o reset estimado (Retry-After
  ou 1h default).
- A trilha de fallbacks volta na exceção/resposta para o toast.
- Locais (Ollama/LM Studio) nunca falham por quota — fallback soberano.
"""
import time

from app.core.errors import AIProviderError, ErrorCode, ErrorKind
from app.providers import PROVIDERS
from app.services import keys_service

# Default da ordem (o usuário reordena na UI a partir do B3);
# locais por último = fallback soberano.
DEFAULT_CHAIN = ["groq", "gemini", "openrouter", "cerebras", "deepseek", "openai", "lmstudio", "ollama"]

_COOLDOWNS: dict[str, float] = {}  # provider_id -> epoch até quando evitar
_COOLDOWN_RATE_LIMIT = 30
_COOLDOWN_QUOTA_DEFAULT = 3600


def _now() -> float:
    return time.time()


def provider_in_cooldown(provider_id: str) -> bool:
    return _COOLDOWNS.get(provider_id, 0) > _now()


def reset_cooldowns() -> None:
    """Limpa cooldowns (uso em testes e em 'Sincronizar agora')."""
    _COOLDOWNS.clear()


def _has_credential(provider_id: str) -> bool:
    provider = PROVIDERS[provider_id]
    if not provider.requires_key:
        return True  # locais não precisam de chave
    return keys_service.get_key(provider_id) is not None


def build_chain(preferred: str | None = None) -> list[str]:
    """Cadeia efetiva: provedores com credencial/local, na ordem DEFAULT_CHAIN;
    o preferred (quando configurado) vai para a frente; locais por último."""
    usable = [p for p in DEFAULT_CHAIN if p in PROVIDERS and _has_credential(p)]
    if preferred and preferred in PROVIDERS:
        if preferred in usable:
            usable.remove(preferred)
        usable.insert(0, preferred)
    locals_last = [p for p in usable if PROVIDERS[p].local]
    remotes = [p for p in usable if not PROVIDERS[p].local]
    return remotes + locals_last


def _kind_of(exc: Exception) -> ErrorKind:
    return getattr(exc, "kind", None) or ErrorKind.UNKNOWN


async def execute_chain(
    prompt: str,
    *,
    model: str | None = None,
    preferred: str | None = None,
) -> dict:
    """Executa o prompt na cadeia de provedores.

    Retorna {"content", "provider", "provider_label", "model", "trail"}.
    Levanta AIProviderError (com trail) se TODOS falharem.
    """
    chain = build_chain(preferred)
    if not chain:
        raise AIProviderError(
            ErrorCode.KEY_NOT_CONFIGURED,
            "Nenhum provedor configurado na cadeia.",
            "chain",
            status_code=400,
            kind=ErrorKind.UNKNOWN,
        )

    trail: list[dict] = []
    last_error: Exception | None = None

    for provider_id in chain:
        provider = PROVIDERS[provider_id]
        if provider_in_cooldown(provider_id):
            trail.append({"provider": provider.label, "skipped": "cooldown"})
            continue

        model_to_use = model if (model and provider_id == preferred) else provider.default_model
        api_key = keys_service.get_key(provider_id) if provider.requires_key else None

        try:
            content = await provider.complete(prompt, model_to_use, api_key)
            return {
                "content": content,
                "provider": provider_id,
                "provider_label": provider.label,
                "model": model_to_use,
                "trail": trail,
            }
        except Exception as exc:  # noqa: BLE001 — o chain classifica QUALQUER falha
            kind = _kind_of(exc)
            trail.append({
                "provider": provider.label,
                "kind": kind.value,
                "message": str(exc)[:200],
            })

            # cooldown conforme o tipo (RateLimit curto; Quota até o reset)
            retry_after = getattr(exc, "retry_after", None)
            if kind is ErrorKind.QUOTA_EXHAUSTED:
                _COOLDOWNS[provider_id] = _now() + (retry_after or _COOLDOWN_QUOTA_DEFAULT)
            elif kind is ErrorKind.RATE_LIMIT:
                _COOLDOWNS[provider_id] = _now() + (retry_after or _COOLDOWN_RATE_LIMIT)
            last_error = exc

    raise AIProviderError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        "Todos os provedores da cadeia falharam.",
        "chain",
        status_code=502,
        kind=ErrorKind.PROVIDER_ERROR,
        trail=trail,
    ) from last_error
