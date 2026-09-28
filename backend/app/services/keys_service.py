"""Serviço de chaves de API: criptografia em repouso + precedência.

Precedência de chaves (documentada): tabela api_keys VENCE variáveis de
ambiente (.env). Os globais em memória do ai_service permanecem como
fallback de compatibilidade até o B1 religar os adapters na tabela.
"""
import os

from app.core.crypto import decrypt, encrypt
from app.db import SessionLocal
from app.models_db import APIKeyRow, utcnow

# Provedores conhecidos — proteção contra typo (a chave iria para o lugar errado)
KNOWN_PROVIDERS = {
    "openai", "google", "groq", "openrouter", "cerebras", "deepseek", "ollama", "lmstudio",
}


def set_key(provider: str, key: str) -> dict:
    now = utcnow()
    with SessionLocal() as session:
        row = session.get(APIKeyRow, provider)
        if row:
            row.encrypted = encrypt(key)
            row.updated_at = now
        else:
            row = APIKeyRow(provider=provider, encrypted=encrypt(key), created_at=now, updated_at=now)
            session.add(row)
        session.commit()
        return {"provider": provider, "updated_at": row.updated_at.isoformat()}


def get_key(provider: str) -> str | None:
    with SessionLocal() as session:
        row = session.get(APIKeyRow, provider)
        if not row:
            return None
        return decrypt(row.encrypted)


def delete_key(provider: str) -> bool:
    with SessionLocal() as session:
        row = session.get(APIKeyRow, provider)
        if not row:
            return False
        session.delete(row)
        session.commit()
        return True


def list_providers() -> list[dict]:
    """Metadados apenas — NUNCA o material das chaves."""
    with SessionLocal() as session:
        rows = session.query(APIKeyRow).order_by(APIKeyRow.provider).all()
        return [
            {
                "provider": row.provider,
                "updated_at": row.updated_at.isoformat(),
                "key_set": True,
            }
            for row in rows
        ]


def migrate_env_keys(env: dict[str, str | None] | None = None) -> list[str]:
    """Migração automática v0.3 -> v0.4: chaves de variáveis de ambiente
    (OPENAI_API_KEY/GOOGLE_API_KEY) vão para o banco criptografado.
    Idempotente: só migra provedores ainda sem entrada na tabela."""
    env = env if env is not None else os.environ
    migrated = []
    mapping = {"OPENAI_API_KEY": "openai", "GOOGLE_API_KEY": "google"}
    with SessionLocal() as session:
        existing = {row.provider for row in session.query(APIKeyRow).all()}
        for env_name, provider in mapping.items():
            value = env.get(env_name)
            if value and provider not in existing:
                session.add(APIKeyRow(
                    provider=provider,
                    encrypted=encrypt(value),
                    created_at=utcnow(),
                    updated_at=utcnow(),
                ))
                migrated.append(provider)
        if migrated:
            session.commit()
    return migrated
