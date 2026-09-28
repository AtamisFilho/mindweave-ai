"""Testes do Bloco 0 (v0.4): criptografia de chaves em repouso.

Invariantes provados aqui: round-trip Fernet, isolamento por provedor,
NENHUMA chave em claro em logs/respostas, migração idempotente do .env.
"""

from app.core import crypto
from app.services import keys_service

SEGREDO = "sk-SEGREDO-NAO-VAZAR-9f3k2"


# --- crypto puro ---

def test_roundtrip_fernet():
    token = crypto.encrypt(SEGREDO)
    assert token != SEGREDO.encode()
    assert SEGREDO not in token.decode()
    assert crypto.decrypt(token) == SEGREDO


# --- serviço: CRUD + isolamento ---

def test_set_get_delete_isolado_por_provider():
    keys_service.set_key("groq", SEGREDO)
    keys_service.set_key("google", "outra-chave-google")

    assert keys_service.get_key("groq") == SEGREDO
    assert keys_service.get_key("google") == "outra-chave-google"

    assert keys_service.delete_key("groq") is True
    assert keys_service.get_key("groq") is None
    assert keys_service.get_key("google") == "outra-chave-google"  # isolado
    assert keys_service.delete_key("groq") is False


def test_upsert_substitui_sem_duplicar():
    keys_service.set_key("groq", "v1")
    keys_service.set_key("groq", "v2")
    providers = [p["provider"] for p in keys_service.list_providers() if p["provider"] == "groq"]
    assert providers == ["groq"]
    assert keys_service.get_key("groq") == "v2"


# --- sigilo: chave nunca aparece em logs ---

def test_chave_nunca_aparece_em_logs(caplog):
    import logging
    with caplog.at_level(logging.DEBUG):
        keys_service.set_key("groq", SEGREDO)
        keys_service.get_key("groq")
        keys_service.list_providers()
    assert SEGREDO not in caplog.text


# --- migração automática do .env ---

def test_migracao_env_idempotente(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-DO-ENV")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    migrated = keys_service.migrate_env_keys({"OPENAI_API_KEY": "sk-DO-ENV"})
    assert migrated == ["openai"]
    assert keys_service.get_key("openai") == "sk-DO-ENV"

    # segunda execução: nada a migrar (idempotente)
    assert keys_service.migrate_env_keys({"OPENAI_API_KEY": "sk-DO-ENV"}) == []


def test_migracao_nao_sobrescreve_chave_existente(monkeypatch):
    keys_service.set_key("openai", "chave-da-ui")
    keys_service.migrate_env_keys({"OPENAI_API_KEY": "sk-DO-ENV"})
    assert keys_service.get_key("openai") == "chave-da-ui"
