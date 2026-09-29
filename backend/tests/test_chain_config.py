"""Testes da configuração da cadeia (ordem, toggles, seed, reset)."""
import pytest

from app.services import chain_config_service


@pytest.fixture(autouse=True)
def fresh_chain():
    """Zera a cadeia antes de cada teste (seed acontece no primeiro get)."""
    from app.db import SessionLocal
    from app.models_db import ProviderChainRow
    with SessionLocal() as session:
        session.query(ProviderChainRow).delete()
        session.commit()
    yield
    with SessionLocal() as session:
        session.query(ProviderChainRow).delete()
        session.commit()


def test_primeiro_accesso_semeia_cadeia_padrao():
    config = chain_config_service.get_chain_config()
    providers = [c["provider"] for c in config]
    assert providers[0] == "groq"                       # preferido default
    assert providers[-2:] == ["lmstudio", "ollama"]     # locais por último
    assert all(c["enabled"] for c in config)
    assert len(config) == 8


def test_save_persiste_ordem_e_toggles():
    chain_config_service.get_chain_config()  # semeia
    chain_config_service.save_chain_config([
        {"provider": "gemini", "enabled": True},
        {"provider": "groq", "enabled": True},
        {"provider": "ollama", "enabled": False},
    ])
    config = chain_config_service.get_chain_config()
    assert [c["provider"] for c in config] == ["gemini", "groq", "ollama"]
    by_id = {c["provider"]: c for c in config}
    assert by_id["gemini"]["enabled"] is True
    assert by_id["ollama"]["enabled"] is False
    # só os 3 enviados existem (a config substitui a cadeia inteira)


def test_save_provedor_desconhecido_400():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        chain_config_service.save_chain_config([{"provider": "zai-browser", "enabled": True}])
    assert exc.value.detail["error_code"] == "UNKNOWN_PROVIDER"


def test_save_duplicado_400():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        chain_config_service.save_chain_config([
            {"provider": "groq", "enabled": True},
            {"provider": "groq", "enabled": True},
        ])
    assert exc.value.detail["error_code"] == "DUPLICATE_PROVIDER"


def test_save_todos_desabilitados_400():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        chain_config_service.save_chain_config([{"provider": "groq", "enabled": False}])
    assert exc.value.detail["error_code"] == "ALL_DISABLED"


def test_reset_restaura_padrao():
    chain_config_service.save_chain_config([
        {"provider": "deepseek", "enabled": True},
    ])
    chain_config_service.reset_chain_config()
    providers = [c["provider"] for c in chain_config_service.get_chain_config()]
    assert providers[0] == "groq"
    assert len(providers) == 8


def test_enabled_order_para_o_executor():
    chain_config_service.save_chain_config([
        {"provider": "gemini", "enabled": True},
        {"provider": "groq", "enabled": False},
        {"provider": "ollama", "enabled": True},
    ])
    assert chain_config_service.enabled_order() == ["gemini", "ollama"]
