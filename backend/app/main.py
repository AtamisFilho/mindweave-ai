import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import endpoints_ai, endpoints_maps
from app.core.config import settings
from app.core.errors import AIProviderError
from app.db import init_db
from app.services import ai_service
from app.services.maps_service import MapVersionConflict

logging.basicConfig(level=logging.INFO)  # estrutura mínima para desenvolvimento

logger = logging.getLogger("app")

init_db()

app = FastAPI(title="MindWeave AI Backend")

# Configuração do CORS
# Permite que o frontend (que rodará em outra porta/domínio) acesse a API.
# Para desenvolvimento, "*" é aceitável. Em produção, restrinja as origens.
origins = [
    "http://localhost:5173",  # Porta padrão do Vite dev server
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    # Adicione outras origens se necessário (ex: URL de produção do frontend)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # Permite todos os métodos (GET, POST, PUT, etc.)
    allow_headers=["*"], # Permite todos os cabeçalhos
)

app.include_router(endpoints_ai.router, prefix="/api/v1/ai", tags=["AI Features"])
app.include_router(endpoints_maps.router, prefix="/api/v1/maps", tags=["Maps"])


@app.exception_handler(MapVersionConflict)
async def map_version_conflict_handler(request: Request, exc: MapVersionConflict):
    # Autosave de outra aba ganhou a corrida: frontend oferece recarregar
    logger.warning("Conflito de versão de mapa (atual: %s)", exc.current_version)
    return JSONResponse(
        status_code=409,
        content={
            "detail": {
                "error_code": "MAP_VERSION_CONFLICT",
                "message": "Este mapa foi alterado em outra aba. Recarregue para ver a versão mais recente.",
                "current_version": exc.current_version,
            }
        },
    )


@app.exception_handler(AIProviderError)
async def ai_provider_error_handler(request: Request, exc: AIProviderError):
    # Traduz falhas de IA para um JSON estruturado e UI-friendly.
    # Loga apenas metadados — nunca conteúdo de prompt, corpo do provedor ou chaves.
    logger.warning(
        "Falha de IA: error_code=%s provider=%s http=%s",
        exc.code.value, exc.provider, exc.status_code,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": {
                "error_code": exc.code.value,
                "message": exc.message,
                "provider": exc.provider,
            }
        },
    )


@app.get("/")
async def root():
    logger.info(
        "Config: OLLAMA_BASE_URL=%s DEFAULT_OLLAMA_MODEL=%s openai_key_set=%s google_key_set=%s",
        settings.OLLAMA_BASE_URL,
        settings.DEFAULT_OLLAMA_MODEL,
        ai_service.is_openai_key_set(),
        ai_service.is_google_key_set(),
    )
    return {"message": "Bem-vindo ao MindWeave AI Backend!"}

# Para executar localmente:
# Na pasta 'backend':
# pip install -r requirements.txt
# uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
#
# Para definir API keys (EXEMPLO - use .env ou equivalentes seguros):
# export OPENAI_API_KEY="sk-..."
# export GOOGLE_API_KEY="..."
#
# E certifique-se que Ollama está rodando e o modelo DEFAULT_OLLAMA_MODEL (ex: llama3) foi baixado.
# ollama serve
# ollama pull llama3
