"""Chain executor (v0.4): tenta a cadeia de provedores em ordem.

Decisões (design doc §3/§4 + Diretriz 2 do B1):
- RATE_LIMIT -> pula o provedor NESTA request + cooldown 30s
  (Retry-After do provedor tem precedência).
- QUOTA_EXHAUSTED -> provedor fora até o reset estimado (Retry-After
  ou 1h default).
- A trilha de fallbacks volta na exceção/resposta para o toast.
- Locais (Ollama/LM Studio) nunca falham por quota — fallback soberano.
"""
import logging
import time
from collections.abc import AsyncIterator

from app.core.errors import AIProviderError, ErrorCode, ErrorKind
from app.providers import PROVIDERS
from app.services import chain_config_service, keys_service

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


def cooldown_until(provider_id: str) -> int | None:
    """Epoch até quando o provedor está em cooldown (None = disponível)."""
    until = _COOLDOWNS.get(provider_id, 0)
    return int(until) if until > _now() else None


def reset_cooldowns() -> None:
    """Limpa cooldowns (uso em testes e em 'Sincronizar agora')."""
    _COOLDOWNS.clear()


def _has_credential(provider_id: str) -> bool:
    provider = PROVIDERS[provider_id]
    if not provider.requires_key:
        return True  # locais não precisam de chave
    return keys_service.get_key(provider_id) is not None


def build_chain(preferred: str | None = None) -> list[str]:
    """Cadeia efetiva: ordem configurada pelo usuário (tabela provider_chain);
    sem configuração -> DEFAULT_CHAIN. Filtra sem credencial; preferred à
    frente SOMENTE se estiver habilitado na cadeia (toggle off vence);
    locais por último (fallback soberano)."""
    configured_enabled = {
        c["provider"] for c in chain_config_service.get_chain_config() if c["enabled"]
    }
    base_order = (
        [c["provider"] for c in chain_config_service.get_chain_config() if c["enabled"]]
        or list(DEFAULT_CHAIN)
    )
    usable = [p for p in base_order if p in PROVIDERS and _has_credential(p)]
    if preferred and preferred in PROVIDERS and preferred in configured_enabled:
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
    only: str | None = None,
) -> dict:
    """Executa o prompt na cadeia de provedores.

    only: trava a execução em UM provedor (campo legado 'provider' — sem
    fallback). Retorna {"content", "provider", "provider_label", "model",
    "trail"}. Levanta AIProviderError (com trail) se TODOS falharem.
    """
    if only:
        if only not in PROVIDERS:
            from app.core.errors import ErrorKind as _EK
            raise AIProviderError(
                ErrorCode.UNKNOWN_PROVIDER,
                f"Provedor desconhecido: {only}",
                only,
                status_code=400,
                kind=_EK.UNKNOWN,
            )
        chain = [only]
    else:
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
            trail.append({
                "provider": provider.label,
                "kind": ErrorKind.RATE_LIMIT.value,  # pulado por cooldown recente
                "message": "Provedor em cooldown (falha recente) — pulado.",
                "skipped": True,
            })
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
            cooldown_until = None
            if kind is ErrorKind.QUOTA_EXHAUSTED:
                _COOLDOWNS[provider_id] = _now() + (retry_after or _COOLDOWN_QUOTA_DEFAULT)
                cooldown_until = int(_COOLDOWNS[provider_id])
            elif kind is ErrorKind.RATE_LIMIT:
                _COOLDOWNS[provider_id] = _now() + (retry_after or _COOLDOWN_RATE_LIMIT)
                cooldown_until = int(_COOLDOWNS[provider_id])
            trail[-1]["cooldown_until"] = cooldown_until
            last_error = exc

    raise AIProviderError(
        ErrorCode.ALL_PROVIDERS_FAILED,
        "Todos os provedores da cadeia falharam.",
        "chain",
        status_code=503,
        kind=ErrorKind.PROVIDER_ERROR,
        trail=trail,
    ) from last_error


# ---------------------------------------------------------------------------
# Streaming (v0.4.5 — protocolo do docs/design/ai-experience.md)
# Fallback AUTOMÁTICO somente ANTES do primeiro token (commit point). Depois
# do commit, o stream está travado no provedor: falha vira
# PROVIDER_STREAM_INTERRUPTED com retryable=true.
# ---------------------------------------------------------------------------

logger = logging.getLogger("app.chain")


