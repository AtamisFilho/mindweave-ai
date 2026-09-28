import os

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env'))


class Settings(BaseSettings):
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    DEFAULT_OLLAMA_MODEL: str = os.getenv("DEFAULT_OLLAMA_MODEL", "llama3")
    # Logar prompts completos (DEBUG)? Nunca habilitar em produção.
    LOG_PROMPTS: bool = False
    # Origens permitidas pelo CORS (separadas por vírgula)
    ALLOWED_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:3000,http://127.0.0.1:3000"
    )
    # HSTS: habilitar SOMENTE quando servir via HTTPS
    SECURITY_HSTS: bool = False
    # Adicionaremos mais configurações aqui depois (OpenAI Key, Google Key)

settings = Settings()
