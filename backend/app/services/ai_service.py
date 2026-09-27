import logging
import os

import httpx

from app.core.config import settings
from app.core.errors import AIProviderError, ErrorCode
from app.models.ai_models import (
    AIResearchRequest,
    AISuggestedNode,
    AISuggestNodesRequest,
    NodeContext,
    OllamaConfig,
)

logger = logging.getLogger("app.ai")

# Chamadas de IA: 60s no total; conexão aborta em 10s (falha rápida p/ serviço fora do ar)
_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# --- Gerenciamento de API Keys (Simples - NÃO PARA PRODUÇÃO REAL) ---
# Em produção, use Vault, AWS/GCP Secret Manager, ou variáveis de ambiente seguras.
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


def _log_request(provider: str, model: str, prompt: str, ancestor_count: int) -> None:
    """Loga apenas metadados; o conteúdo do prompt só com LOG_PROMPTS=true (DEBUG)."""
    logger.info(
        "IA: provider=%s model=%s ancestrais=%d prompt_chars=%d",
        provider, model, ancestor_count, len(prompt),
    )
    if settings.LOG_PROMPTS:
        logger.debug("Prompt (%s/%s): %s", provider, model, prompt)


def _require_key(provider: str, api_key: str | None) -> str:
    if not api_key:
        raise AIProviderError(
            ErrorCode.KEY_NOT_CONFIGURED,
            f"Chave de API do {provider} não configurada no servidor.",
            provider,
            400,
        )
    return api_key


def _error_from_status(provider: str, status_code: int, body: str) -> AIProviderError:
    # Chave rejeitada: OpenAI responde 401; Gemini responde 400 com "API key not valid"
    if status_code in (400, 401, 403) and "api key" in body.lower():
        return AIProviderError(
            ErrorCode.PROVIDER_INVALID_KEY,
            f"O {provider} rejeitou a chave de API (HTTP {status_code}).",
            provider, 502,
        )
    if status_code in (401, 403):
        return AIProviderError(
            ErrorCode.PROVIDER_INVALID_KEY,
            f"O {provider} rejeitou a chave de API (HTTP {status_code}).",
            provider, 502,
        )
    if status_code == 404:
        return AIProviderError(
            ErrorCode.MODEL_NOT_FOUND,
            f"Modelo ou recurso não encontrado no {provider} (HTTP 404). Verifique o nome do modelo.",
            provider, 502,
        )
    if status_code == 429:
        return AIProviderError(
            ErrorCode.RATE_LIMIT_EXCEEDED,
            f"Limite de requisições do {provider} excedido (HTTP 429). Tente novamente em instantes.",
            provider, 429,
        )
    return AIProviderError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        f"O {provider} retornou o status HTTP {status_code}.",
        provider, 502,
    )


def _request_error(provider: str, exc: Exception) -> AIProviderError:
    # TimeoutException é subclasse de RequestError: checar ANTES
    if isinstance(exc, httpx.TimeoutException):
        return AIProviderError(
            ErrorCode.PROVIDER_TIMEOUT,
            f"O {provider} não respondeu a tempo (timeout). Tente novamente.",
            provider, 504,
        )
    return AIProviderError(
        ErrorCode.PROVIDER_UNREACHABLE,
        f"Não foi possível conectar ao serviço do {provider}.",
        provider, 503,
    )


def _parse_suggestions(raw: str) -> list[AISuggestedNode]:
    suggestions = [
        AISuggestedNode(content=line.strip())
        for line in raw.split("\n")
        if line.strip()
    ]
    return suggestions or [AISuggestedNode(content="Nenhuma sugestão gerada.")]


# --- Ollama ---
async def _ollama_generate(prompt: str, model: str, base_url: str) -> str:
    payload = {"model": model, "prompt": prompt, "stream": False}
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            response = await client.post(f"{base_url.rstrip('/')}/api/generate", json=payload)
    except httpx.HTTPError as exc:
        raise _request_error("Ollama", exc) from exc
    if response.status_code != 200:
        logger.debug("Ollama HTTP %s: %s", response.status_code, response.text[:200])
        raise _error_from_status("Ollama", response.status_code, response.text)
    return response.json().get("response", "").strip()


