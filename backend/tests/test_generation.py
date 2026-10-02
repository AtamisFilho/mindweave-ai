"""Testes da geração de mapa (v0.4.5 B3): parser robusto + contrato HTTP.

O /ai/generate foi portado junto do fechamento v0.4.5: o commit do B3
trouxera só o frontend (modal/menu/spec) sem o backend nem a ação do store.
"""
import respx
from httpx import ConnectError, Response

from app.services.generation_service import (
    GenerationParseError,
    build_generation_prompt,
    parse_generated_tree,
)

# --- Parser (Diretriz 6: fixtures adversariais) ---

def test_parse_json_puro():
    tree = parse_generated_tree(
        '{"topic": "Raiz", "children": [{"topic": "Filho"}]}',
        max_depth=3, max_breadth=5,
    )
    assert tree["topic"] == "Raiz"
    assert tree["children"][0]["topic"] == "Filho"


def test_parse_com_cerca_de_codigo_e_texto_em_volta():
    content = 'Claro! Aqui está:\n```json\n{"topic": "A", "children": []}\n```\nQualquer coisa.'
    tree = parse_generated_tree(content, max_depth=3, max_breadth=5)
    assert tree["topic"] == "A"


def test_parse_primeiro_objeto_balanceado_ignorando_chaves_em_strings():
    content = '{"topic": "a { b", "children": []} e texto depois'
    tree = parse_generated_tree(content, max_depth=3, max_breadth=5)
    assert tree["topic"] == "a { b"


def test_parse_respeita_profundidade_e_largura():
    import json
    deep = {"topic": "r", "children": [
        {"topic": f"f{i}", "children": [{"topic": "neto", "children": [{"topic": "bisneto"}]}]}
        for i in range(9)
    ]}
    tree = parse_generated_tree(json.dumps(deep), max_depth=2, max_breadth=3)
    assert len(tree["children"]) == 3            # largura cortada em 3
    # profundidade 2: filhos e netos existem; o corte acontece nos BISNETOS
    assert tree["children"][0]["children"][0]["topic"] == "neto"
    assert tree["children"][0]["children"][0]["children"] == []


def test_parse_excede_teto_de_nos():
    import json
    # largura alta o bastante para o contador passar do teto antes do corte
    big = {"topic": "r", "children": [{"topic": f"n{i}"} for i in range(50)]}
    try:
        parse_generated_tree(json.dumps(big), max_depth=3, max_breadth=60, max_nodes=40)
        raise AssertionError("deveria ter falhado")
    except GenerationParseError as exc:
        assert "40" in str(exc)


def test_parse_vazio_e_sem_topico():
    try:
        parse_generated_tree("", max_depth=3, max_breadth=5)
        raise AssertionError("deveria ter falhado")
    except GenerationParseError:
        pass
    try:
        parse_generated_tree('{"children": []}', max_depth=3, max_breadth=5)
        raise AssertionError("deveria ter falhado")
    except GenerationParseError as exc:
        assert "topic" in str(exc)


def test_prompt_menciona_limites():
    prompt = build_generation_prompt("Fotossíntese", depth=2, breadth=4)
    assert "Fotossíntese" in prompt
    assert "2" in prompt and "4" in prompt


# --- Endpoint (respeita a cadeia; teste com o Ollama mockado) ---

@respx.mock
async def test_generate_sucesso_com_cadeia_local(client):
    respx.post("http://localhost:11434/api/generate").mock(
        return_value=Response(200, json={
            "response": '```json\n{"topic": "Raiz", "children": [{"topic": "F1"}]}\n```',
        })
    )
    resp = await client.post("/api/v1/ai/generate", json={"topic": "Horta", "depth": 2, "breadth": 3})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Horta"
    assert body["tree"]["children"][0]["topic"] == "F1"
    assert body["provider_used"]


async def test_generate_topico_vazio_400(client):
    resp = await client.post("/api/v1/ai/generate", json={"topic": "   "})
    assert resp.status_code == 400


@respx.mock
async def test_generate_cadeia_caida_503_com_trilha(client, monkeypatch):
    from app.services import chain_executor

    monkeypatch.setattr(chain_executor, "build_chain", lambda preferred=None: ["ollama"])
    respx.post("http://localhost:11434/api/generate").side_effect = ConnectError("recusado")
    resp = await client.post("/api/v1/ai/generate", json={"topic": "Horta"})
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["error_code"] == "ALL_PROVIDERS_FAILED"
    assert detail["fallback_trail"]


@respx.mock
async def test_generate_parse_garbage_consome_retry_e_falha_estruturada(client, monkeypatch):
    """JSON inválido duas vezes no mesmo provedor -> trilha com o parse falho."""
    from app.services import chain_executor

    monkeypatch.setattr(chain_executor, "build_chain", lambda preferred=None: ["ollama"])
    respx.post("http://localhost:11434/api/generate").mock(
        return_value=Response(200, json={"response": "desculpe, não sei responder isso"})
    )
    resp = await client.post("/api/v1/ai/generate", json={"topic": "Horta"})
    assert resp.status_code == 503
    trail = resp.json()["detail"]["fallback_trail"]
    assert any(t.get("kind") == "GENERATION_PARSE_FAILED" for t in trail)
    # 2 tentativas no mesmo provedor (1 + retry de parse)
    assert sum(1 for t in trail if t.get("kind") == "GENERATION_PARSE_FAILED") == 2
