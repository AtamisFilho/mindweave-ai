"""Testes do chain executor: rotação, cooldowns e trilha de fallbacks.

Cenário da proposta do produto: Groq (rate limit) -> Gemini (sucesso),
e o "todos falharam" com trilha completa.
"""
import httpx
import pytest
import respx

from app.core.errors import AIProviderError
from app.services import chain_executor, keys_service

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"
LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"
OLLAMA_URL = "http://localhost:11434/api/generate"


def ok_openai(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def ok_gemini(content):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": content}]}}]})


def ok_ollama(content):
    return httpx.Response(200, json={"response": content})


@pytest.fixture(autouse=True)
def _reset_state():
    chain_executor.reset_cooldowns()
    yield
    chain_executor.reset_cooldowns()


@pytest.fixture
def com_chaves():
    keys_service.set_key("groq", "sk-groq")
    keys_service.set_key("gemini", "sk-gemini")


@respx.mock
async def test_primeiro_provedor_falha_segundo_succeede(com_chaves, respx_mock):
    respx_mock.post(GROQ_URL).mock(return_value=httpx.Response(
        429, json={"error": {"message": "per minute"}}))
    respx_mock.post(GEMINI_URL).mock(return_value=ok_gemini("do gemini"))

    result = await chain_executor.execute_chain("prompt")

    assert result["provider"] == "gemini"
    assert result["content"] == "do gemini"
    assert result["trail"][0]["provider"] == "Groq"
    assert result["trail"][0]["kind"] == "RATE_LIMIT"


@respx.mock
async def test_todos_falham_levanta_com_trilha(com_chaves, respx_mock):
    respx_mock.post(GROQ_URL).mock(return_value=httpx.Response(
        429, json={"error": {"message": "per minute"}}))
    respx_mock.post(GEMINI_URL).mock(return_value=httpx.Response(
        429, json={"error": {"message": "Requests per day exceeded"}}))
    respx_mock.post(LMSTUDIO_URL).side_effect = httpx.ConnectError("lm studio fora")
    respx_mock.post(OLLAMA_URL).side_effect = httpx.ConnectError("ollama fora")

    with pytest.raises(AIProviderError) as exc:
        await chain_executor.execute_chain("prompt")

    kinds = [t["kind"] for t in exc.value.trail]
    assert kinds == ["RATE_LIMIT", "QUOTA_EXHAUSTED", "NETWORK_ERROR", "NETWORK_ERROR"]


@respx.mock
async def test_cooldown_pula_provedor_na_proxima_request(com_chaves, respx_mock):
    groq_route = respx_mock.post(GROQ_URL).mock(return_value=httpx.Response(
        429, json={"error": {"message": "per minute"}}))
    respx_mock.post(GEMINI_URL).mock(return_value=ok_gemini("gemini 1"))
    respx_mock.post(LMSTUDIO_URL).mock(return_value=ok_openai("lm 2"))
    respx_mock.post(OLLAMA_URL).mock(return_value=ok_ollama("ollama 2"))

    # 1ª execução: groq falha (429), gemini responde
    await chain_executor.execute_chain("prompt")
    calls_apos_primeira = groq_route.call_count

    # 2ª execução: groq está em cooldown -> NEM É CHAMADO
    result = await chain_executor.execute_chain("prompt")
    assert result["provider"] == "gemini"
    assert groq_route.call_count == calls_apos_primeira  # não cresceu


@respx.mock
async def test_build_chain_preferred_primeiro_e_locais_ultimo(com_chaves, respx_mock):
    respx_mock.post(GROQ_URL).mock(return_value=ok_openai("x"))
    respx_mock.post(GEMINI_URL).mock(return_value=ok_gemini("x"))
    respx_mock.post(LMSTUDIO_URL).mock(return_value=ok_openai("x"))
    respx_mock.post(OLLAMA_URL).mock(return_value=ok_ollama("x"))

    chain = chain_executor.build_chain(preferred="gemini")
    assert chain[0] == "gemini"
    assert chain[-1] in ("ollama", "lmstudio")  # locais no fim
    assert set(["groq", "gemini", "lmstudio", "ollama"]).issubset(set(chain))


def test_cadeia_nunca_vazia_locais_sao_soberanos():
    # sem NENHUMA chave configurada, os locais mantêm a cadeia viva
    chain = chain_executor.build_chain(None)
    assert "ollama" in chain
    assert "lmstudio" in chain


def test_cooldowns_resetam():
    chain_executor._COOLDOWNS["groq"] = chain_executor._now() + 999
    chain_executor.reset_cooldowns()
    assert chain_executor.provider_in_cooldown("groq") is False
