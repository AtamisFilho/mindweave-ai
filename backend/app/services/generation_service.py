"""Geração de mapa a partir de um tópico (v0.4.5 B3).

Schema recursivo do LLM: {"topic": str, "children": [...]}.
Parser robusto (cercas, texto em volta, primeiro bloco balanceado) + 1 retry
no MESMO provedor; falha de novo -> GenerationParseError (o caller cai para
o próximo da cadeia). Limites impostos no backend: profundidade, largura e
teto de nós. NÃO-DESTRUTIVO por construção: o mapa novo é criado à parte.
"""
import json
import re
from typing import Any

MAX_NODES = 40
MAX_DEPTH_CAP = 3
_MAX_BREADTH_CAP = 5

_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


class GenerationParseError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def build_generation_prompt(topic: str, depth: int, breadth: int, max_nodes: int = MAX_NODES) -> str:
    return (
        f"Você é um gerador de mapas mentais. Gere um mapa mental sobre: '{topic}'.\n"
        f"Regras: profundidade máxima {depth}; até {breadth} filhos por nó; "
        f"total máximo de {max_nodes} nós.\n"
        'Responda SOMENTE com JSON válido no formato '
        '{"topic": "<tópico central>", "children": [{"topic": "<subtópico>", "children": []}]} '
        "— sem texto fora do JSON, sem cercas de código, sem explicações."
    )


def _extract_first_json(text: str) -> dict:
    """Extrai o primeiro objeto {...} balanceado do texto (ignora strings)."""
    fenced = _FENCE_RE.search(text)
    if fenced:
        text = fenced.group(1)
    start = text.find("{")
    if start == -1:
        raise GenerationParseError("Nenhum objeto JSON encontrado na resposta.")
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start:i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError as exc:
                    raise GenerationParseError(f"JSON inválido: {exc}") from exc
    raise GenerationParseError("JSON não fechado na resposta.")


def normalize_tree(node: Any, depth: int, max_depth: int, max_breadth: int,
                   counter: dict, max_nodes: int) -> dict:
    """Normaliza e limita a árvore: profundidade, largura e teto de nós."""
    if not isinstance(node, dict):
        raise GenerationParseError("Nó do mapa não é um objeto.")
    topic = node.get("topic") or node.get("name") or node.get("label")
    if not isinstance(topic, str) or not topic.strip():
        raise GenerationParseError("Nó sem campo 'topic' (texto).")
    counter["n"] += 1
    if counter["n"] > max_nodes:
        raise GenerationParseError(f"Mapa excede {max_nodes} nós.")
    result = {"topic": topic.strip()[:200]}
    if depth >= max_depth:
        result["children"] = []
        return result
    raw_children = node.get("children") or []
    if not isinstance(raw_children, list):
        raw_children = []
    children = [
        normalize_tree(child, depth + 1, max_depth, max_breadth, counter, max_nodes)
        for child in raw_children[:max_breadth]
        if isinstance(child, dict)
    ]
    result["children"] = children
    return result


def parse_generated_tree(content: str, *, max_depth: int, max_breadth: int,
                         max_nodes: int = MAX_NODES) -> dict:
    text = (content or "").strip()
    if not text:
        raise GenerationParseError("Resposta vazia do provedor.")
    obj = _extract_first_json(text)
    if not isinstance(obj, dict):
        raise GenerationParseError("Resposta não é um objeto JSON.")
    counter = {"n": 0}
    return normalize_tree(obj, 0, max_depth, max_breadth, counter, max_nodes)
