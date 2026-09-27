import logging

from fastapi import APIRouter, Body

from app.core.config import settings
from app.core.errors import AIProviderError, ErrorCode
from app.models.ai_models import (
    AIProviderConfig,
    AIProviderConfigResponse,
    AIResearchRequest,
    AIResearchResponse,
    AISuggestNodesRequest,
    AISuggestNodesResponse,
    OllamaConfig,
)
from app.services import ai_service

logger = logging.getLogger("app.api")

router = APIRouter()

# --- Configuração de IA (em memória) ---
# Chaves de API NÃO são armazenadas aqui; o serviço ai_service gerencia o acesso.

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


@router.post("/deep-research", response_model=AIResearchResponse)
async def deep_research(request: AIResearchRequest = Body(...)):
    provider_to_use = request.provider or _current_ai_settings.selectedProvider

    if provider_to_use == 'ollama':
        summary = await ai_service.perform_deep_research_ollama(request, _resolve_ollama_cfg(request))
    elif provider_to_use == 'openai':
        summary = await ai_service.perform_deep_research_openai(request, ai_service.get_openai_key())
    elif provider_to_use == 'google':
        summary = await ai_service.perform_deep_research_google(request, ai_service.get_google_key())
    else:
        raise AIProviderError(
            ErrorCode.UNKNOWN_PROVIDER,
            f"Provedor de IA desconhecido: {provider_to_use}",
            str(provider_to_use), 400,
        )

    return AIResearchResponse(nodeId=request.nodeId, researchSummary=summary)


@router.post("/suggest-nodes", response_model=AISuggestNodesResponse)
async def suggest_nodes(request: AISuggestNodesRequest = Body(...)):
    provider_to_use = request.provider or _current_ai_settings.selectedProvider

    if provider_to_use == 'ollama':
        suggestions = await ai_service.suggest_new_nodes_ollama(request, _resolve_ollama_cfg(request))
    elif provider_to_use == 'openai':
        suggestions = await ai_service.suggest_new_nodes_openai(request, ai_service.get_openai_key())
    elif provider_to_use == 'google':
        suggestions = await ai_service.suggest_new_nodes_google(request, ai_service.get_google_key())
    else:
        raise AIProviderError(
            ErrorCode.UNKNOWN_PROVIDER,
            f"Provedor de IA desconhecido: {provider_to_use}",
            str(provider_to_use), 400,
        )

    return AISuggestNodesResponse(nodeId=request.nodeId, suggestedNodes=suggestions)


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
    As API keys são passadas para o módulo de serviço (armazenamento em memória).
    """
    global _current_ai_settings

    _current_ai_settings.selectedProvider = config_update.selectedProvider
    _current_ai_settings.ollamaConfig = config_update.ollamaConfig

    if config_update.openaiApiKey:
        ai_service.set_openai_api_key(config_update.openaiApiKey)
        logger.info("Chave OpenAI atualizada via endpoint de configuração.")

    if config_update.googleApiKey:
        ai_service.set_google_api_key(config_update.googleApiKey)
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
