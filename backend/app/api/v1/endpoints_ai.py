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
    AIChatStreamRequest,
    AIProviderConfig,
    AIProviderConfigResponse,
    AIResearchRequest,
    AIResearchResponse,
    AISuggestedNode,
    AISuggestNodesBatchRequest,
    AISuggestNodesBatchResponse,
    AISuggestNodesBatchResult,
    AISuggestNodesRequest,
    AISuggestNodesResponse,
    NodeContext,
    OllamaConfig,
)
from app.providers import get_provider
from app.services import chain_executor, context_builder, keys_service
from app.services.ai_service import (
    build_research_prompt,
    build_suggest_prompt,
    get_ancestor_context_string,
    parse_suggestions,
)
from app.services.chain_executor import _kind_of

logger = logging.getLogger("app.api")

router = APIRouter()

# --- Configuração legada de IA (em memória) ---
# Restou apenas o selectedProvider/ollamaConfig da v0.3 (usado como default
# do model_name do Ollama). Chaves NÃO passam por aqui: fonte única é a
# tabela api_keys (criptografada) e o chain executor decide o provedor.

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
    """Chave do provedor — fonte única: tabela api_keys (criptografada)."""
    return keys_service.get_key(provider_id)


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




@router.post("/deep-research/stream")
async def deep_research_stream(request: AIResearchRequest = Body(...)):
    """Versão SSE da pesquisa: eventos chain/token/done/error (v0.4.5).

    Heartbeat ': ping' a cada 15s durante o thinking time. Transporte é
    fetch+ReadableStream no cliente (EventSource não aceita POST com corpo).
    """
    import asyncio
    import json

    from fastapi.responses import StreamingResponse

    ancestor_str = get_ancestor_context_string(request.ancestorContext)
    prompt = build_research_prompt(request.nodeContent, ancestor_str)

    async def event_stream():
        gen = chain_executor.execute_chain_stream(
            prompt,
            model=request.model_name,
            preferred=request.preferred_provider,
        )
        newline = chr(10)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(anext(gen), timeout=15.0)
                except asyncio.TimeoutError:
                    yield f": ping{newline}{newline}"  # mantém proxies vivos no thinking time
                    continue
                except StopAsyncIteration:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}{newline}{newline}"
        finally:
            # desconexão do cliente propaga o fechamento até o httpx do adapter
            await gen.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat/stream")
async def chat_stream(request: AIChatStreamRequest = Body(...)):
    """Chat com o mapa (v0.4.5): RAG via context_builder + cadeia em stream.

    O done carrega context_meta (strategy/nodes_included/chars/focus) para
    a linha de transparência na UI. Histórico recente (últimas 10 msgs)
    entra no prompt; a persistência por troca é responsabilidade do
    frontend (meta.chat no blob).
    """
    import asyncio
    import json

    from fastapi.responses import StreamingResponse

    if len(request.question.strip()) > 2000:
        raise HTTPException(status_code=400, detail={
            "error_code": "QUESTION_TOO_LONG",
            "message": "Pergunta deve ter até 2000 caracteres.",
        })

    document = context_builder.get_document_for_map(request.map_id) or {"nodes": [], "edges": []}
    context, context_meta = context_builder.build_chat_context(
        document, request.question,
        map_id=request.map_id, focus_node_id=request.focus_node_id,
    )

    # histórico recente: no máximo as últimas 10 trocas, texto puro
    history_lines = []
    for msg in (request.history or [])[-10:]:
        role = "Usuário" if msg.get("role") == "user" else "Assistente"
        history_lines.append(f"{role}: {msg.get('content', '')[:800]}")
    NL = chr(10)
    history_block = (NL.join(history_lines) + NL + NL) if history_lines else ""

    prompt = (
        "Você é um assistente que conversa sobre o mapa mental do usuário." + NL +
        f"{context}" + NL + NL +
        f"{history_block}" +
        f"Pergunta: {request.question}" + NL +
        "Responda em português, citando rótulos dos nós do mapa quando relevante. "
        "Se o mapa não contém a resposta, diga isso e responda com conhecimento geral."
    )

    async def event_stream():
        gen = chain_executor.execute_chain_stream(prompt)
        newline = chr(10)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(anext(gen), timeout=15.0)
                except asyncio.TimeoutError:
                    yield f": ping{newline}{newline}"
                    continue
                except StopAsyncIteration:
                    break
                if event.get("event") == "done":
                    event["context_meta"] = context_meta  # transparência do RAG
                yield f"data: {json.dumps(event, ensure_ascii=False)}{newline}{newline}"
        finally:
            await gen.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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


