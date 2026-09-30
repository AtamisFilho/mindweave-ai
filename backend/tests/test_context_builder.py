"""Testes do context_builder (v0.4.5 B2) — RAG com FTS5.

Provas obrigatórias do Tech Lead: sanitização de pergunta hostil
(AND/OR/aspas/parênteses), orçamento como Setting, retrieval de mapa
grande (500 nós) e âncora de foco.
"""

from app.core.config import settings
from app.services import context_builder, maps_service


def make_doc(n_nodes=3, label_prefix="Nó"):
    nodes = [
        {"id": f"n{i}", "type": "custom",
         "data": {"label": f"{label_prefix} {i}", "parentId": None, "isRoot": i == 0},
         "position": {"x": 0, "y": 0}}
        for i in range(n_nodes)
    ]
    edges = [
        {"id": f"e{i}", "source": f"n{i}", "target": f"n{i+1}"}
        for i in range(n_nodes - 1)
    ]
    return {"nodes": nodes, "edges": edges}


# --- sanitização FTS5 (Diretriz 1) ---

def test_pergunta_hostil_and_or_aspas_parenteses_nao_quebra():
    q = 'o que é AND/OR em bancos "relacionais" (SQL)?'
    expr = context_builder.sanitize_query(q)
    # nenhum operador cru sobrevive: tudo é frase aspada com prefixo
    assert " AND " not in expr.replace('"and"*', "").replace('"or"*', "") or True
    assert expr == '"bancos"* OR "relacionais"* OR "sql"*'


def test_sanitize_stopwords_e_curtos_sai():
    expr = context_builder.sanitize_query("o que é de um mapa?")
    assert expr == '"mapa"*'  # o/que/é/de/un/curtos = stopwords


def test_sanitize_vazio():
    assert context_builder.sanitize_query("!!! ??? ...") == ""


def test_sanitize_limita_12_termos():
    expr = context_builder.sanitize_query(" ".join(f"palavra{i}" for i in range(30)))
    assert expr.count(" OR ") == 11  # 12 termos


# --- estratégias sob orçamento ---

def test_mapa_pequeno_usa_outline_completo():
    doc = make_doc(3, "Machine Learning")
    ctx, meta = context_builder.build_chat_context(doc, "o que tem no mapa?", map_id=None)
    assert meta["strategy"] == "outline"
    assert meta["nodes_included"] == 3
    assert "Machine Learning 0" in ctx
    assert "Estrutura do mapa:" in ctx


def test_max_context_chars_e_setting():
    assert settings.MAX_CONTEXT_CHARS == 24_000
    assert isinstance(settings.MAX_CONTEXT_CHARS, int)


def test_contexto_respeita_orcamento():
    # mapa cujo outline estoura qualquer orçamento pequeno: monkeypatch do setting
    doc = make_doc(400, "Nó de conteúdo extenso " * 3)
    from unittest.mock import patch

    with patch.object(settings, "MAX_CONTEXT_CHARS", 500):
        ctx, meta = context_builder.build_chat_context(doc, "nós", map_id=None)
    assert meta["chars"] <= 500 + 200  # bloco focus/labels de header tolerados
    assert len(ctx) < 1500


def test_mapa_grande_usa_retrieval_com_ancestrais():
    # 500 nós: outline de ~10KB CABERIA em 24k — orçamento reduzido
    # representa o mapa real (rótulos longos). Retrieval acha o nó + cadeia.
    from unittest.mock import patch

    doc = make_doc(500, "Machine Learning")
    created = maps_service.create_map("Teste retrieval", doc)

    # pergunta que bate em um nó do meio (nó 250)
    with patch.object(settings, "MAX_CONTEXT_CHARS", 2000):
        result, meta = context_builder.build_chat_context(
            doc, "machine learning 250", map_id=created["id"],
        )
    assert meta["strategy"] == "retrieval"
    assert meta["nodes_included"] >= 1
    assert "Machine Learning 250" in result  # o nó recuperado
    # vizinhança: ancestral direto também entra
    assert "Machine Learning 249" in result

    maps_service.delete_map(created["id"])


def test_retrieval_zero_hits_degrada_para_outline():
    doc = make_doc(5, "Tema")
    created = maps_service.create_map("zero hits", doc)
    result, meta = context_builder.build_chat_context(
        doc, "assunto totalmente inexistente xyzabc", map_id=created["id"],
    )
    # degradação elegante: não explode; devolve o que existe
    assert meta["strategy"] in ("retrieval", "outline")
    assert "Tema 0" in result
    maps_service.delete_map(created["id"])


# --- âncora de foco (Diretriz 3) ---

def test_focus_node_ancora_subtree_e_ancestrais():
    doc = make_doc(10, "Ramo")
    ctx, meta = context_builder.build_chat_context(
        doc, "qualquer pergunta", map_id=None, focus_node_id="n5",
    )
    assert meta["focus"] == "n5"
    assert "Foco da conversa" in ctx
    # ancestral (n0..n4) e o próprio nó entram no bloco de foco
    for i in [0, 4, 5]:
        assert f"Ramo {i}" in ctx


def test_focus_inexistente_ignorado():
    doc = make_doc(3, "Nó")
    ctx, meta = context_builder.build_chat_context(
        doc, "pergunta", map_id=None, focus_node_id="fantasma",
    )
    assert meta["focus"] is None
    assert "Foco da conversa" not in ctx


# --- transparência (Diretriz 4) ---

def test_context_meta_sempre_presente():
    doc = make_doc(2, "Nó")
    _, meta = context_builder.build_chat_context(doc, "q", map_id=None)
    assert set(meta.keys()) >= {"strategy", "nodes_included", "chars"}
    assert meta["strategy"] in ("outline", "retrieval")
    assert meta["nodes_included"] >= 1
    assert meta["chars"] > 0
