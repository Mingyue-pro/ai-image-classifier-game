"""SQLite engine, table initialization, and request-scoped sessions."""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.database_models import Base


DATABASE_URL_ENVIRONMENT_VARIABLE = "AI_IMAGE_GAME_DATABASE_URL"
DEFAULT_DATABASE_PATH = Path("data/research/ai-image-game.db")
DEFAULT_DATABASE_URL = f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"


def configured_database_url() -> str:
    """Return an environment override or the persistent local SQLite URL."""
    return os.getenv(DATABASE_URL_ENVIRONMENT_VARIABLE, DEFAULT_DATABASE_URL)


def ensure_sqlite_parent_directory(database_url: str) -> None:
    """Create the parent directory for a file-backed SQLite database."""
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database:
        return
    if url.database == ":memory:":
        return
    Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)


def create_database_engine(database_url: str) -> Engine:
    """Create an engine and enable SQLite foreign-key enforcement."""
    url = make_url(database_url)
    is_sqlite = url.get_backend_name() == "sqlite"
    engine_arguments: dict[str, object] = {
        "connect_args": {"check_same_thread": False} if is_sqlite else {}
    }
    if is_sqlite and url.database == ":memory:":
        engine_arguments["poolclass"] = StaticPool
    database_engine = create_engine(database_url, **engine_arguments)

    if is_sqlite:

        @event.listens_for(database_engine, "connect")
        def enable_sqlite_foreign_keys(
            connection: sqlite3.Connection, connection_record: object
        ) -> None:
            del connection_record
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return database_engine


def create_session_factory(
    database_engine: Engine,
) -> sessionmaker[Session]:
    """Create the shared factory used to open short-lived database sessions."""
    return sessionmaker(
        bind=database_engine,
        autoflush=False,
        expire_on_commit=False,
    )


database_url = configured_database_url()
engine = create_database_engine(database_url)
SessionFactory = create_session_factory(engine)


def initialize_database(database_engine: Engine = engine) -> None:
    """Create the database directory and any tables that do not exist."""
    ensure_sqlite_parent_directory(database_engine.url.render_as_string(False))
    Base.metadata.create_all(bind=database_engine)


def get_database_session() -> Generator[Session, None, None]:
    """Yield one database session and always close it after the request."""
    with SessionFactory() as database_session:
        yield database_session
