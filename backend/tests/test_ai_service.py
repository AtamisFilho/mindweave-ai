"""Testes dos serviços de IA: mapeamento de erros, parsing e contexto no prompt.

respx intercepta o httpx globalmente — nenhuma chamada real sai da suíte.
"""
import pytest
import respx
from httpx import ConnectError, ReadTimeout, Response

from app.core.errors import AIProviderError, ErrorCode
from app.models.ai_models import (
    AIResearchRequest,
    AISuggestedNode,
    AISuggestNodesRequest,
    NodeContext,
    OllamaConfig,
)
from app.services import ai_service

OLLAMA_URL = "http://localhost:11434/api/generate"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent"

RESEARCH = AIResearchRequest(nodeId="n1", nodeContent="Tópico")
SUGGEST = AISuggestNodesRequest(nodeId="n1", nodeContent="Tópico")
CFG = OllamaConfig(baseUrl="http://localhost:11434", model="llama3")

GEMINI_MODEL = "gemini-test"


def ctx(*contents):
    return [NodeContext(id=f"p{i}", content=c) for i, c in enumerate(contents)]


# --- Contexto hierárquico no prompt (invariante do Bloco 1) ---

@respx.mock
async def test_prompt_inclui_contexto_ancestral():
    route = respx.post(OLLAMA_URL).mock(return_value=Response(200, json={"response": "ok"}))
    request = AIResearchRequest(
        nodeId="n1",
        nodeContent="ML",
        ancestorContext=ctx("Ciência da Computação", "Estatística"),
    )
    await ai_service.perform_deep_research_ollama(request, CFG)
    body = route.calls.last.request.read().decode()
    assert "Ciência da Computação; Estatística" in body  # ordem pais-first


# --- Ollama ---

@respx.mock
async def test_ollama_sucesso():
    respx.post(OLLAMA_URL).mock(return_value=Response(200, json={"response": "  resumo  "}))
    result = await ai_service.perform_deep_research_ollama(RESEARCH, CFG)
    assert result == "resumo"


@respx.mock
async def test_ollama_inacessivel_503():
    respx.post(OLLAMA_URL).side_effect = ConnectError("connection refused")
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_ollama(RESEARCH, CFG)
    assert exc.value.code == ErrorCode.PROVIDER_UNREACHABLE
    assert exc.value.status_code == 503


@respx.mock
async def test_ollama_timeout_504():
    respx.post(OLLAMA_URL).side_effect = ReadTimeout("demorou")
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_ollama(RESEARCH, CFG)
    assert exc.value.code == ErrorCode.PROVIDER_TIMEOUT
    assert exc.value.status_code == 504


@respx.mock
async def test_ollama_modelo_inexistente_404():
    respx.post(OLLAMA_URL).mock(return_value=Response(404, json={"error": "model not found"}))
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_ollama(RESEARCH, CFG)
    assert exc.value.code == ErrorCode.MODEL_NOT_FOUND


@respx.mock
async def test_ollama_sugestoes_parseadas():
    respx.post(OLLAMA_URL).mock(
        return_value=Response(200, json={"response": "Ideia A\nIdeia B\n\n  \nIdeia C"})
    )
    result = await ai_service.suggest_new_nodes_ollama(SUGGEST, CFG)
    assert [n.content for n in result] == ["Ideia A", "Ideia B", "Ideia C"]


@respx.mock
async def test_ollama_sugestoes_vazias():
    respx.post(OLLAMA_URL).mock(return_value=Response(200, json={"response": "  \n  "}))
    result = await ai_service.suggest_new_nodes_ollama(SUGGEST, CFG)
    assert result == [AISuggestedNode(content="Nenhuma sugestão gerada.")]


# --- OpenAI ---

def _openai_ok(content="conteúdo"):
    return Response(200, json={"choices": [{"message": {"content": content}}]})


@respx.mock
async def test_openai_401_vira_invalid_key():
    respx.post(OPENAI_URL).mock(return_value=Response(401, json={"error": {"message": "Incorrect API key provided."}}))
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_openai(RESEARCH, "sk-chave")
    assert exc.value.code == ErrorCode.PROVIDER_INVALID_KEY
    assert exc.value.status_code == 502


@respx.mock
async def test_openai_429_vira_rate_limit():
    respx.post(OPENAI_URL).mock(return_value=Response(429, json={"error": {}}))
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_openai(RESEARCH, "sk-chave")
    assert exc.value.code == ErrorCode.RATE_LIMIT_EXCEEDED
    assert exc.value.status_code == 429


@respx.mock
async def test_openai_404_vira_model_not_found():
    respx.post(OPENAI_URL).mock(return_value=Response(404, json={"error": {}}))
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_openai(RESEARCH, "sk-chave")
    assert exc.value.code == ErrorCode.MODEL_NOT_FOUND


@respx.mock
async def test_openai_sem_chave_400():
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_openai(RESEARCH, None)
    assert exc.value.code == ErrorCode.KEY_NOT_CONFIGURED
    assert exc.value.status_code == 400


@respx.mock
async def test_openai_sucesso():
    respx.post(OPENAI_URL).mock(return_value=_openai_ok("resumo gpt"))
    result = await ai_service.perform_deep_research_openai(RESEARCH, "sk-chave")
    assert result == "resumo gpt"


# --- Gemini ---

def _gemini_ok(text="resumo gemini"):
    return Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


@respx.mock
async def test_gemini_400_api_key_vira_invalid_key():
    # Pegadinha do Bloco 2: Gemini responde chave inválida com 400 (não 401)
    respx.post(GEMINI_URL).mock(
        return_value=Response(400, json={"error": {"message": "API key not valid. Please pass a valid API key."}})
    )
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_google(
            AIResearchRequest(nodeId="n1", nodeContent="T", model_name=GEMINI_MODEL), "chave-ruim"
        )
    assert exc.value.code == ErrorCode.PROVIDER_INVALID_KEY


@respx.mock
async def test_gemini_chave_vai_no_header_nao_na_url():
    route = respx.post(GEMINI_URL).mock(return_value=_gemini_ok())
    await ai_service.perform_deep_research_google(
        AIResearchRequest(nodeId="n1", nodeContent="T", model_name=GEMINI_MODEL), "chave-secreta-123"
    )
    request = route.calls.last.request
    assert "chave-secreta-123" not in str(request.url)  # nunca na query string
    assert request.headers["x-goog-api-key"] == "chave-secreta-123"


@respx.mock
async def test_gemini_sucesso():
    respx.post(GEMINI_URL).mock(return_value=_gemini_ok("texto"))
    result = await ai_service.perform_deep_research_google(
        AIResearchRequest(nodeId="n1", nodeContent="T", model_name=GEMINI_MODEL), "chave"
    )
    assert result == "texto"


@respx.mock
async def test_gemini_formato_inesperado_502():
    respx.post(GEMINI_URL).mock(return_value=Response(200, json={"candidates": []}))
    with pytest.raises(AIProviderError) as exc:
        await ai_service.perform_deep_research_google(
            AIResearchRequest(nodeId="n1", nodeContent="T", model_name=GEMINI_MODEL), "chave"
        )
    assert exc.value.code == ErrorCode.PROVIDER_REQUEST_FAILED
    assert exc.value.status_code == 502