BATCH_MAX_NODES = 5  # teto consciente: paralelismo x rate limit dos provedores


@router.post("/suggest-nodes-batch", response_model=AISuggestNodesBatchResponse)
async def suggest_nodes_batch(request: AISuggestNodesBatchRequest = Body(...)):
    """Expansão de múltiplos nós (v0.4.5 B4): {map_id, node_ids}.

    Cada nó é expandido em PARALELO (asyncio.gather) pela mesma cadeia do
    /suggest-nodes individual. Sem streaming (decisão de escopo do B4: REST
    da v0.4; lote em stream fica para uma evolução). Falha de UM nó não
    derruba o lote — o resultado carrega error_code por nó.
    """
    import asyncio

    # dedupe preservando ordem (duplo clique pode enviar o id duas vezes)
    node_ids = list(dict.fromkeys(request.node_ids))
    if not node_ids:
        raise HTTPException(status_code=400, detail={
            "error_code": "EMPTY_BATCH",
            "message": "node_ids deve conter pelo menos um nó.",
        })
    if len(node_ids) > BATCH_MAX_NODES:
        raise HTTPException(status_code=400, detail={
            "error_code": "BATCH_TOO_LARGE",
            "message": f"Máximo de {BATCH_MAX_NODES} nós por lote.",
        })

    document = context_builder.get_document_for_map(request.map_id)
    if document is None:
        raise HTTPException(status_code=404, detail={
            "error_code": "MAP_NOT_FOUND",
            "message": "Mapa não encontrado.",
        })
    nodes_by_id = {n["id"]: n for n in document.get("nodes", [])}
    edges = document.get("edges", [])

    def _prompt_for(node_id: str) -> str:
        label = nodes_by_id[node_id].get("data", {}).get("label", "")
        ancestors = context_builder._ancestors(node_id, edges)
        ancestor_ctx = [
            NodeContext(id=aid, content=nodes_by_id[aid].get("data", {}).get("label", ""))
            for aid in ancestors if aid in nodes_by_id
        ]
        return build_suggest_prompt(label, get_ancestor_context_string(ancestor_ctx))

    async def _expand(node_id: str) -> AISuggestNodesBatchResult:
        if node_id not in nodes_by_id:
            return AISuggestNodesBatchResult(
                node_id=node_id, error_code="NODE_NOT_FOUND",
                message="Nó não encontrado no mapa.",
            )
        try:
            result = await chain_executor.execute_chain(
                _prompt_for(node_id), model=request.model_name,
            )
        except AIProviderError as exc:
            return AISuggestNodesBatchResult(
                node_id=node_id, error_code=exc.code.value, message=exc.message,
            )
        except Exception as exc:  # noqa: BLE001 — isola a falha no próprio nó
            logger.warning("suggest-nodes-batch: falha inesperada em %s: %s", node_id, exc)
            return AISuggestNodesBatchResult(
                node_id=node_id, error_code=ErrorCode.UNKNOWN.value,
                message="Falha inesperada ao expandir este nó.",
            )
        return AISuggestNodesBatchResult(
            node_id=node_id,
            suggestedNodes=[AISuggestedNode(content=s) for s in parse_suggestions(result["content"])],
            provider_used=result["provider_label"],
        )

    results = await asyncio.gather(*(_expand(nid) for nid in node_ids))
    return AISuggestNodesBatchResponse(results=list(results))


@router.get("/config", response_model=AIProviderConfigResponse)
async def get_ai_config():
    """
    Retorna a configuração atual do provedor de IA (sem expor as chaves).
    """
    return AIProviderConfigResponse(
        selectedProvider=_current_ai_settings.selectedProvider,
        ollamaConfig=_current_ai_settings.ollamaConfig,
        isOpenAiKeySet=keys_service.get_key("openai") is not None,
        isGoogleKeySet=keys_service.get_key("google") is not None
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
        keys_service.set_key("openai", config_update.openaiApiKey)
        logger.info("Chave OpenAI atualizada via endpoint de configuração.")

    if config_update.googleApiKey:
        keys_service.set_key("google", config_update.googleApiKey)
        logger.info("Chave Google atualizada via endpoint de configuração.")

    logger.info(
        "Config de IA atualizada: provider=%s ollama_model=%s",
        _current_ai_settings.selectedProvider,
        _current_ai_settings.ollamaConfig.model,
    )

    return AIProviderConfigResponse(
        selectedProvider=_current_ai_settings.selectedProvider,
        ollamaConfig=_current_ai_settings.ollamaConfig,
        isOpenAiKeySet=keys_service.get_key("openai") is not None,
        isGoogleKeySet=keys_service.get_key("google") is not None
    )
