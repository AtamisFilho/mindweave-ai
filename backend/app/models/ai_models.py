from typing import Any, Literal

from pydantic import BaseModel

from app.core.config import settings  # Import settings to use for default values


class NodeContext(BaseModel):
    id: str
    content: str

class AIResearchRequest(BaseModel):
    nodeId: str
    nodeContent: str
    ancestorContext: list[NodeContext] = []
    # DEPRECATED (v0.3): fixa UM provedor sem fallback. None = usa a cadeia.
    provider: Literal['ollama', 'openai', 'google'] | None = None
    # v0.4: primeiro da cadeia (fallbacks seguem para os demais)
    preferred_provider: str | None = None
    model_name: str | None = None # Allow specifying model per request

class AIResearchResponse(BaseModel):
    nodeId: str
    researchSummary: str
    provider_used: str
    fallback_trail: list[dict[str, Any]] = []

class AISuggestNodesRequest(BaseModel):
    nodeId: str
    nodeContent: str
    ancestorContext: list[NodeContext] = []
    # DEPRECATED (v0.3): fixa UM provedor sem fallback. None = usa a cadeia.
    provider: Literal['ollama', 'openai', 'google'] | None = None
    # v0.4: primeiro da cadeia (fallbacks seguem para os demais)
    preferred_provider: str | None = None
    model_name: str | None = None # Allow specifying model per request

class AISuggestedNode(BaseModel):
    content: str

class AISuggestNodesResponse(BaseModel):
    nodeId: str
    suggestedNodes: list[AISuggestedNode]
    provider_used: str
    fallback_trail: list[dict[str, Any]] = []


class AIChatMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str

class AIChatStreamRequest(BaseModel):
    map_id: str
    question: str
    history: list[AIChatMessage] = []
    focus_node_id: str | None = None  # nó selecionado no canvas (âncora do RAG)

class OllamaConfig(BaseModel):
    baseUrl: str = settings.OLLAMA_BASE_URL
    model: str = settings.DEFAULT_OLLAMA_MODEL

class AIProviderConfig(BaseModel):
    selectedProvider: Literal['ollama', 'openai', 'google'] = 'ollama'
    ollamaConfig: OllamaConfig = OllamaConfig()
    # These will be used for input when updating config, but not directly stored or outputted
    openaiApiKey: str | None = None
    googleApiKey: str | None = None

class AIProviderConfigResponse(BaseModel): # Separate model for responses
    selectedProvider: Literal['ollama', 'openai', 'google']
    ollamaConfig: OllamaConfig
    # We don't include API keys in responses for security
    isOpenAiKeySet: bool = False
    isGoogleKeySet: bool = False