async def perform_deep_research_ollama(request: AIResearchRequest, config: OllamaConfig) -> str:
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else ""
    model_to_use = request.model_name or config.model

    prompt = (
        f"Você é um assistente de pesquisa especializado. Por favor, realize uma pesquisa aprofundada sobre o seguinte tópico: '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"O objetivo é obter um resumo conciso e informativo sobre este tópico, levando em conta sua posição na hierarquia do mapa mental. "
        f"Não mencione os nós pais explicitamente na sua resposta, mas use-os para entender o sub-tópico em questão.\n"
        f"Resumo da pesquisa:"
    )
    _log_request("ollama", model_to_use, prompt, len(request.ancestorContext))
    return await _ollama_generate(prompt, model_to_use, config.baseUrl)


async def suggest_new_nodes_ollama(request: AISuggestNodesRequest, config: OllamaConfig) -> list[AISuggestedNode]:
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else ""
    model_to_use = request.model_name or config.model

    prompt = (
        f"Você é um assistente de brainstorming para mapas mentais. O nó atual é '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"Com base neste nó e seu contexto, sugira até 3-5 novos sub-nós ou nós relacionados que poderiam expandir este mapa mental. "
        f"Liste cada sugestão em uma nova linha, sem marcadores ou numeração. Apenas o texto da sugestão.\n"
        f"Exemplo de formato de resposta:\n"
        f"Sugestão 1\n"
        f"Sugestão 2\n"
        f"Sugestão 3\n"
        f"Sugestões:"
    )
    _log_request("ollama", model_to_use, prompt, len(request.ancestorContext))
    raw_suggestions = await _ollama_generate(prompt, model_to_use, config.baseUrl)
    return _parse_suggestions(raw_suggestions)


# --- OpenAI ---
async def perform_deep_research_openai(request: AIResearchRequest, api_key: str | None) -> str:
    key = _require_key("OpenAI", api_key)
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    model_to_use = request.model_name or "gpt-3.5-turbo"

    messages = [
        {"role": "system", "content": "Você é um assistente de pesquisa especializado. Forneça resumos concisos e informativos."},
        {"role": "user", "content": (
            f"Realize uma pesquisa aprofundada sobre o tópico: '{request.nodeContent}'.\n"
            f"{context_narrative}\n"
            f"O objetivo é obter um resumo sobre este tópico, levando em conta sua posição na hierarquia do mapa mental. "
            f"Não mencione os nós pais explicitamente na sua resposta, mas use-os para entender o sub-tópico em questão.\n"
            f"Resumo da pesquisa:"
        )}
    ]
    _log_request("openai", model_to_use, messages[1]["content"], len(request.ancestorContext))

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            headers = {"Authorization": f"Bearer {key}"}
            response = await client.post("https://api.openai.com/v1/chat/completions", json={"model": model_to_use, "messages": messages}, headers=headers)
    except httpx.HTTPError as exc:
        raise _request_error("OpenAI", exc) from exc
    if response.status_code != 200:
        logger.debug("OpenAI HTTP %s: %s", response.status_code, response.text[:200])
        raise _error_from_status("OpenAI", response.status_code, response.text)
    return response.json()["choices"][0]["message"]["content"].strip()


