"""Endpoints de IA (v0.4): pesquisa e sugestão via Provider Chain.

Contrato:
- Sem `provider` no body -> executa na CADEIA (fallback automático entre
  provedores; `preferred_provider` vai para a frente).
- Com `provider` (campo legado v0.3) -> tenta APENAS aquele provedor,
  sem fallback.
- Respostas carregam `provider_used` e `fallback_trail` para a UI.
"""
import logging

from fastapi import APIRouter, Body, HTTPException

from app.core.config import settings
from app.core.errors import KIND_TO_RESPONSE, AIProviderError, ErrorCode, ErrorKind
from app.models.ai_models import (
    AIProviderConfig,
    AIProviderConfigResponse,
    AIResearchRequest,
    AIResearchResponse,
    AISuggestNodesRequest,
    AISuggestNodesResponse,
    OllamaConfig,
)
from app.providers import get_provider
from app.services import ai_service, chain_executor, keys_service
from app.services.ai_service import (
    build_research_prompt,
    build_suggest_prompt,
    get_ancestor_context_string,
    parse_suggestions,
)
from app.services.chain_executor import _kind_of

logger = logging.getLogger("app.api")

router = APIRouter()

# --- Configuração de IA (em memória) ---
# Chaves de API NÃO são armazenadas aqui; a fonte canônica é a tabela
# api_keys (criptografada) e o chain executor decide o provedor.

_current_ai_settings = AIProviderConfig(
    selectedProvider='ollama',
    ollamaConfig=OllamaConfig(
        baseUrl=settings.OLLAMA_BASE_URL,
        model=settings.DEFAULT_OLLAMA_MODEL
    )
)
# --- Fim da Configuração de IA ---


def _resolve_ollama_cfg(request) -> OllamaConfig:
    """Se o request especificar um model_name, ele sobrescreve a config global do Ollama."""
    cfg = _current_ai_settings.ollamaConfig
    if request.model_name:
        return cfg.model_copy(update={"model": request.model_name})
    return cfg


def _kind_to_http_error(provider_label: str, exc: Exception) -> HTTPException:
    """Converte ProviderCallError (ou qualquer falha) em HTTPException com
    payload estruturado {error_code, message, provider, retry_after?}."""
    kind = _kind_of(exc)
    code, status = KIND_TO_RESPONSE[kind]
    retry_after = getattr(exc, "retry_after", None)
    detail = {
        "error_code": code.value,
        "message": f"{provider_label}: {exc}",
        "provider": provider_label,
    }
    if retry_after:
        detail["retry_after"] = retry_after
    return HTTPException(status_code=status, detail=detail)


def _api_key_for(provider_id: str) -> str | None:
    """Chave do provedor: tabela criptografada primeiro; legados em memória."""
    if provider_id == 'openai':
        return keys_service.get_key('openai') or ai_service.get_openai_key()
    if provider_id == 'google':
        return keys_service.get_key('google') or ai_service.get_google_key()
    return None


async def _complete_via(provider_id: str, prompt: str, model: str | None, request) -> str:
    provider = get_provider(provider_id)
    model_to_use = model or (
        _resolve_ollama_cfg(request).model if provider_id == 'ollama' else provider.default_model
    )
    api_key = _api_key_for(provider_id)
    if provider.requires_key and not api_key:
        # pré-chamada: sem chave nem entra no adapter (contrato v0.3 mantido)
        raise AIProviderError(
            ErrorCode.KEY_NOT_CONFIGURED,
            f"{provider.label}: chave de API não configurada no servidor.",
            provider.label,
            status_code=400,
            kind=ErrorKind.KEY_NOT_CONFIGURED,
        )
    try:
        return await provider.complete(prompt, model_to_use, api_key)
    except Exception as exc:  # noqa: BLE001 — convertido para erro estruturado
        raise _kind_to_http_error(provider.label, exc) from exc


