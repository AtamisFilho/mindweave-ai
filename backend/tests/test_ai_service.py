"""Testes do ai_service (v0.4 slim): prompts, parsing e contexto.

As chamadas aos provedores (classificação, quota, header) são cobertas por
tests/test_providers.py — os adapters substituíram as funções antigas.
"""
from app.models.ai_models import NodeContext
from app.services.ai_service import (
    build_research_prompt,
    build_suggest_prompt,
    get_ancestor_context_string,
    parse_suggestions,
)


def ctx(*contents):
    return [NodeContext(id=f"p{i}", content=c) for i, c in enumerate(contents)]


def test_contexto_ancestral_vazio():
    assert get_ancestor_context_string([]) == ""


def test_contexto_ancestral_pais_first():
    s = get_ancestor_context_string(ctx("Pai", "Avó", "Raiz"))
    assert s == "Pai; Avó; Raiz"


def test_prompt_research_inclui_contexto_e_topico():
    prompt = build_research_prompt("Machine Learning", "Ciência da Computação; Estatística")
    assert "'Machine Learning'" in prompt
    assert "Ciência da Computação; Estatística" in prompt
    assert "do mais próximo ao mais amplo" in prompt


def test_prompt_research_raiz_sem_contexto():
    prompt = build_research_prompt("Tópico", "")
    assert "Este é um nó raiz" in prompt  # narrativa explícita para a raiz
    assert "Contexto hierárquico" not in prompt
    assert "Tópico" in prompt


def test_prompt_suggest_inclui_contexto():
    prompt = build_suggest_prompt("ML", "Ciência da Computação")
    assert "'ML'" in prompt
    assert "Ciência da Computação" in prompt
    assert "3-5 novos sub-nós" in prompt


def test_parse_suggestions_uma_por_linha():
    raw = "Ideia A\nIdeia B\n\n   \nIdeia C"
    assert parse_suggestions(raw) == ["Ideia A", "Ideia B", "Ideia C"]


def test_parse_suggestions_vazio():
    assert parse_suggestions("  \n  ") == []
