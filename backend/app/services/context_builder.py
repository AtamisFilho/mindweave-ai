"""Montagem do contexto de IA a partir do mapa (v0.4.5 — RAG com FTS5).

Duas estratégias sob um orçamento fixo (MAX_CONTEXT_CHARS):
- outline: travessia raiz→folhas em Markdown indentado (mapa pequeno).
- retrieval: termos da pergunta -> FTS5 top-K por bm25() + caminho ancestral
  + filhos diretos de cada nó recuperado (vizinhança importa tanto quanto
  o nó). Sem vector DB — FTS5 é o retriever.

Transparência (context_meta): strategy/nodes_included/chars/focus — o
frontend mostra ao usuário o que entrou no prompt. RAG sem transparência
é caixa-preta.

Sanitização FTS5: cada termo entra como frase aspada + prefixo
('"termo"*') — OR/AND/aspas/parênteses da pergunta nunca quebram o MATCH.
"""
import re

from app.core.config import settings
from app.db import SessionLocal
from app.models_db import MapRow

# Stopwords curtas pt/en: não buscam nada e poluem o MATCH
_STOPWORDS = {
    "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "em",
    "no", "na", "nos", "nas", "um", "uma", "que", "qual", "quais", "como",
    "para", "por", "com", "sem", "sobre", "the", "of", "and", "or", "in",
    "on", "to", "is", "what", "which", "how", "for", "with", "about",
}

_WORD_RE = re.compile(r"[a-zA-Z0-9áàâãéêíóôõúüçñÁÀÂÃÉÊÍÓÔÕÚÜÇÑ]+")


def sanitize_query(question: str) -> str:
    """Pergunta -> expressão FTS5 segura: '"t1"* OR "t2"* OR ...'.

    Cada termo é frase aspada (aspas internas impossíveis — o regex só
    captura palavras) e com prefixo. Operadores/aspas/parênteses da
    pergunta são ignorados como tokens.
    """
    words = _WORD_RE.findall(question or "")
    terms = []
    for word in words:
        low = word.lower()
        if low in _STOPWORDS or len(low) < 3:
            continue
        # dobra aspas internas por segurança extra (regex já impede, mas o
        # invariant fica explícito aqui)
        escaped = low.replace('"', '""')
        if escaped and escaped not in terms:
            terms.append(escaped)
    if not terms:
        return ""
    return " OR ".join(f'"{t}"*' for t in terms[:12])


def _children_map(nodes: list[dict], edges: list[dict]) -> dict[str, list[str]]:
    children: dict[str, list[str]] = {}
    target_seen = {e["target"] for e in edges}
    for edge in edges:
        children.setdefault(edge["source"], []).append(edge["target"])
    _ = target_seen
    return children


def _label_of(nodes_by_id: dict[str, dict], node_id: str) -> str:
    node = nodes_by_id.get(node_id)
    return (node.get("data", {}).get("label") if node else None) or "(sem rótulo)"


def _roots(nodes: list[dict], edges: list[dict]) -> list[str]:
    targets = {e["target"] for e in edges}
    roots = [n["id"] for n in nodes if n["id"] not in targets]
    return roots or ([nodes[0]["id"]] if nodes else [])


def _outline(nodes: list[dict], edges: list[dict], budget: int) -> tuple[str, int, bool]:
    """Travessia raiz→folhas em Markdown indentado.

    Retorna (texto, nós incluídos, completo) — completo=False quando o
    orçamento não comportou o mapa inteiro. Truncar sem avisar escondia
    mapas grandes (bug pego pelo teste de 500 nós).
    """
    children = _children_map(nodes, edges)
    nodes_by_id = {n["id"]: n for n in nodes}
    lines: list[str] = []
    used = 0
    included = 0
    overflowed = False

    def visit(node_id: str, depth: int):
        nonlocal used, included, overflowed
        if depth > 12:
            return
        label = _label_of(nodes_by_id, node_id)
        line = "  " * depth + f"- {label}"
        if used + len(line) + 1 > budget:
            overflowed = True
            return
        lines.append(line)
        used += len(line) + 1
        included += 1
        for child in children.get(node_id, []):
            visit(child, depth + 1)

    for root in _roots(nodes, edges):
        visit(root, 0)
    # completo = TODOS os nós entraram (estouro de orçamento OU teto de
    # profundidade deixou nós de fora — ambos escondiam mapas grandes)
    complete = (included == len(nodes)) and not overflowed
    return "\n".join(lines), included, complete


def _ancestors(node_id: str, edges: list[dict]) -> list[str]:
    """Cadeia ancestral (mais próximo -> raiz) via parentId/arestas."""
    parent_of = {}
    for edge in edges:
        # primeira aresta entrante vira o pai (grafo é DAG; o cache
        # parentId do frontend segue a mesma regra do primeiro alcance)
        parent_of.setdefault(edge["target"], edge["source"])
    chain: list[str] = []
    seen = {node_id}
    current = parent_of.get(node_id)
    while current and current not in seen:
        chain.append(current)
        seen.add(current)
        current = parent_of.get(current)
    return chain


