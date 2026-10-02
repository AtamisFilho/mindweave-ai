"""Endpoints da cadeia de provedores (prefixo /api/v1/ai/chain)."""
from fastapi import APIRouter, Body

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
        "base_url": entry.get("base_url"),
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



