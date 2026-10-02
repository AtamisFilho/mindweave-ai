"""Testes da v0.6.1 — onboarding de provedores locais.

Cobre: base_url por provedor persistida na cadeia (coluna nova), modelo
por provedor USADO nas chamadas (o provider_chain.model era ignorado),
list_models com o caminho corrigido (o /v1/v1 histórico) e override de
base_url na listagem.
"""
import respx
from httpx import Response

from app.services import chain_config_service


def _salvar_cadeia_com(client, **lmstudio):
    entry = {"provider": "lmstudio", "enabled": True, "model": None}
    entry.update(lmstudio)
    ollama = {"provider": "ollama", "enabled": True, "model": None}
    return client.put("/api/v1/ai/chain", json={"chain": [entry, ollama]})


async def test_base_url_persiste_e_volta_no_get(client):
    await _salvar_cadeia_com(client, base_url="http://localhost:9911/v1")
    chain = (await client.get("/api/v1/ai/chain")).json()
    lm = next(c for c in chain if c["provider"] == "lmstudio")
    assert lm["base_url"] == "http://localhost:9911/v1"


async def test_save_sem_base_url_preserva_a_anterior(client):
    await _salvar_cadeia_com(client, base_url="http://localhost:9911/v1")
    # save da UI comum: envia provider/enabled/model SEM base_url
    await client.put("/api/v1/ai/chain", json={"chain": [
        {"provider": "lmstudio", "enabled": True, "model": "qwen"},
        {"provider": "ollama", "enabled": True, "model": None},
    ]})
    chain = (await client.get("/api/v1/ai/chain")).json()
    lm = next(c for c in chain if c["provider"] == "lmstudio")
    assert lm["model"] == "qwen"
    assert lm["base_url"] == "http://localhost:9911/v1"  # preservada


@respx.mock
async def test_modelo_da_cadeia_e_usado_na_chamada(client, monkeypatch):
    """provider_chain.model era IGNORADO pelo executor — agora manda."""
    from app.services import chain_executor

    monkeypatch.setattr(chain_executor, "build_chain", lambda preferred=None: ["lmstudio"])
    route = respx.post("http://localhost:1234/v1/chat/completions").mock(
        return_value=Response(200, json={"choices": [{"message": {"content": "ok"}}]})
    )
    await _salvar_cadeia_com(client, model="qwen2.5-7b-instruct")

    resp = await client.post("/api/v1/ai/deep-research", json={
        "nodeId": "n1", "nodeContent": "T",
    })
    assert resp.status_code == 200
    import json
    sent = json.loads(route.calls.last.request.content)
    assert sent["model"] == "qwen2.5-7b-instruct"


@respx.mock
async def test_base_url_da_cadeia_e_usada_na_chamada(client, monkeypatch):
    from app.services import chain_executor

    monkeypatch.setattr(chain_executor, "build_chain", lambda preferred=None: ["lmstudio"])
    route = respx.post("http://localhost:9911/v1/chat/completions").mock(
        return_value=Response(200, json={"choices": [{"message": {"content": "ok"}}]})
    )
    await _salvar_cadeia_com(client, base_url="http://localhost:9911/v1")

    resp = await client.post("/api/v1/ai/deep-research", json={
        "nodeId": "n1", "nodeContent": "T",
    })
    assert resp.status_code == 200
    assert route.called


@respx.mock
async def test_list_models_caminho_correto_sem_v1_duplicado(client):
    """Bug histórico: montava {base}/v1/models com base já terminando em /v1."""
    route = respx.get("http://localhost:1234/v1/models").mock(
        return_value=Response(200, json={"data": [{"id": "qwen2.5-7b-instruct"}]})
    )
    resp = await client.get("/api/v1/ai/models/lmstudio")
    assert resp.status_code == 200
    body = resp.json()
    assert body["models"] == ["qwen2.5-7b-instruct"]
    assert body["base_url"] == "http://localhost:1234/v1"
    assert route.called


@respx.mock
async def test_list_models_honra_base_url_da_cadeia(client):
    await _salvar_cadeia_com(client, base_url="http://localhost:9911/v1")
    route = respx.get("http://localhost:9911/v1/models").mock(
        return_value=Response(200, json={"data": [{"id": "m1"}]})
    )
    resp = await client.get("/api/v1/ai/models/lmstudio")
    assert resp.status_code == 200
    assert resp.json()["models"] == ["m1"]
    assert route.called


@respx.mock
async def test_list_models_fora_do_ar_503(client, monkeypatch):
    import httpx as _httpx


    monkeypatch.setattr(
        chain_config_service, "get_chain_config",
        lambda: [{"provider": "lmstudio", "enabled": True, "order": 0, "model": None, "base_url": None}],
    )
    respx.get("http://localhost:1234/v1/models").side_effect = _httpx.ConnectError("recusado")
    resp = await client.get("/api/v1/ai/models/lmstudio")
    assert resp.status_code == 503
    assert resp.json()["detail"]["error_code"] == "PROVIDER_UNREACHABLE"
