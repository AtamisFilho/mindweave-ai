"""Engine SQLite + base do ORM.

PRAGMAs obrigatórios por conexão: foreign_keys (OFF por default no SQLite!)
e WAL para leituras concorrentes. O índice FTS5 (node_index) é criado via
DDL cru — ORMs não têm suporte nativo a virtual tables.
"""
import os

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mindweave.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def init_db():
    """Cria as tabelas e o índice FTS5 (idempotente)."""
    import app.models_db  # noqa: F401 — registra os mapeamentos no Base

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS node_index USING fts5("
            "node_id UNINDEXED, map_id UNINDEXED, node_text)"
        ))