async def suggest_new_nodes_openai(request: AISuggestNodesRequest, api_key: str | None) -> list[AISuggestedNode]:
    key = _require_key("OpenAI", api_key)
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    model_to_use = request.model_name or "gpt-3.5-turbo"

    messages = [
        {"role": "system", "content": "Você é um assistente de brainstorming para mapas mentais. Sugira novos nós concisos."},
        {"role": "user", "content": (
            f"O nó atual é '{request.nodeContent}'.\n"
            f"{context_narrative}\n"
            f"Com base neste nó e seu contexto, sugira até 3-5 novos sub-nós ou nós relacionados que poderiam expandir este mapa mental. "
            f"Liste cada sugestão em uma nova linha, sem marcadores ou numeração. Apenas o texto da sugestão."
        )}
    ]
    _log_request("openai", model_to_use, messages[1]["content"], len(request.ancestorContext))

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            headers = {"Authorization": f"Bearer {key}"}
            payload = {"model": model_to_use, "messages": messages, "max_tokens": 100}
            response = await client.post("https://api.openai.com/v1/chat/completions", json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise _request_error("OpenAI", exc) from exc
    if response.status_code != 200:
        logger.debug("OpenAI HTTP %s: %s", response.status_code, response.text[:200])
        raise _error_from_status("OpenAI", response.status_code, response.text)
    return _parse_suggestions(response.json()["choices"][0]["message"]["content"].strip())


# --- Google Gemini ---
# A chave vai no header x-goog-api-key (nunca na query string, que vaza em logs de URL)
def _gemini_url(model_to_use: str) -> str:
    return f"https://generativelanguage.googleapis.com/v1beta/models/{model_to_use}:generateContent"


async def perform_deep_research_google(request: AIResearchRequest, api_key: str | None) -> str:
    key = _require_key("Google", api_key)
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    model_to_use = request.model_name or "gemini-1.5-flash-latest"

    prompt_text = (
        f"Você é um assistente de pesquisa especializado. Por favor, realize uma pesquisa aprofundada sobre o seguinte tópico: '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"O objetivo é obter um resumo conciso e informativo sobre este tópico, levando em conta sua posição na hierarquia do mapa mental. "
        f"Não mencione os nós pais explicitamente na sua resposta, mas use-os para entender o sub-tópico em questão.\n"
        f"Resumo da pesquisa:"
    )
    _log_request("google", model_to_use, prompt_text, len(request.ancestorContext))

    payload = {"contents": [{"parts": [{"text": prompt_text}]}]}
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            headers = {"Content-Type": "application/json", "x-goog-api-key": key}
            response = await client.post(_gemini_url(model_to_use), json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise _request_error("Google", exc) from exc
    if response.status_code != 200:
        logger.debug("Gemini HTTP %s: %s", response.status_code, response.text[:200])
        raise _error_from_status("Google", response.status_code, response.text)

    data = response.json()
    candidates = data.get("candidates") or []
    parts = candidates[0].get("content", {}).get("parts") if candidates else None
    if parts:
        return parts[0]["text"].strip()
    logger.debug("Resposta inesperada do Gemini: %s", str(data)[:300])
    raise AIProviderError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        "O Gemini retornou uma resposta em formato inesperado.",
        "Google", 502,
    )


async def suggest_new_nodes_google(request: AISuggestNodesRequest, api_key: str | None) -> list[AISuggestedNode]:
    key = _require_key("Google", api_key)
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    context_narrative = f"Contexto hierárquico (do mais próximo ao mais amplo): {ancestor_str}." if ancestor_str else "Este é um nó raiz."
    model_to_use = request.model_name or "gemini-1.5-flash-latest"

    prompt_text = (
        f"Você é um assistente de brainstorming para mapas mentais. O nó atual é '{request.nodeContent}'.\n"
        f"{context_narrative}\n"
        f"Com base neste nó e seu contexto, sugira até 3-5 novos sub-nós ou nós relacionados que poderiam expandir este mapa mental. "
        f"Liste cada sugestão em uma nova linha, sem marcadores ou numeração. Apenas o texto da sugestão."
    )
    _log_request("google", model_to_use, prompt_text, len(request.ancestorContext))

    payload = {"contents": [{"parts": [{"text": prompt_text}]}]}
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            headers = {"Content-Type": "application/json", "x-goog-api-key": key}
            response = await client.post(_gemini_url(model_to_use), json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise _request_error("Google", exc) from exc
    if response.status_code != 200:
        logger.debug("Gemini HTTP %s: %s", response.status_code, response.text[:200])
        raise _error_from_status("Google", response.status_code, response.text)

    data = response.json()
    candidates = data.get("candidates") or []
    parts = candidates[0].get("content", {}).get("parts") if candidates else None
    if parts:
        return _parse_suggestions(parts[0]["text"].strip())
    logger.debug("Resposta inesperada do Gemini (sugestões): %s", str(data)[:300])
    raise AIProviderError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        "O Gemini retornou uma resposta em formato inesperado.",
        "Google", 502,
    )
