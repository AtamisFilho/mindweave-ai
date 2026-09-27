"""Endpoints da API de mapas (prefixo /api/v1/maps).

Rotas literais (/last, /search) declaradas ANTES de /{map_id}.
"""
from fastapi import APIRouter, Body, HTTPException

from app.models.map_schemas import MapFullOut, MapMetaOut, MapSaveRequest
from app.services import maps_service
from app.services.maps_service import MapVersionConflict

router = APIRouter()


@router.get("", response_model=list[MapMetaOut])
async def list_maps():
    return maps_service.list_maps()


@router.post("", response_model=MapFullOut, status_code=201)
async def create_map(request: MapSaveRequest = Body(...)):
    return maps_service.create_map(request.title, request.document)


@router.get("/last", response_model=MapFullOut)
async def last_map():
    result = maps_service.last_map()
    if not result:
        raise HTTPException(status_code=404, detail="Nenhum mapa salvo ainda.")
    return result


@router.get("/search")
async def search_nodes(q: str, limit: int = 50):
    return maps_service.search_nodes(q, limit)


@router.get("/{map_id}", response_model=MapFullOut)
async def get_map(map_id: str):
    result = maps_service.get_map(map_id)
    if not result:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")
    return result


@router.put("/{map_id}", response_model=MapFullOut)
async def save_map(map_id: str, request: MapSaveRequest = Body(...)):
    try:
        result = maps_service.save_map(
            map_id, request.title, request.document, request.expected_version
        )
    except MapVersionConflict as exc:
        # Handler global converte para 409 com payload estruturado
        raise exc
    if not result:
        raise HTTPException(status_code=404, detail="Mapa não encontrado (excluído em outra sessão?).")
    return result


@router.delete("/{map_id}", status_code=204)
async def delete_map(map_id: str):
    if not maps_service.delete_map(map_id):
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")
