from fastapi import APIRouter, HTTPException, Body
from app.models.ai_models import (
    AIResearchRequest,
    AIResearchResponse,
    AISuggestNodesRequest,
    AISuggestNodesResponse,
    AIProviderConfig,
    AIProviderConfigResponse, # Use a specific response model
    OllamaConfig
)
from app.services import ai_service 
from app.core.config import settings

router = APIRouter()

# --- Configuração de IA (simulada em memória) ---
# Em um app real, isso viria de um DB ou config de usuário.
# Chaves de API NÃO são armazenadas aqui diretamente.
# O serviço ai_service gerencia o acesso às chaves (que vêm de env vars).

_current_ai_settings = AIProviderConfig(
    selectedProvider='ollama',
    ollamaConfig=OllamaConfig(
        baseUrl=settings.OLLAMA_BASE_URL,
        model=settings.DEFAULT_OLLAMA_MODEL
    )
)
# --- Fim da Configuração de IA ---


@router.post("/deep-research", response_model=AIResearchResponse)
async def deep_research(request: AIResearchRequest = Body(...)):
    provider_to_use = request.provider or _current_ai_settings.selectedProvider
    summary = ""

    if provider_to_use == 'ollama':
        ollama_cfg = _current_ai_settings.ollamaConfig
        # Se o request especificar um model_name, ele sobrescreve a config global do Ollama para esta chamada
        if request.model_name:
            temp_ollama_cfg = ollama_cfg.model_copy(update={"model": request.model_name})
            summary = await ai_service.perform_deep_research_ollama(request, temp_ollama_cfg)
        else:
            summary = await ai_service.perform_deep_research_ollama(request, ollama_cfg)
    elif provider_to_use == 'openai':
        if not ai_service.is_openai_key_set():
             raise HTTPException(status_code=400, detail="OpenAI API Key não configurada no servidor.")
        summary = await ai_service.perform_deep_research_openai(request, ai_service._OPENAI_API_KEY)
    elif provider_to_use == 'google':
        if not ai_service.is_google_key_set():
            raise HTTPException(status_code=400, detail="Google API Key não configurada no servidor.")
        summary = await ai_service.perform_deep_research_google(request, ai_service._GOOGLE_API_KEY)
    else:
        raise HTTPException(status_code=400, detail=f"Provedor de IA desconhecido: {provider_to_use}")

    if summary.startswith("Error:"):
        # Erros específicos podem ter códigos HTTP diferentes
        if "Could not connect" in summary:
            raise HTTPException(status_code=503, detail=summary) # Service Unavailable
        elif "API Key não configurada" in summary or "request failed" in summary: # Erros de config ou da API externa
            raise HTTPException(status_code=502, detail=summary) # Bad Gateway
        raise HTTPException(status_code=500, detail=summary) # Internal Server Error
        
    return AIResearchResponse(nodeId=request.nodeId, researchSummary=summary)


@router.post("/suggest-nodes", response_model=AISuggestNodesResponse)
async def suggest_nodes(request: AISuggestNodesRequest = Body(...)):
    provider_to_use = request.provider or _current_ai_settings.selectedProvider
    suggestions = []

    if provider_to_use == 'ollama':
        ollama_cfg = _current_ai_settings.ollamaConfig
        if request.model_name:
            temp_ollama_cfg = ollama_cfg.model_copy(update={"model": request.model_name})
            suggestions = await ai_service.suggest_new_nodes_ollama(request, temp_ollama_cfg)
        else:
            suggestions = await ai_service.suggest_new_nodes_ollama(request, ollama_cfg)
    elif provider_to_use == 'openai':
        if not ai_service.is_openai_key_set():
            raise HTTPException(status_code=400, detail="OpenAI API Key não configurada no servidor.")
        suggestions = await ai_service.suggest_new_nodes_openai(request, ai_service._OPENAI_API_KEY)
    elif provider_to_use == 'google':
        if not ai_service.is_google_key_set():
            raise HTTPException(status_code=400, detail="Google API Key não configurada no servidor.")
        suggestions = await ai_service.suggest_new_nodes_google(request, ai_service._GOOGLE_API_KEY)
    else:
        raise HTTPException(status_code=400, detail=f"Provedor de IA desconhecido: {provider_to_use}")
    
    if suggestions and len(suggestions) == 1 and suggestions[0].content.startswith("Error:"):
        error_detail = suggestions[0].content
        if "Could not connect" in error_detail:
            raise HTTPException(status_code=503, detail=error_detail)
        elif "API Key não configurada" in error_detail or "request failed" in error_detail:
             raise HTTPException(status_code=502, detail=error_detail)
        raise HTTPException(status_code=500, detail=error_detail)

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
    As API keys são passadas para o módulo de serviço para armazenamento (simulado).
    """
    global _current_ai_settings

    _current_ai_settings.selectedProvider = config_update.selectedProvider
    _current_ai_settings.ollamaConfig = config_update.ollamaConfig
    
    if config_update.openaiApiKey:
        ai_service.set_openai_api_key(config_update.openaiApiKey)
        print("OpenAI API Key updated via config endpoint.")
        
    if config_update.googleApiKey:
        ai_service.set_google_api_key(config_update.googleApiKey)
        print("Google API Key updated via config endpoint.")

    print(f"AI Config Updated: Provider='{_current_ai_settings.selectedProvider}', OllamaModel='{_current_ai_settings.ollamaConfig.model}'")
    
    return AIProviderConfigResponse(
        selectedProvider=_current_ai_settings.selectedProvider,
        ollamaConfig=_current_ai_settings.ollamaConfig,
        isOpenAiKeySet=ai_service.is_openai_key_set(),
        isGoogleKeySet=ai_service.is_google_key_set()
    )
