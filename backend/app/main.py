from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware # Importar CORSMiddleware
from app.api.v1 import endpoints_ai
from app.core.config import settings
from app.services import ai_service

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

@app.get("/")
async def root():
    # Log de variáveis de ambiente para depuração (opcional, remova em produção)
    print(f"OLLAMA_BASE_URL from settings: {settings.OLLAMA_BASE_URL}")
    print(f"DEFAULT_OLLAMA_MODEL from settings: {settings.DEFAULT_OLLAMA_MODEL}")
    print(f"OpenAI Key Loaded: {ai_service.is_openai_key_set()}") # Precisa importar ai_service
    print(f"Google Key Loaded: {ai_service.is_google_key_set()}") # Precisa importar ai_service
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
