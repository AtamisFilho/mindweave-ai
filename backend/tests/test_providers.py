"""Testes dos adapters de provedor (respx — zero rede real)."""
import httpx
import pytest
import respx

import app.providers.base as base
from app.providers import PROVIDERS

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent"
OLLAMA_URL = "http://localhost:11434/api/generate"
LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"

groq = PROVIDERS["groq"]
gemini = PROVIDERS["gemini"]
ollama = PROVIDERS["ollama"]
lmstudio = PROVIDERS["lmstudio"]
openrouter = PROVIDERS["openrouter"]

prov_error = base.ProviderCallError


def ok_openai(content="resposta"):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


# --- sucesso ---

@respx.mock
async def test_groq_sucesso():
    respx.post(GROQ_URL).mock(return_value=ok_openai("olá do groq"))
    assert await groq.complete("prompt", "llama-3.3-70b-versatile", "chave") == "olá do groq"


@respx.mock
async def test_gemini_sucesso_parseia_candidates():
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": "olá do gemini"}]}}]},
    ))
    assert await gemini.complete("prompt", "gemini-test", "chave") == "olá do gemini"


@respx.mock
async def test_lmstudio_sem_chave_usa_placeholder():
    route = respx.post(LMSTUDIO_URL).mock(return_value=ok_openai("local!"))
    await lmstudio.complete("prompt", "local-model", None)
    assert route.calls.last.request.headers["authorization"] == "Bearer lm-studio"


# --- classificação de erros (Diretriz 2 do B1) ---

@respx.mock
async def test_groq_429_por_minuto_vira_rate_limit():
    respx.post(GROQ_URL).mock(return_value=httpx.Response(
        429, json={"error": {"message": "Rate limit reached for model per minute"}}))
    with pytest.raises(prov_error) as exc:
        await groq.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "RATE_LIMIT"


@respx.mock
async def test_groq_429_cota_diaria_vira_quota_exhausted():
    respx.post(GROQ_URL).mock(return_value=httpx.Response(
        429, json={"error": {"message": "Rate limit reached: tokens per day (limit 14400)"}}))
    with pytest.raises(prov_error) as exc:
        await groq.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "QUOTA_EXHAUSTED"


@respx.mock
async def test_openrouter_402_vira_quota_exhausted():
    respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=httpx.Response(402, json={"error": "insufficient credits"}))
    with pytest.raises(prov_error) as exc:
        await openrouter.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "QUOTA_EXHAUSTED"


@respx.mock
async def test_groq_401_vira_invalid_key():
    respx.post(GROQ_URL).mock(return_value=httpx.Response(401, json={"error": {}}))
    with pytest.raises(prov_error) as exc:
        await groq.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "INVALID_KEY"


@respx.mock
async def test_groq_404_vira_model_not_found():
    respx.post(GROQ_URL).mock(return_value=httpx.Response(404, json={"error": {}}))
    with pytest.raises(prov_error) as exc:
        await groq.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "MODEL_NOT_FOUND"


@respx.mock
async def test_contexto_estourado_vira_context_too_large():
    respx.post(GROQ_URL).mock(return_value=httpx.Response(
        400, json={"error": {"message": "maximum context length exceeded"}}))
    with pytest.raises(prov_error) as exc:
        await groq.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "CONTEXT_TOO_LARGE"


@respx.mock
async def test_500_vira_provider_error():
    respx.post(GROQ_URL).mock(return_value=httpx.Response(500, text="boom"))
    with pytest.raises(prov_error) as exc:
        await groq.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "PROVIDER_ERROR"


@respx.mock
async def test_conexao_recusada_vira_network_error():
    respx.post(GROQ_URL).side_effect = httpx.ConnectError("recusado")
    with pytest.raises(prov_error) as exc:
        await groq.complete("prompt", "m", "chave")
    assert exc.value.kind.value == "NETWORK_ERROR"


# --- Gemini nativo ---

@respx.mock
async def test_gemini_400_api_key_vira_invalid_key():
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(
        400, json={"error": {"message": "API key not valid. Please pass a valid API key."}}))
    with pytest.raises(prov_error) as exc:
        await gemini.complete("prompt", "gemini-test", "chave-ruim")
    assert exc.value.kind.value == "INVALID_KEY"


@respx.mock
async def test_gemini_429_per_day_vira_quota_exhausted():
    respx.post(GEMINI_URL).mock(return_value=httpx.Response(
        429, json={"error": {"status": "RESOURCE_EXHAUSTED", "message": "Requests per day exceeded"}}))
    with pytest.raises(prov_error) as exc:
        await gemini.complete("prompt", "gemini-test", "chave")
    assert exc.value.kind.value == "QUOTA_EXHAUSTED"


@respx.mock
async def test_gemini_chave_vai_no_header():
    route = respx.post(GEMINI_URL).mock(return_value=httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": "x"}]}}]},
    ))
    await gemini.complete("prompt", "gemini-test", "chave-segura")
    request = route.calls.last.request
    assert "chave-segura" not in str(request.url)
    assert request.headers["x-goog-api-key"] == "chave-segura"


# --- Ollama ---

@respx.mock
async def test_ollama_404_modelo_inexistente():
    respx.post(OLLAMA_URL).mock(return_value=httpx.Response(404, json={"error": "model not found"}))
    with pytest.raises(prov_error) as exc:
        await ollama.complete("prompt", "nao-existe", None)
    assert exc.value.kind.value == "MODEL_NOT_FOUND"


# --- streaming (v0.4.5): interface pronta desde a v0.4; adapter sem
# supports_stream mantém o stub NotImplementedError ---

async def test_adapter_sem_stream_levanta_not_implemented():
    # stub local: a BASE mantém o stub; todos os 8 do registry têm stream (B2)
    from app.providers.base import AIProviderBase

    class NoStream(AIProviderBase):
        id = "nostub"
        label = "NoStream"
        supports_stream = False

        async def complete(self, prompt, model, api_key=None):
            return "ok"

    stub = NoStream()
    assert stub.supports_stream is False
    with pytest.raises(NotImplementedError):
        async for _ in stub.complete_stream("prompt", "m", None):
            pass


async def test_todos_do_registry_tem_suporte_a_stream():
    # matriz fechada na v0.4.5 B2: 8/8 (Gemini incluso)
    from app.providers import PROVIDERS

    assert all(p.supports_stream for p in PROVIDERS.values())
