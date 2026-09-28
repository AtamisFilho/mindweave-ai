"""Testes HTTP dos endpoints de chaves: contrato sem vazamento."""
import logging

import pytest


@pytest.fixture(autouse=True)
def _silence_console(capfd):
    """Silencia stdout/stderr do uvicorn nos testes (os asserts de sigilo
    olham caplog + corpo das respostas, não o console)."""
    yield


async def _put_key(client, provider, key):
    return await client.put(f"/api/v1/ai/keys/{provider}", json={"key": key})


async def test_put_list_delete_sem_vazar_chave(client, caplog):
    with caplog.at_level(logging.DEBUG):
        resp = await _put_key(client, "groq", "sk-GROQ-SECRETA")
        assert resp.status_code == 200
        body = resp.json()
        assert body["provider"] == "groq"
        assert "sk-GROQ-SECRETA" not in resp.text  # resposta não ecoa a chave

        listed = (await client.get("/api/v1/ai/keys")).json()
        assert [p["provider"] for p in listed] == ["groq"]
        assert all("key" not in p or p.get("key") is None for p in listed)
        assert "sk-GROQ-SECRETA" not in str(listed)

        assert (await client.delete("/api/v1/ai/keys/groq")).status_code == 204

    # e nada do que passou pelos logs contém a chave
    assert "sk-GROQ-SECRETA" not in caplog.text


async def test_put_provider_desconhecido_400_estruturado(client):
    resp = await _put_key(client, "zai-browser", "qualquer")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "UNKNOWN_PROVIDER"


async def test_put_chave_vazia_400(client):
    resp = await _put_key(client, "groq", "   ")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "EMPTY_KEY"


async def test_delete_inexistente_404(client):
    resp = await client.delete("/api/v1/ai/keys/groq")
    assert resp.status_code == 404


async def test_update_ai_config_espelha_chave_criptografada(client):
    from app.services import keys_service

    resp = await client.put(
        "/api/v1/ai/config",
        json={"selectedProvider": "openai", "openaiApiKey": "sk-DA-UI"},
    )
    assert resp.status_code == 200
    assert keys_service.get_key("openai") == "sk-DA-UI"
