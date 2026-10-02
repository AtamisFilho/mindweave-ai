"""Testes do /ai/suggest-nodes-batch (v0.4.5 B4).

Contrato do lote: {map_id, node_ids} -> um resultado POR nó, com falhas
isoladas (nó inexistente ou cadeia caída não derruba os demais).
"""
import respx
from httpx import ConnectError, Response


async def _criar_mapa_com_dois_nos(client) -> str:
    document = {
        "nodes": [
            {"id": "raiz", "data": {"label": "Raiz", "parentId": None, "isRoot": True}, "position": {"x": 0, "y": 0}},
            {"id": "n1", "data": {"label": "Plantio", "parentId": "raiz"}, "position": {"x": 300, "y": 0}},
            {"id": "n2", "data": {"label": "Colheita", "parentId": "raiz"}, "position": {"x": 300, "y": 130}},
        ],
        "edges": [
            {"id": "e-raiz-n1", "source": "raiz", "target": "n1"},
            {"id": "e-raiz-n2", "source": "raiz", "target": "n2"},
        ],
    }
    resp = await client.post("/api/v1/maps", json={"title": "Horta", "document": document})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _mock_ollama_ok():
    return respx.post("http://localhost:11434/api/generate").mock(
        return_value=Response(200, json={"response": "Sugestão A\nSugestão B"})
    )


@respx.mock
async def test_batch_sucesso(client):
    map_id = await _criar_mapa_com_dois_nos(client)
    _mock_ollama_ok()
    resp = await client.post(
        "/api/v1/ai/suggest-nodes-batch",
        json={"map_id": map_id, "node_ids": ["n1", "n2"]},
    )
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert [r["node_id"] for r in results] == ["n1", "n2"]
    for r in results:
        assert r["error_code"] is None
        assert [s["content"] for s in r["suggestedNodes"]] == ["Sugestão A", "Sugestão B"]
        assert r["provider_used"]  # cadeia respondeu


@respx.mock
async def test_batch_dedupe_preserva_ordem(client):
    map_id = await _criar_mapa_com_dois_nos(client)
    _mock_ollama_ok()
    resp = await client.post(
        "/api/v1/ai/suggest-nodes-batch",
        json={"map_id": map_id, "node_ids": ["n2", "n2", "n1"]},
    )
    assert resp.status_code == 200
    assert [r["node_id"] for r in resp.json()["results"]] == ["n2", "n1"]


async def test_batch_vazio_400(client):
    map_id = await _criar_mapa_com_dois_nos(client)
    resp = await client.post(
        "/api/v1/ai/suggest-nodes-batch",
        json={"map_id": map_id, "node_ids": []},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "EMPTY_BATCH"


async def test_batch_acima_do_teto_400(client):
    map_id = await _criar_mapa_com_dois_nos(client)
    resp = await client.post(
        "/api/v1/ai/suggest-nodes-batch",
        json={"map_id": map_id, "node_ids": [f"n{i}" for i in range(6)]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "BATCH_TOO_LARGE"


async def test_batch_mapa_inexistente_404(client):
    resp = await client.post(
        "/api/v1/ai/suggest-nodes-batch",
        json={"map_id": "nao-existe", "node_ids": ["n1"]},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "MAP_NOT_FOUND"


@respx.mock
async def test_batch_no_inexistente_isolado(client):
    """Nó fantasma vira error_code POR NÓ; o nó válido continua expandindo."""
    map_id = await _criar_mapa_com_dois_nos(client)
    _mock_ollama_ok()
    resp = await client.post(
        "/api/v1/ai/suggest-nodes-batch",
        json={"map_id": map_id, "node_ids": ["fantasma", "n1"]},
    )
    assert resp.status_code == 200
    results = {r["node_id"]: r for r in resp.json()["results"]}
    assert results["fantasma"]["error_code"] == "NODE_NOT_FOUND"
    assert results["fantasma"]["suggestedNodes"] == []
    assert results["n1"]["error_code"] is None
    assert len(results["n1"]["suggestedNodes"]) == 2


@respx.mock
async def test_batch_cadeia_caida_falha_por_no(client, monkeypatch):
    """Cadeia inteira fora: HTTP 200 com error_code em cada nó — o frontend
    decide o toast; nenhum nó é adicionado. A cadeia é travada no Ollama
    (monkeypatch) para o teste não pagar timeout de connect dos demais."""
    from app.services import chain_executor

    map_id = await _criar_mapa_com_dois_nos(client)
    monkeypatch.setattr(chain_executor, "build_chain", lambda preferred=None: ["ollama"])
    respx.post("http://localhost:11434/api/generate").side_effect = ConnectError("recusado")
    resp = await client.post(
        "/api/v1/ai/suggest-nodes-batch",
        json={"map_id": map_id, "node_ids": ["n1", "n2"]},
    )
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert len(results) == 2
    for r in results:
        assert r["error_code"] == "ALL_PROVIDERS_FAILED"
        assert r["suggestedNodes"] == []
