from pydantic_settings import BaseSettings
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env'))


class Settings(BaseSettings):
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    DEFAULT_OLLAMA_MODEL: str = os.getenv("DEFAULT_OLLAMA_MODEL", "llama3")
    # Adicionaremos mais configurações aqui depois (OpenAI Key, Google Key)

settings = Settings()
