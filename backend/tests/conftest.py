"""Fixtures compartilhadas: estado de IA limpo entre testes e cliente HTTP."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.v1 import endpoints_ai
from app.main import app
from app.services import ai_service


@pytest.fixture(autouse=True)
def reset_ai_state():
    """Chaves e configurações vivem em memória — zera antes de cada teste."""
    ai_service.set_openai_api_key(None)
    ai_service.set_google_api_key(None)
    endpoints_ai._current_ai_settings.selectedProvider = "ollama"
    endpoints_ai._current_ai_settings.ollamaConfig.baseUrl = "http://localhost:11434"
    endpoints_ai._current_ai_settings.ollamaConfig.model = "llama3"
    yield
    ai_service.set_openai_api_key(None)
    ai_service.set_google_api_key(None)


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
