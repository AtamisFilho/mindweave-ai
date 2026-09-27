"""Testes da persistência: CRUD, versionamento otimista, índice FTS5 e busca."""
import pytest
from sqlalchemy import text

from app.db import engine
from app.services import maps_service
from app.services.maps_service import MapVersionConflict

DOC = {"nodes": [{"id": "n1", "data": {"label": "Machine Learning"}}], "edges": []}


def _doc(label):
    return {"nodes": [{"id": "n1", "data": {"label": label}}], "edges": []}


async def test_criar_e_carregar_mapa():
    created = maps_service.create_map("Meu mapa", DOC)
    assert created["title"] == "Meu mapa"
    assert created["version"] == 1
    assert created["document"] == DOC
    assert created["node_count"] == 1

    loaded = maps_service.get_map(created["id"])
    assert loaded == created


async def test_list_ordenado_por_updated_at():
    a = maps_service.create_map("Antigo", DOC)
    maps_service.create_map("Recente", DOC)
    maps_service.save_map(a["id"], "Antigo atualizado", DOC, a["version"])
    listed = maps_service.list_maps()
    assert [m["title"] for m in listed] == ["Antigo atualizado", "Recente"]


async def test_save_incrementa_versao_e_atualiza_updated_at():
    created = maps_service.create_map("Mapa", DOC)
    before = created["updated_at"]
    saved = maps_service.save_map(created["id"], "Mapa v2", DOC, created["version"])
    assert saved["version"] == 2
    assert saved["updated_at"] >= before
    assert saved["title"] == "Mapa v2"


async def test_save_com_versao_divergente_409():
    created = maps_service.create_map("Mapa", DOC)
    # Outra "aba" salvou primeiro:
    maps_service.save_map(created["id"], "Da outra aba", DOC, created["version"])
    with pytest.raises(MapVersionConflict) as exc:
        maps_service.save_map(created["id"], "Da minha aba", DOC, created["version"])
    assert exc.value.current_version == 2


async def test_save_mapa_inexistente_retorna_none():
    assert maps_service.save_map("fantasma", "T", DOC, None) is None


async def test_delete_remove_mapa_e_indice():
    created = maps_service.create_map("Mapa", DOC)
    assert maps_service.delete_map(created["id"]) is True
    assert maps_service.get_map(created["id"]) is None
    with engine.begin() as conn:
        count = conn.execute(
            text("SELECT COUNT(*) FROM node_index WHERE map_id = :m"), {"m": created["id"]}
        ).scalar()
    assert count == 0
    assert maps_service.delete_map(created["id"]) is False


async def test_indice_reconstruido_no_save():
    created = maps_service.create_map("Mapa", _doc("Rótulo antigo"))
    maps_service.save_map(created["id"], "Mapa", _doc("Rótulo novo"), created["version"])
    # o índice reflete o rótulo NOVO (rebuild, não append)
    hits = maps_service.search_nodes("Rótulo novo")
    assert any(h["map_id"] == created["id"] for h in hits)
    assert maps_service.search_nodes("Rótulo antigo") == []


async def test_busca_fts_case_e_acento_insensivel():
    maps_service.create_map("Mapa", _doc("Machine Learning"))
    assert maps_service.search_nodes("machine learning")
    assert maps_service.search_nodes("MACHINE")
    # unicode61 remove acentos: "nao" acha "não"
    accent = maps_service.create_map("Acentos", _doc("Não supervisionado"))
    assert any(h["map_id"] == accent["id"] for h in maps_service.search_nodes("nao"))


async def test_busca_query_vazia():
    maps_service.create_map("Mapa", DOC)
    assert maps_service.search_nodes("") == []
    assert maps_service.search_nodes("   ") == []


async def test_last_map_retorna_mais_recente():
    assert maps_service.last_map() is None  # Fricção Zero: 404 -> frontend cria novo
    maps_service.create_map("Primeiro", DOC)
    segundo = maps_service.create_map("Segundo", DOC)
    assert maps_service.last_map()["id"] == segundo["id"]
    maps_service.save_map(segundo["id"], "Segundo tocado", DOC, segundo["version"])
    assert maps_service.last_map()["title"] == "Segundo tocado"
