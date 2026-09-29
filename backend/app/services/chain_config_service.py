"""Configuração da cadeia de provedores (ordem, toggles, modelo por provedor).

Fonte de verdade: tabela provider_chain. Primeiro acesso popula com a
cadeia padrão (idempotente). Locais (ollama/lmstudio) são sugeridos por
último na ordem default — fallback soberano.
"""
from fastapi import HTTPException

from app.db import SessionLocal
from app.models_db import ProviderChainRow
from app.providers import PROVIDERS

DEFAULT_CHAIN_ORDER = [
    "groq", "gemini", "openrouter", "cerebras", "deepseek", "openai",
    "lmstudio", "ollama",
]
LOCAL_PROVIDERS = {"ollama", "lmstudio"}


def _seed_if_empty(session) -> bool:
    if session.query(ProviderChainRow).count() > 0:
        return False
    locals_first = [p for p in DEFAULT_CHAIN_ORDER if p in LOCAL_PROVIDERS]
    remotes = [p for p in DEFAULT_CHAIN_ORDER if p not in LOCAL_PROVIDERS]
    # default: locais por último (fallback soberano)
    ordered = remotes + locals_first
    for idx, provider in enumerate(ordered):
        session.add(ProviderChainRow(provider=provider, enabled=True, sort_order=idx))
    return True


def get_chain_config() -> list[dict]:
    """Cadeia ordenada: {provider, enabled, order, model}.
    Primeiro acesso semeia a cadeia padrão."""
    with SessionLocal() as session:
        _seed_if_empty(session)
        session.commit()
        rows = session.query(ProviderChainRow).order_by(ProviderChainRow.sort_order).all()
        return [
            {
                "provider": row.provider,
                "enabled": row.enabled,
                "order": row.sort_order,
                "model": row.model,
            }
            for row in rows
        ]


def save_chain_config(entries: list[dict]) -> list[dict]:
    """Substitui a cadeia: [{provider, enabled, model?}]. order = índice na lista.
    Valida: provedores conhecidos, sem duplicatas e >= 1 habilitado."""
    if not entries:
        raise HTTPException(status_code=400, detail={
            "error_code": "EMPTY_CHAIN",
            "message": "A cadeia precisa de pelo menos um provedor.",
        })
    ids = [e["provider"] for e in entries]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail={
            "error_code": "DUPLICATE_PROVIDER",
            "message": "Provedor duplicado na cadeia.",
        })
    unknown = [p for p in ids if p not in PROVIDERS]
    if unknown:
        raise HTTPException(status_code=400, detail={
            "error_code": "UNKNOWN_PROVIDER",
            "message": f"Provedor desconhecido: {unknown[0]}",
        })
    enabled_count = sum(1 for e in entries if e.get("enabled", True))
    if enabled_count == 0:
        raise HTTPException(status_code=400, detail={
            "error_code": "ALL_DISABLED",
            "message": "Pelo menos um provedor deve estar habilitado.",
        })

    with SessionLocal() as session:
        session.query(ProviderChainRow).delete()
        for idx, entry in enumerate(entries):
            session.add(ProviderChainRow(
                provider=entry["provider"],
                enabled=bool(entry.get("enabled", True)),
                sort_order=idx,
                model=entry.get("model"),
            ))
        session.commit()
    return get_chain_config()


def reset_chain_config() -> list[dict]:
    with SessionLocal() as session:
        session.query(ProviderChainRow).delete()
        session.commit()
        _seed_if_empty(session)
        session.commit()
    return get_chain_config()


def enabled_order() -> list[str]:
    """Ids habilitados em ordem — consumido pelo chain executor."""
    config = get_chain_config()
    return [c["provider"] for c in config if c["enabled"]]
