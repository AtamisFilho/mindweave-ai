"""Testes dos endpoints: contrato HTTP do payload estruturado de erros."""
import respx
from httpx import ConnectError, Response


@respx.mock
async def test_raiz_responde(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    assert "MindWeave" in resp.json()["message"]


async def test_config_padrao(client):
    resp = await client.get("/api/v1/ai/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["selectedProvider"] == "ollama"
    assert body["isOpenAiKeySet"] is False


async def test_put_config_sem_chave_nao_marca_como_configurada(client):
    resp = await client.put(
        "/api/v1/ai/config",
        json={"selectedProvider": "openai", "ollamaConfig": {"baseUrl": "http://x", "model": "m"}},
    )
    assert resp.status_code == 200
    assert resp.json()["isOpenAiKeySet"] is False


async def test_put_config_com_chave_marca_flag_e_nao_ecoa_valor(client):
    resp = await client.put(
        "/api/v1/ai/config",
        json={
            "selectedProvider": "openai",
            "openaiApiKey": "sk-SECRETA",
            "ollamaConfig": {"baseUrl": "http://x", "model": "m"},
        },
    )
    body = resp.json()
    assert body["isOpenAiKeySet"] is True
    assert "sk-SECRETA" not in resp.text  # chave nunca volta na resposta


async def test_deep_research_provider_invalido_422(client):
    # O Literal do Pydantic é a primeira linha de defesa (validação, não handler)
    resp = await client.post(
        "/api/v1/ai/deep-research",
        json={"nodeId": "n1", "nodeContent": "T", "provider": "claude"},
    )
    assert resp.status_code == 422


@respx.mock
async def test_deep_research_openai_sem_chave_400_estruturado(client):
    resp = await client.post(
        "/api/v1/ai/deep-research",
        json={"nodeId": "n1", "nodeContent": "T", "provider": "openai"},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["error_code"] == "KEY_NOT_CONFIGURED"
    assert detail["provider"] == "OpenAI"
    assert "message" in detail


@respx.mock
async def test_deep_research_ollama_fora_do_ar_503_estruturado(client):
    respx.post("http://localhost:11434/api/generate").side_effect = ConnectError("recusado")
    resp = await client.post(
        "/api/v1/ai/deep-research",
        json={"nodeId": "n1", "nodeContent": "T", "provider": "ollama"},
    )
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["error_code"] == "PROVIDER_UNREACHABLE"
    assert detail["provider"] == "Ollama"


@respx.mock
async def test_suggest_nodes_ollama_sucesso(client):
    respx.post("http://localhost:11434/api/generate").mock(
        return_value=Response(200, json={"response": "Sugestão 1\nSugestão 2"})
    )
    resp = await client.post(
        "/api/v1/ai/suggest-nodes",
        json={"nodeId": "n1", "nodeContent": "T", "provider": "ollama"},
    )
    assert resp.status_code == 200
    nodes = resp.json()["suggestedNodes"]
    assert [n["content"] for n in nodes] == ["Sugestão 1", "Sugestão 2"]


@respx.mock
async def test_suggest_nodes_erro_vira_503_estruturado(client):
    respx.post("http://localhost:11434/api/generate").side_effect = ConnectError("recusado")
    resp = await client.post(
        "/api/v1/ai/suggest-nodes",
        json={"nodeId": "n1", "nodeContent": "T", "provider": "ollama"},
    )
    assert resp.status_code == 503
    assert resp.json()["detail"]["error_code"] == "PROVIDER_UNREACHABLE"