@router.post("/deep-research", response_model=AIResearchResponse)
async def deep_research(request: AIResearchRequest = Body(...)):
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    prompt = build_research_prompt(request.nodeContent, ancestor_str)

    # Campo legado v0.3: UM provedor fixo, sem fallback
    if request.provider:
        content = await _complete_via(request.provider, prompt, request.model_name, request)
        return AIResearchResponse(
            nodeId=request.nodeId,
            researchSummary=content,
            provider_used=request.provider,
            fallback_trail=[],
        )

    # v0.4: cadeia com fallback automático
    try:
        result = await chain_executor.execute_chain(
            prompt,
            model=request.model_name,
            preferred=request.preferred_provider,
        )
    except AIProviderError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={
                "error_code": exc.code.value,
                "message": exc.message,
                "provider": exc.provider,
                "fallback_trail": exc.trail,
                **({"retry_after": exc.retry_after} if exc.retry_after else {}),
            },
        ) from exc

    return AIResearchResponse(
        nodeId=request.nodeId,
        researchSummary=result["content"],
        provider_used=result["provider_label"],
        fallback_trail=result["trail"],
    )


@router.post("/suggest-nodes", response_model=AISuggestNodesResponse)
async def suggest_nodes(request: AISuggestNodesRequest = Body(...)):
    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    prompt = build_suggest_prompt(request.nodeContent, ancestor_str)

    # Campo legado v0.3: UM provedor fixo, sem fallback
    if request.provider:
        provider = get_provider(request.provider)
        model = request.model_name or (
            _resolve_ollama_cfg(request).model if request.provider == 'ollama' else provider.default_model
        )
        api_key = _api_key_for(provider_id=request.provider)
        try:
            content = await provider.complete(prompt, model, api_key)
        except Exception as exc:  # noqa: BLE001
            raise _kind_to_http_error(provider.label, exc) from exc
        return AISuggestNodesResponse(
            nodeId=request.nodeId,
            suggestedNodes=[{"content": s} for s in parse_suggestions(content)],
            provider_used=request.provider,
            fallback_trail=[],
        )

    # v0.4: cadeia com fallback automático
    try:
        result = await chain_executor.execute_chain(
            prompt,
            model=request.model_name,
            preferred=request.preferred_provider,
        )
    except AIProviderError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={
                "error_code": exc.code.value,
                "message": exc.message,
                "provider": exc.provider,
                "fallback_trail": exc.trail,
                **({"retry_after": exc.retry_after} if exc.retry_after else {}),
            },
        ) from exc

    return AISuggestNodesResponse(
        nodeId=request.nodeId,
        suggestedNodes=[{"content": s} for s in parse_suggestions(result["content"])],
        provider_used=result["provider_label"],
        fallback_trail=result["trail"],
    )


@router.get("/config", response_model=AIProviderConfigResponse)
async def get_ai_config():
    """
    Retorna a configuração atual do provedor de IA (sem expor as chaves).
    """
    return AIProviderConfigResponse(
        selectedProvider=_current_ai_settings.selectedProvider,
        ollamaConfig=_current_ai_settings.ollamaConfig,
        isOpenAiKeySet=ai_service.is_openai_key_set(),
        isGoogleKeySet=ai_service.is_google_key_set()
    )

@router.put("/config", response_model=AIProviderConfigResponse)
async def update_ai_config(config_update: AIProviderConfig = Body(...)):
    """
    Atualiza a configuração do provedor de IA.
    As API keys são passadas para o módulo de serviço (memória v0.3 + espelho
    criptografado na tabela api_keys, v0.4 B0).
    """
    global _current_ai_settings

    _current_ai_settings.selectedProvider = config_update.selectedProvider
    _current_ai_settings.ollamaConfig = config_update.ollamaConfig

    if config_update.openaiApiKey:
        ai_service.set_openai_api_key(config_update.openaiApiKey)
        keys_service.set_key("openai", config_update.openaiApiKey)  # espelho criptografado (v0.4 B0)
        logger.info("Chave OpenAI atualizada via endpoint de configuração.")

    if config_update.googleApiKey:
        ai_service.set_google_api_key(config_update.googleApiKey)
        keys_service.set_key("google", config_update.googleApiKey)  # espelho criptografado (v0.4 B0)
        logger.info("Chave Google atualizada via endpoint de configuração.")

    logger.info(
        "Config de IA atualizada: provider=%s ollama_model=%s",
        _current_ai_settings.selectedProvider,
        _current_ai_settings.ollamaConfig.model,
    )

    return AIProviderConfigResponse(
        selectedProvider=_current_ai_settings.selectedProvider,
        ollamaConfig=_current_ai_settings.ollamaConfig,
        isOpenAiKeySet=ai_service.is_openai_key_set(),
        isGoogleKeySet=ai_service.is_google_key_set()
    )
