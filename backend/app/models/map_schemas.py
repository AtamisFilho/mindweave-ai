"""Schemas Pydantic da API de mapas."""
from typing import Any

from pydantic import BaseModel, Field


class MapSaveRequest(BaseModel):
    title: str = "Mapa sem título"
    document: dict[str, Any] = Field(default_factory=lambda: {"nodes": [], "edges": []})
    # Concorrência otimista: se divergir da versão no banco -> 409 MAP_VERSION_CONFLICT
    expected_version: int | None = None


class MapMetaOut(BaseModel):
    id: str
    title: str
    version: int
    created_at: str
    updated_at: str
    node_count: int = 0


class MapFullOut(MapMetaOut):
    document: dict[str, Any]
