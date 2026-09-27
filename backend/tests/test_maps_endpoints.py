"""Testes HTTP dos endpoints de mapas (contrato + payload estruturado do 409)."""
import respx  # noqa: F401 — mantém o padrão de interceptação fora destes testes


async def test_fluxo_completo_crud(client):
    # POST
    created = (await client.post(
        "/api/v1/maps",
        json={"title": "Pesquisa IA", "document": {"nodes": [{"id": "n1", "data": {"label": "ML"}}], "edges": []}},
    )).json()
    assert created["version"] == 1
    map_id = created["id"]

    # GET único
    got = (await client.get(f"/api/v1/maps/{map_id}")).json()
    assert got["document"]["nodes"][0]["data"]["label"] == "ML"

    # PUT (autosave) com expected_version
    saved = (await client.put(
        f"/api/v1/maps/{map_id}",
        json={
            "title": "Pesquisa IA",
            "document": {"nodes": [{"id": "n1", "data": {"label": "ML v2"}}], "edges": []},
            "expected_version": 1,
        },
    )).json()
    assert saved["version"] == 2

    # GET lista (sem blob)
    listed = (await client.get("/api/v1/maps")).json()
    assert listed[0]["id"] == map_id
    assert "document" not in listed[0]
    assert listed[0]["node_count"] == 1

    # DELETE
    assert (await client.delete(f"/api/v1/maps/{map_id}")).status_code == 204
    assert (await client.get(f"/api/v1/maps/{map_id}")).status_code == 404


async def test_put_409_payload_estruturado(client):
    created = (await client.post("/api/v1/maps", json={"title": "M", "document": {"nodes": [], "edges": []}})).json()
    await client.put(
        f"/api/v1/maps/{created['id']}",
        json={"title": "Outra aba", "document": {"nodes": [], "edges": []}, "expected_version": 1},
    )
    resp = await client.put(
        f"/api/v1/maps/{created['id']}",
        json={"title": "Minha aba", "document": {"nodes": [], "edges": []}, "expected_version": 1},
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error_code"] == "MAP_VERSION_CONFLICT"
    assert detail["current_version"] == 2
    assert "outra aba" in detail["message"]


async def test_put_expected_version_ausente_salva_mesmo_assim(client):
    created = (await client.post("/api/v1/maps", json={"title": "M", "document": {"nodes": [], "edges": []}})).json()
    resp = await client.put(
        f"/api/v1/maps/{created['id']}",
        json={"title": "Sem version check", "document": {"nodes": [], "edges": []}},
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 2


async def test_put_mapa_inexistente_404(client):
    resp = await client.put(
        "/api/v1/maps/fantasma",
        json={"title": "T", "document": {"nodes": [], "edges": []}, "expected_version": 1},
    )
    assert resp.status_code == 404


async def test_last_404_sem_mapas_e_depois_ultimo(client):
    assert (await client.get("/api/v1/maps/last")).status_code == 404
    first = (await client.post("/api/v1/maps", json={"title": "P1", "document": {"nodes": [], "edges": []}})).json()
    second = (await client.post("/api/v1/maps", json={"title": "P2", "document": {"nodes": [], "edges": []}})).json()
    last = (await client.get("/api/v1/maps/last")).json()
    assert last["id"] == second["id"]
    assert last["id"] != first["id"]


async def test_search_endpoint(client):
    await client.post(
        "/api/v1/maps",
        json={"title": "Estudo", "document": {"nodes": [{"id": "n1", "data": {"label": "Redes Neurais"}}], "edges": []}},
    )
    resp = await client.get("/api/v1/maps/search", params={"q": "redes"})
    assert resp.status_code == 200
    hits = resp.json()
    assert len(hits) == 1
    assert hits[0]["node_text"] == "Redes Neurais"
    empty = await client.get("/api/v1/maps/search", params={"q": "inexistente"})
    assert empty.status_code == 200
    assert empty.json() == []
