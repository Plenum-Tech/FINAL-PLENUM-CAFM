"""Database connection and session management.

Async session factory for query operations.
Sync connection string getter for PostgresSaver checkpointer (requires psycopg2, not asyncpg).
"""

import logging
import ssl
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from .config import get_settings

# Silence SQLAlchemy's per-query SQL output at module load time so it takes
# effect before any engine is created and before configure_logging() runs.
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine.Engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.dialects").setLevel(logging.WARNING)


def _suppress_sql_loggers() -> None:
    """Force SQLAlchemy loggers to WARNING.

    Must be called after every engine creation because SQLAlchemy's echo=False
    resets the engine logger to NOTSET (inherits from root), undoing any earlier
    suppression.  Calling here guarantees it runs after the engine is built.
    """
    for name in (
        "sqlalchemy.engine",
        "sqlalchemy.engine.Engine",
        "sqlalchemy.pool",
        "sqlalchemy.dialects",
        "sqlalchemy.orm",
    ):
        logging.getLogger(name).setLevel(logging.WARNING)


def _async_engine_connect_args(db_url: str) -> dict:
    """Build asyncpg connect_args; strip sslmode from URL query (asyncpg rejects it)."""
    parsed = urlparse(db_url)
    host = parsed.hostname or ""
    qs = parse_qs(parsed.query, keep_blank_values=True)
    sslmode = (qs.pop("sslmode", [None])[0] or "").lower()
    needs_ssl = sslmode in ("require", "verify-ca", "verify-full") or (
        not sslmode and ("postgres.database.azure.com" in host or ".azure." in host)
    )
    return {"ssl": ssl.create_default_context()} if needs_ssl else {}


def _strip_sslmode_from_async_url(db_url: str) -> str:
    parsed = urlparse(db_url)
    qs = parse_qs(parsed.query, keep_blank_values=True)
    qs.pop("sslmode", None)
    flat = {k: v[-1] if v else "" for k, v in qs.items()}
    query = urlencode(flat)
    return urlunparse(parsed._replace(query=query))


def get_async_engine():
    """Create async SQLAlchemy engine."""
    settings = get_settings()
    db_url = _strip_sslmode_from_async_url(settings.db_url)
    connect_args = _async_engine_connect_args(settings.db_url)

    # NullPool doesn't support pool_size/max_overflow parameters
    if settings.environment == "development":
        engine = create_async_engine(
            db_url,
            echo=False,
            poolclass=NullPool,
            connect_args=connect_args,
        )
    else:
        engine = create_async_engine(
            db_url,
            echo=False,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            connect_args=connect_args,
        )
    _suppress_sql_loggers()
    return engine


def get_async_session_factory():
    """Get async session factory."""
    engine = get_async_engine()
    return async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )


async def get_async_session() -> AsyncSession:
    """Get async database session (dependency injection)."""
    session_factory = get_async_session_factory()
    async with session_factory() as session:
        yield session


async def get_plenum_cafm_columns_by_table() -> dict[str, set[str]]:
    """Map each plenum_cafm base table → its column names (lowercased).

    Used to constrain field matching to the routed target table's columns, so a
    source column only maps to a column that actually exists on its target table.
    Best-effort: returns {} on any failure (callers then skip the constraint).
    """
    out: dict[str, set[str]] = {}
    try:
        session_factory = get_async_session_factory()
        async with session_factory() as session:
            res = await session.execute(
                text(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = 'plenum_cafm' "
                    "ORDER BY table_name, ordinal_position"
                )
            )
            for tbl, col in res.fetchall():
                out.setdefault(str(tbl).lower(), set()).add(str(col).lower())
    except Exception:
        logging.getLogger(__name__).warning(
            "[db] get_plenum_cafm_columns_by_table failed — matching will not be constrained",
            exc_info=True,
        )
    return out


def get_sync_db_url() -> str:
    """Get synchronous database connection string for PostgresSaver.

    PostgresSaver requires a sync psycopg connection, not asyncpg.
    Strips the SQLAlchemy driver prefix and ensures Azure Postgres gets sslmode=require.
    """
    settings = get_settings()
    url = settings.db_url.replace("postgresql+asyncpg://", "postgresql://")
    url = url.replace("postgresql+psycopg://", "postgresql://")

    if "sslmode=" not in url and (
        "postgres.database.azure.com" in url
        or ".azure." in url
    ):
        url = f"{url}{'&' if '?' in url else '?'}sslmode=require"

    return url