def _retrieval(
    nodes: list[dict],
    edges: list[dict],
    question: str,
    map_id: str | None,
    budget: int,
) -> tuple[str, int]:
    """FTS5 top-12 por bm25 + ancestrais + filhos diretos, dedup, no orçamento."""
    from sqlalchemy import text as sql_text

    match = sanitize_query(question)
    nodes_by_id = {n["id"]: n for n in nodes}
    children = _children_map(nodes, edges)

    hits: list[str] = []
    if match and map_id:
        with SessionLocal() as session:
            rows = session.execute(
                sql_text(
                    "SELECT node_id FROM node_index "
                    "WHERE node_index MATCH :q AND map_id = :m "
                    "ORDER BY bm25(node_index) LIMIT 12"
                ),
                {"q": match, "m": map_id},
            ).fetchall()
            hits = [r[0] for r in rows]

    if not hits:
        # degradação elegante: zero hits -> outline truncado (o que existe)
        outline, included, _complete = _outline(nodes, edges, budget)
        return outline, included

    # vizinhança por hit, ORDEM DE RELEVÂNCIA: o hit primeiro (bm25), depois
    # filhos diretos, depois ancestrais nearest-first com teto — em cadeias
    # profundas os ancestrais completos inundariam o orçamento e o próprio
    # hit ficaria de fora (bug pego pelo teste de 500 nós em cadeia).
    _MAX_ANCESTORS_PER_HIT = 8

    ordered: list[str] = []
    seen: set[str] = set()

    def add(node_id: str) -> None:
        if node_id in nodes_by_id and node_id not in seen:
            seen.add(node_id)
            ordered.append(node_id)

    for hit in hits:
        add(hit)
        for child in children.get(hit, []):
            add(child)
        for ancestor in _ancestors(hit, edges)[:_MAX_ANCESTORS_PER_HIT]:
            add(ancestor)

    lines: list[str] = []
    used = 0
    included = 0
    for node_id in ordered:
        label = _label_of(nodes_by_id, node_id)
        line = f"- {label}"
        if used + len(line) + 1 > budget:
            break
        lines.append(line)
        used += len(line) + 1
        included += 1
    return "\n".join(lines), included


def build_chat_context(
    document: dict,
    question: str,
    map_id: str | None = None,
    focus_node_id: str | None = None,
) -> tuple[str, dict]:
    """Monta o contexto do chat. Retorna (contexto, context_meta).

    Estratégia: outline quando cabe no orçamento; senão retrieval FTS5.
    focus_node_id ancora a subárvore+ancestrais no topo do contexto.
    """
    budget = settings.MAX_CONTEXT_CHARS
    nodes: list[dict] = document.get("nodes", [])
    edges: list[dict] = document.get("edges", [])
    nodes_by_id = {n["id"]: n for n in nodes}

    focus_block = ""
    focus_meta = None
    if focus_node_id and focus_node_id in nodes_by_id:
        children = _children_map(nodes, edges)
        focus_meta = focus_node_id
        chain = [focus_node_id]
        seen = {focus_node_id}
        # subárvore do foco (BFS, teto de profundidade 3)
        frontier = [focus_node_id]
        for _ in range(3):
            nxt = []
            for nid in frontier:
                for child in children.get(nid, []):
                    if child not in seen:
                        seen.add(child)
                        chain.append(child)
                        nxt.append(child)
            frontier = nxt
        # ancestrais do foco (mais próximo -> raiz) entram antes
        ancestors = _ancestors(focus_node_id, edges)
        ordered_focus = list(reversed(ancestors)) + chain
        lines = [f"- {_label_of(nodes_by_id, nid)}" for nid in ordered_focus if nid in nodes_by_id]
        focus_block = "Foco da conversa (nó selecionado e vizinhança):\n" + "\n".join(lines)

    outline, outline_included, outline_complete = _outline(nodes, edges, budget)

    if outline_complete:
        context = (
            (focus_block + "\n\n" if focus_block else "")
            + "Estrutura do mapa:\n" + outline
        )
        meta = {
            "strategy": "outline",
            "nodes_included": outline_included + (len(ordered_focus) if focus_meta else 0),
            "chars": len(context),
            "focus": focus_meta,
        }
        return context, meta

    # mapa grande: retrieval (o foco já consumiu parte do orçamento)
    remaining = budget - len(focus_block)
    context_str, included = _retrieval(nodes, edges, question, map_id, remaining)
    context = (
        (focus_block + "\n\n" if focus_block else "")
        + "Nós do mapa relevantes à pergunta:\n" + context_str
    )
    meta = {
        "strategy": "retrieval",
        "nodes_included": included + (len(ordered_focus) if focus_meta else 0),
        "chars": len(context),
        "focus": focus_meta,
    }
    return context, meta


def get_document_for_map(map_id: str | None) -> dict | None:
    if not map_id:
        return None
    import json as _json

    with SessionLocal() as session:
        row = session.get(MapRow, map_id)
        if not row:
            return None
        return _json.loads(row.document)
