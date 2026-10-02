"""Testes do export Markdown (v0.6.0 B2).

Critério central: export ≡ contexto do chat na PROJEÇÃO (mesma travessia
do context_builder._outline), provado com cruzamento num DAG com
cross-links. Export sem orçamento e sem teto de profundidade.
"""
from app.services import context_builder


def _doc_dag_com_crosslink() -> dict:
    """Raiz → A, B; A → C; B → C (cross-link: C tem dois pais)."""
    nodes = [
        {"id": "raiz", "data": {"label": "Raiz"}, "position": {"x": 0, "y": 0}},
        {"id": "a", "data": {"label": "Branco A"}, "position": {"x": 1, "y": 0}},
        {"id": "b", "data": {"label": "Branco B"}, "position": {"x": 2, "y": 0}},
        {"id": "c", "data": {"label": "Nó C (cross-link)"}, "position": {"x": 3, "y": 0}},
    ]
    edges = [
        {"id": "e1", "source": "raiz", "target": "a"},
        {"id": "e2", "source": "raiz", "target": "b"},
        {"id": "e3", "source": "a", "target": "c"},
        {"id": "e4", "source": "b", "target": "c"},
    ]
    return {"nodes": nodes, "edges": edges}


# --- Consistência export ≡ chat (cruzamento no DAG) ---

def test_export_e_chat_usam_a_mesma_travessia():
    document = _doc_dag_com_crosslink()
    texto_export, incluidos, _ = context_builder._outline(
        document["nodes"], document["edges"], budget=10**9, max_depth=None,
    )
    contexto, meta = context_builder.build_chat_context(
        document, "resumo executivo do mapa", map_id=None, focus_node_id=None,
    )
    assert meta["strategy"] == "outline"  # mapa pequeno entra inteiro no chat
    assert texto_export.strip() in contexto  # o bloco do chat É a travessia
    assert incluidos == 5  # cross-link: C conta em cada ramo (4 nós, 5 visitas)


def test_cross_link_aparece_em_cada_ramo():
    """C com dois pais aparece nos DOIS ramos (em chat e export igualmente)."""
    document = _doc_dag_com_crosslink()
    texto, _, _ = context_builder._outline(
        document["nodes"], document["edges"], budget=10**9, max_depth=None,
    )
    assert texto.count("- Nó C (cross-link)") == 2
    assert "  - Nó C (cross-link)" in texto  # um nível abaixo do pai


def test_export_sem_teto_de_profundidade():
    """Cadeia de 20 níveis: export mostra tudo (chat corta no 12)."""
    nodes = [{"id": f"n{i}", "data": {"label": f"N{i}"}} for i in range(20)]
    edges = [{"id": f"e{i}", "source": f"n{i}", "target": f"n{i + 1}"} for i in range(19)]
    texto, _, _ = context_builder._outline(nodes, edges, budget=10**9, max_depth=None)
    assert "- N19" in texto  # além do teto de 12 do chat

    texto_chat, _, completa = context_builder._outline(nodes, edges, budget=10**9)
    assert "- N19" not in texto_chat
    assert completa is False  # o chat SINALIZA que cortou (transparência)


# --- Endpoint ---

async def test_export_endpoint_estrutura_e_headers(client):
    document = _doc_dag_com_crosslink()
    created = (await client.post("/api/v1/maps", json={
        "title": 'Projeto: pesquisa "final" <v2>?', "document": document,
    })).json()

    resp = await client.get(f"/api/v1/maps/{created['id']}/export/markdown")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    assert "attachment" in resp.headers["content-disposition"]

    body = resp.text
    assert body.startswith("# Projeto: pesquisa \"final\" <v2>?\n")  # H1 = título cru
    assert "- Raiz" in body
    assert "  - Branco A" in body and "  - Branco B" in body
    assert "    - Nó C (cross-link)" in body

    # filename sanitizado (sem : ? " < >), fallback preservado
    import re
    cd = resp.headers["content-disposition"]
    filename = re.search(r'filename="([^"]+)"', cd).group(1)
    assert filename == "Projeto pesquisa final v2.md"
    assert not any(ch in filename for ch in '\\/:*?"<>|')


async def test_export_endpoint_404(client):
    resp = await client.get("/api/v1/maps/nao-existe/export/markdown")
    assert resp.status_code == 404


async def test_export_filename_fallback_para_titulo_vazio(client):
    created = (await client.post("/api/v1/maps", json={
        "title": "???", "document": {"nodes": [{"id": "r", "data": {"label": "R"}}], "edges": []},
    })).json()
    resp = await client.get(f"/api/v1/maps/{created['id']}/export/markdown")
    assert 'filename="mapa-sem-titulo.md"' in resp.headers["content-disposition"]
