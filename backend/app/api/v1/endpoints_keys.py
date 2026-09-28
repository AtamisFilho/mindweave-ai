"""Endpoints das chaves de IA (prefixo /api/v1/ai/keys).

A resposta NUNCA inclui o material das chaves — apenas metadados.
"""
import re

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from app.services import keys_service

router = APIRouter()

_PROVIDER_PATTERN = re.compile(r"^[a-z0-9_-]{1,40}$")


def _validate_provider(provider: str) -> str:
    if not _PROVIDER_PATTERN.match(provider):
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_PROVIDER",
                "message": "Provedor deve ser um slug minúsculo (a-z, 0-9, -, _).",
            },
        )
    if provider not in keys_service.KNOWN_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "UNKNOWN_PROVIDER",
                "message": f"Provedor desconhecido: {provider}.",
            },
        )
    return provider


class KeyPayload(BaseModel):
    key: str


@router.get("")
async def list_keys():
    """Provedores com chave configurada — metadados apenas."""
    return keys_service.list_providers()


@router.put("/{provider}")
async def save_key(provider: str, payload: KeyPayload = Body(...)):
    _validate_provider(provider)
    if not payload.key.strip():
        raise HTTPException(
            status_code=400,
            detail={"error_code": "EMPTY_KEY", "message": "Chave vazia."},
        )
    result = keys_service.set_key(provider, payload.key.strip())
    return result


@router.delete("/{provider}", status_code=204)
async def delete_key(provider: str):
    if not keys_service.delete_key(provider):
        raise HTTPException(status_code=404, detail="Chave não encontrada para este provedor.")
