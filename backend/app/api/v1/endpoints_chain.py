"""Endpoints da cadeia de provedores (prefixo /api/v1/ai/chain)
e da listagem de modelos locais (/api/v1/ai/models/{provider})."""
from fastapi import APIRouter, Body, HTTPException

from app.providers import PROVIDERS
from app.services import chain_config_service, chain_executor

router = APIRouter()


def _chain_entry(entry: dict) -> dict:
    provider = PROVIDERS[entry["provider"]]
    return {
        "provider": entry["provider"],
        "label": provider.label,
        "enabled": entry["enabled"],
        "order": entry["order"],
        "model": entry.get("model"),
        "local": provider.local,
        "requires_key": provider.requires_key,
        "cooldown_until": chain_executor.cooldown_until(entry["provider"]),
    }


@router.get("")
async def get_chain():
    return [_chain_entry(entry) for entry in chain_config_service.get_chain_config()]


@router.put("")
async def save_chain(chain: list[dict] = Body(..., embed=True)):
    config = chain_config_service.save_chain_config(chain)
    return [_chain_entry(entry) for entry in config]


@router.post("/reset", response_model=None)
async def reset_chain():
    config = chain_config_service.reset_chain_config()
    return [_chain_entry(entry) for entry in config]


@router.get("/models/{provider}")
async def list_models(provider: str):
    """Lista modelos disponíveis (apenas provedores locais)."""
    if provider not in PROVIDERS or not PROVIDERS[provider].local:
        raise HTTPException(status_code=400, detail={
            "error_code": "LOCAL_ONLY",
            "message": "Listagem de modelos disponível apenas para provedores locais.",
        })
    provider_obj = PROVIDERS[provider]
    try:
        import httpx
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            if provider == "ollama":
                resp = await client.get(f"{provider_obj.base_url.rstrip('/')}/api/tags")
                models = [m.get("name") for m in resp.json().get("models", []) if m.get("name")]
            else:  # lm studio (OpenAI-compatible)
                resp = await client.get(f"{provider_obj.base_url.rstrip('/')}/v1/models")
                models = [m.get("id") for m in resp.json().get("data", []) if m.get("id")]
        return {"provider": provider, "models": models}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail={
            "error_code": "PROVIDER_UNREACHABLE",
            "message": f"Não foi possível listar modelos de {provider} (servidor local fora do ar?).",
        }) from exc