async def execute_chain_stream(
    prompt: str,
    *,
    model: str | None = None,
    preferred: str | None = None,
) -> AsyncIterator[dict]:
    """Executa o prompt na cadeia emitindo eventos de stream:

    {"event": "chain",  provider, provider_label, status: trying|failed|skipped|committed, kind?, message?}
    {"event": "token",  delta}
    {"event": "done",   provider_used, provider_label, model, fallback_trail}
    {"event": "error",  error_code, message, fallback_trail, retryable}

    Fallback só antes do commit; após o commit, erro com retryable=true.
    """
    chain = build_chain(preferred)
    if not chain:
        yield {
            "event": "error",
            "error_code": ErrorCode.KEY_NOT_CONFIGURED.value,
            "message": "Nenhum provedor configurado na cadeia.",
            "fallback_trail": [],
            "retryable": False,
        }
        return

    trail: list[dict] = []

    for provider_id in chain:
        provider = PROVIDERS[provider_id]
        if provider_in_cooldown(provider_id):
            trail.append({
                "provider": provider.label,
                "kind": ErrorKind.RATE_LIMIT.value,
                "message": "Provedor em cooldown (falha recente) — pulado.",
                "cooldown_until": int(_COOLDOWNS.get(provider_id, 0)),
                "skipped": True,
            })
            yield {
                "event": "chain",
                "provider": provider_id,
                "provider_label": provider.label,
                "status": "skipped",
                "kind": ErrorKind.RATE_LIMIT.value,
                "message": "Em cooldown — pulado.",
            }
            continue

        model_to_use = model if (model and provider_id == preferred) else provider.default_model
        api_key = keys_service.get_key(provider_id) if provider.requires_key else None

        yield {
            "event": "chain",
            "provider": provider_id,
            "provider_label": provider.label,
            "status": "trying",
        }

        # Adapter sem capacidade de stream: complete() vira um único token
        if not provider.supports_stream:
            started = time.perf_counter()
            try:
                content = await provider.complete(prompt, model_to_use, api_key)
            except Exception as exc:  # noqa: BLE001
                kind = _kind_of(exc)
                trail.append({"provider": provider.label, "kind": kind.value, "message": str(exc)[:200]})
                _apply_cooldown(provider_id, kind, getattr(exc, "retry_after", None))
                yield {"event": "chain", "provider": provider_id, "provider_label": provider.label,
                       "status": "failed", "kind": kind.value, "message": str(exc)[:200]}
                continue
            logger.debug("chain TTFT(no-stream): provider=%s model=%s ttft_ms=%d",
                         provider_id, model_to_use, int((time.perf_counter() - started) * 1000))
            yield {"event": "chain", "provider": provider_id, "provider_label": provider.label, "status": "committed"}
            yield {"event": "token", "delta": content}
            yield {"event": "done", "provider_used": provider.label, "provider_label": provider.label,
                   "model": model_to_use, "fallback_trail": trail}  # provider_used = label (contrato REST v0.4)
            return

        # Caminho streaming — o stream_iter é criado antes do try e o finally
        # cobre TODO o trecho com upstream aberto: abort do cliente (ou erro)
        # propaga o fechamento até o httpx do adapter.
        stream_iter = provider.complete_stream(prompt, model_to_use, api_key)
        started = time.perf_counter()
        committed = False
        try:
            async for delta in stream_iter:
                if not committed:
                    committed = True
                    logger.debug("chain TTFT: provider=%s model=%s ttft_ms=%d",
                                 provider_id, model_to_use, int((time.perf_counter() - started) * 1000))
                    yield {"event": "chain", "provider": provider_id,
                           "provider_label": provider.label, "status": "committed"}
                yield {"event": "token", "delta": delta}
            # stream completo (sentinel recebido no adapter)
            yield {"event": "done", "provider_used": provider.label, "provider_label": provider.label,
                   "model": model_to_use, "fallback_trail": trail}  # provider_used = label (contrato REST v0.4)
            return
        except Exception as exc:  # noqa: BLE001 — o chain classifica QUALQUER falha
            kind = _kind_of(exc)
            if committed:
                # stream morreu no meio: SEM fallback — cliente decide retry
                trail.append({"provider": provider.label, "kind": kind.value, "message": str(exc)[:200]})
                yield {
                    "event": "error",
                    "error_code": ErrorCode.PROVIDER_STREAM_INTERRUPTED.value
                    if hasattr(ErrorCode, "PROVIDER_STREAM_INTERRUPTED")
                    else ErrorCode.PROVIDER_REQUEST_FAILED.value,
                    "message": f"{provider.label}: conexão interrompida durante a resposta.",
                    "fallback_trail": trail,
                    "retryable": True,
                }
                return
            trail.append({"provider": provider.label, "kind": kind.value, "message": str(exc)[:200]})
            _apply_cooldown(provider_id, kind, getattr(exc, "retry_after", None))
            yield {"event": "chain", "provider": provider_id, "provider_label": provider.label,
                   "status": "failed", "kind": kind.value, "message": str(exc)[:200]}
            continue
        finally:
            # abort do cliente (ou erro) propaga o fechamento até o httpx do adapter
            await stream_iter.aclose()

    yield {
        "event": "error",
        "error_code": ErrorCode.ALL_PROVIDERS_FAILED.value,
        "message": "Todos os provedores da cadeia falharam.",
        "fallback_trail": trail,
        "retryable": True,
    }


def _apply_cooldown(provider_id: str, kind, retry_after: int | None) -> None:
    retry_after = retry_after if retry_after is not None else getattr(kind, "retry_after", None)
    if kind is ErrorKind.QUOTA_EXHAUSTED:
        _COOLDOWNS[provider_id] = _now() + (retry_after or _COOLDOWN_QUOTA_DEFAULT)
    elif kind is ErrorKind.RATE_LIMIT:
        _COOLDOWNS[provider_id] = _now() + (retry_after or _COOLDOWN_RATE_LIMIT)
