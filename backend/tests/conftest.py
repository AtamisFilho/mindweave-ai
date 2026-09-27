"""Fixtures compartilhadas: banco isolado + estado de IA limpo entre testes."""
import os

# DATABASE_URL precisa existir ANTES do primeiro import de app.db
os.environ["DATABASE_URL"] = f"sqlite:///./test_mindweave_{os.getpid()}.db"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.api.v1 import endpoints_ai  # noqa: E402
from app.db import Base, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services import ai_service  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_database():
    """Banco zerado a cada teste (inclui o índice FTS5, fora do metadata)."""
    Base.metadata.drop_all(engine)
    init_db()
    yield
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM node_index"))
    Base.metadata.drop_all(engine)


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
