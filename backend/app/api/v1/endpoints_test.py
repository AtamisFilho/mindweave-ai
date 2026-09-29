"""Testar conexão com um provedor (prompt mínimo real)."""
from fastapi import APIRouter, HTTPException

from app.core.errors import KIND_TO_RESPONSE, ErrorKind
from app.providers import PROVIDERS
from app.services import keys_service

router = APIRouter()

_TEST_PROMPT = "Responda apenas: pong"


@router.post("/{provider}/test")
async def test_connection(provider: str):
    """Chamada real mínima: retorna ok/latência ou o erro classificado."""
    import time

    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail={
            "error_code": "UNKNOWN_PROVIDER",
            "message": f"Provedor desconhecido: {provider}",
        })

    provider_obj = PROVIDERS[provider]
    api_key = keys_service.get_key(provider)
    if provider_obj.requires_key and not api_key:
        return {
            "ok": False,
            "provider": provider_obj.label,
            "error_kind": "KEY_NOT_CONFIGURED",
            "message": "Chave de API não configurada.",
        }

    started = time.perf_counter()
    try:
        content = await provider_obj.complete(_TEST_PROMPT, provider_obj.default_model, api_key)
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": True,
            "provider": provider_obj.label,
            "latency_ms": latency_ms,
            "sample": (content or "")[:120],
        }
    except Exception as exc:  # noqa: BLE001
        latency_ms = int((time.perf_counter() - started) * 1000)
        kind = getattr(exc, "kind", None) or ErrorKind.UNKNOWN
        code, status = KIND_TO_RESPONSE[kind]
        _ = code, status  # kind já basta para a UI
        return {
            "ok": False,
            "provider": provider_obj.label,
            "error_kind": kind.value,
            "message": str(exc)[:200],
            "latency_ms": latency_ms,
        }
