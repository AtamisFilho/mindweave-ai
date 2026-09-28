"""Serviço de IA (v0.4 slim): construção de prompts e gerência de chaves.

As CHAMADAS aos provedores migraram para os adapters (app/providers/*)
orquestrados pelo chain_executor. Este módulo mantém o que é compartilhado:
contexto ancestral, prompts e o gerenciamento em memória das chaves
(compatibilidade v0.3 — a fonte canônica é a tabela api_keys, v0.4 B0).
"""
import os

from app.models.ai_models import NodeContext

# --- Gerenciamento de API Keys (Simples - NÃO PARA PRODUÇÃO REAL) ---
# Fonte canônica na v0.4: tabela api_keys (criptografada). Estes globais
# permanecem como fallback de compatibilidade da v0.3.
_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
_GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")


def set_openai_api_key(key: str):
    global _OPENAI_API_KEY
    _OPENAI_API_KEY = key


def set_google_api_key(key: str):
    global _GOOGLE_API_KEY
    _GOOGLE_API_KEY = key


def get_openai_key() -> str | None:
    return _OPENAI_API_KEY


def get_google_key() -> str | None:
    return _GOOGLE_API_KEY


def is_openai_key_set() -> bool:
    return bool(_OPENAI_API_KEY)


def is_google_key_set() -> bool:
    return bool(_GOOGLE_API_KEY)
# --- Fim do Gerenciamento de API Keys ---


def get_ancestor_context_string(ancestorContext: list[NodeContext]) -> str:
    """Recebe os ancestrais ordenados do mais próximo ao mais amplo (o frontend
    já faz o BFS sobre o grafo e envia a lista pronta, sem duplicatas)."""
    if not ancestorContext:
        return ""
    return "; ".join(ctx.content for ctx in ancestorContext)


def build_research_prompt(node_content: str, ancestor_str: str) -> str:
    context_narrative = (
        f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}."
        if ancestor_str else "Este é um nó raiz."
    )
    return (
        f"Você é um assistente de pesquisa especializado. Por favor, realize uma pesquisa aprofundada sobre o seguinte tópico: '{node_content}'.\n"
        f"{context_narrative}\n"
        "O objetivo é obter um resumo conciso e informativo sobre este tópico, levando em conta sua posição na hierarquia do mapa mental. "
        "Não mencione os nós pais explicitamente na sua resposta, mas use-os para entender o sub-tópico em questão.\n"
        "Resumo da pesquisa:"
    )


def build_suggest_prompt(node_content: str, ancestor_str: str) -> str:
    context_narrative = (
        f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}."
        if ancestor_str else "Este é um nó raiz."
    )
    return (
        f"Você é um assistente de brainstorming para mapas mentais. O nó atual é '{node_content}'.\n"
        f"{context_narrative}\n"
        "Com base neste nó e seu contexto, sugira até 3-5 novos sub-nós ou nós relacionados que poderiam expandir este mapa mental. "
        "Liste cada sugestão em uma nova linha, sem marcadores ou numeração. Apenas o texto da sugestão.\n"
        "Exemplo de formato de resposta:\n"
        "Sugestão 1\n"
        "Sugestão 2\n"
        "Sugestão 3\n"
        "Sugestões:"
    )


def parse_suggestions(raw: str) -> list[str]:
    """Uma sugestão por linha; linhas vazias ignoradas."""
    return [line.strip() for line in raw.split("\n") if line.strip()]
