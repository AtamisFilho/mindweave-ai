from pydantic import BaseModel
from typing import List, Optional, Literal
from app.core.config import settings # Import settings to use for default values

class NodeContext(BaseModel):
    id: str
    content: str

class AIResearchRequest(BaseModel):
    nodeId: str
    nodeContent: str
    ancestorContext: List[NodeContext] = []
    provider: Optional[Literal['ollama', 'openai', 'google']] = 'ollama'
    model_name: Optional[str] = None # Allow specifying model per request

class AIResearchResponse(BaseModel):
    nodeId: str
    researchSummary: str

class AISuggestNodesRequest(BaseModel):
    nodeId: str
    nodeContent: str
    ancestorContext: List[NodeContext] = []
    provider: Optional[Literal['ollama', 'openai', 'google']] = 'ollama'
    model_name: Optional[str] = None # Allow specifying model per request

class AISuggestedNode(BaseModel):
    content: str

class AISuggestNodesResponse(BaseModel):
    nodeId: str
    suggestedNodes: List[AISuggestedNode]

class OllamaConfig(BaseModel):
    baseUrl: str = settings.OLLAMA_BASE_URL
    model: str = settings.DEFAULT_OLLAMA_MODEL

class AIProviderConfig(BaseModel):
    selectedProvider: Literal['ollama', 'openai', 'google'] = 'ollama'
    ollamaConfig: OllamaConfig = OllamaConfig()
    # These will be used for input when updating config, but not directly stored or outputted
    openaiApiKey: Optional[str] = None 
    googleApiKey: Optional[str] = None

class AIProviderConfigResponse(BaseModel): # Separate model for responses
    selectedProvider: Literal['ollama', 'openai', 'google']
    ollamaConfig: OllamaConfig
    # We don't include API keys in responses for security
    # We can add flags like 'isOpenAiKeySet' if needed by frontend
    isOpenAiKeySet: bool = False
    isGoogleKeySet: bool = False
