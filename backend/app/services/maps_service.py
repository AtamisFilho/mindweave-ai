"""Repositório de mapas: documento canônico + índice FTS5 derivado.

O save reconstrói o índice de texto numa única transação — o custo de N
inserts por autosave (debounce ~1s) é ruído para o SQLite, e o ganho é
busca global (v1.0) e extração de contexto para IA (v0.4) via SQL puro.
"""
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from app.db import SessionLocal
from app.models_db import MapRow, utcnow


class MapVersionConflict(Exception):
    """A versão enviada pelo cliente diverge da persistida (outra aba salvou)."""

    def __init__(self, current_version: int):
        self.current_version = current_version
        super().__init__(f"Versão divergente (atual: {current_version})")


def _iso(dt: datetime) -> str:
    # SQLite DateTime não preserva o offset no round-trip; tudo é UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _row_to_meta(row: MapRow, node_count: int = 0) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "version": row.version,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "node_count": node_count,
    }


def _row_to_full(row: MapRow, node_count: int = 0) -> dict:
    meta = _row_to_meta(row, node_count)
    meta["document"] = json.loads(row.document)
    return meta


def _node_counts(session) -> dict[str, int]:
    result = session.execute(text("SELECT map_id, COUNT(*) FROM node_index GROUP BY map_id"))
    return {row.map_id: row[1] for row in result}


def rebuild_index(session, map_id: str, document: dict) -> int:
    session.execute(text("DELETE FROM node_index WHERE map_id = :m"), {"m": map_id})
    rows = [
        {
            "node_id": node["id"],
            "map_id": map_id,
            "node_text": (node.get("data") or {}).get("label") or "",
        }
        for node in document.get("nodes", [])
        if node.get("id")
    ]
    if rows:
        session.execute(
            text("INSERT INTO node_index (node_id, map_id, node_text) "
                 "VALUES (:node_id, :map_id, :node_text)"),
            rows,
        )
    return len(rows)


def create_map(title: str, document: dict) -> dict:
    map_id = uuid.uuid4().hex[:12]
    with SessionLocal() as session:
        row = MapRow(id=map_id, title=title, document=json.dumps(document, ensure_ascii=False))
        session.add(row)
        session.flush()
        indexed = rebuild_index(session, map_id, document)
        session.commit()
        return _row_to_full(row, indexed)


def get_map(map_id: str) -> dict | None:
    with SessionLocal() as session:
        row = session.get(MapRow, map_id)
        if not row:
            return None
        count = session.execute(
            text("SELECT COUNT(*) FROM node_index WHERE map_id = :m"), {"m": map_id}
        ).scalar()
        return _row_to_full(row, count or 0)


def list_maps() -> list[dict]:
    with SessionLocal() as session:
        counts = _node_counts(session)
        rows = session.query(MapRow).order_by(MapRow.updated_at.desc()).all()
        return [_row_to_meta(row, counts.get(row.id, 0)) for row in rows]


def last_map() -> dict | None:
    """Último mapa editado (regra da Fricção Zero, server-side)."""
    with SessionLocal() as session:
        row = session.query(MapRow).order_by(MapRow.updated_at.desc()).first()
        if not row:
            return None
        count = session.execute(
            text("SELECT COUNT(*) FROM node_index WHERE map_id = :m"), {"m": row.id}
        ).scalar()
        return _row_to_full(row, count or 0)


def save_map(map_id: str, title: str, document: dict, expected_version: int | None) -> dict | None:
    with SessionLocal() as session:
        row = session.get(MapRow, map_id)
        if not row:
            return None
        if expected_version is not None and expected_version != row.version:
            raise MapVersionConflict(row.version)
        row.title = title
        row.document = json.dumps(document, ensure_ascii=False)
        row.version += 1
        row.updated_at = utcnow()
        session.flush()
        indexed = rebuild_index(session, map_id, document)
        session.commit()
        return _row_to_full(row, indexed)


def delete_map(map_id: str) -> bool:
    with SessionLocal() as session:
        row = session.get(MapRow, map_id)
        if not row:
            return False
        session.delete(row)
        session.execute(text("DELETE FROM node_index WHERE map_id = :m"), {"m": map_id})
        session.commit()
        return True


def search_nodes(query: str, limit: int = 50) -> list[dict]:
    """Busca FTS5 com prefixo: 'machine' acha 'Machine Learning' (unicode61
    remove acentos/caixa). Consulta v0.1 da busca global da v1.0."""
    cleaned = query.strip().replace('"', " ")
    if not cleaned:
        return []
    with SessionLocal() as session:
        result = session.execute(
            text("SELECT node_id, map_id, node_text FROM node_index "
                 "WHERE node_index MATCH :q LIMIT :l"),
            {"q": f'"{cleaned}"*', "l": limit},
        )
        return [
            {"node_id": r.node_id, "map_id": r.map_id, "node_text": r.node_text}
            for r in result
        ]
