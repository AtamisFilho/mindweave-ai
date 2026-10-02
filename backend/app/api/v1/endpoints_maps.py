"""Endpoints da API de mapas (prefixo /api/v1/maps).

Rotas literais (/last, /search, /{map_id}/export/markdown) declaradas
ANTES de /{map_id}.
"""
import re

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import Response

from app.models.map_schemas import MapFullOut, MapMetaOut, MapSaveRequest
from app.services import context_builder, maps_service
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


_FILENAME_BAD = r'[\\/:*?"<>|]'


def _markdown_filename(title: str) -> str:
    """Título sanitizado p/ filename; fallback se sobrar vazio."""
    clean = re.sub(_FILENAME_BAD, "", title or "").strip()
    return clean or "mapa-sem-titulo"


@router.get("/{map_id}/export/markdown")
async def export_map_markdown(map_id: str):
    """Export Markdown (v0.6.0 B2): a MESMA travessia do contexto do chat
    (context_builder._outline), sem orçamento nem teto de profundidade —
    export ≡ chat na projeção; cross-links aparecem em cada ramo."""
    result = maps_service.get_map(map_id)
    if not result:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")
    document = result.get("document") or {}
    text, _, _ = context_builder._outline(
        document.get("nodes", []), document.get("edges", []),
        budget=10**9, max_depth=None,
    )
    title = result.get("title") or "Mapa sem título"
    body = f"# {title}\n\n{text}\n" if text else f"# {title}\n"
    filename = _markdown_filename(title)
    return Response(
        content=body,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.md"'},
    )


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
