"""Registry dos provedores de IA (v0.4 — Provider Chain).

5 dos 8 são OpenAI-compatible (uma classe); Gemini e Ollama têm adapters
nativos. Adicionar um provedor novo = uma entrada aqui.
"""
from app.providers.base import AIProviderBase, ErrorKind, ProviderCallError
from app.providers.gemini_native import GeminiNativeProvider
from app.providers.ollama_native import OllamaNativeProvider
from app.providers.openai_compatible import OpenAICompatibleProvider

__all__ = [
    "AIProviderBase", "ErrorKind", "ProviderCallError",
    "PROVIDERS", "get_provider",
]

PROVIDERS: dict[str, AIProviderBase] = {
    provider.id: provider
    for provider in (
        OpenAICompatibleProvider(
            id="groq", label="Groq",
            base_url="https://api.groq.com/openai/v1",
            default_model="llama-3.3-70b-versatile",
            daily_quota_markers=("tokens per day", "daily"),
        ),
        GeminiNativeProvider(),
        OpenAICompatibleProvider(
            id="openrouter", label="OpenRouter",
            base_url="https://openrouter.ai/api/v1",
            default_model="meta-llama/llama-3.1-8b-instruct:free",
        ),
        OpenAICompatibleProvider(
            id="cerebras", label="Cerebras",
            base_url="https://api.cerebras.ai/v1",
            default_model="llama3.1-8b",
        ),
        OpenAICompatibleProvider(
            id="deepseek", label="DeepSeek",
            base_url="https://api.deepseek.com/v1",
            default_model="deepseek-chat",
        ),
        OpenAICompatibleProvider(
            id="openai", label="OpenAI",
            base_url="https://api.openai.com/v1",
            default_model="gpt-4o-mini",
        ),
        OpenAICompatibleProvider(
            id="lmstudio", label="LM Studio (local)",
            base_url="http://localhost:1234/v1",
            default_model="local-model",
            requires_key=False,
            local=True,
        ),
        OllamaNativeProvider(),
    )
}


def get_provider(provider_id: str) -> AIProviderBase:
    return PROVIDERS[provider_id]
