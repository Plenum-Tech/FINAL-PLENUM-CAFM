"""
BE1 — UDR agent tools: direct database access for user lookup, schema discovery,
and generic table queries.
Two-gate SQL injection protection: regex + parameterised queries only.
"""
import re
import time
from typing import Any

import httpx
import structlog
from langchain_core.tools import tool
from sqlalchemy import text

from .. import database
from ..config import settings
from ..http_client import request as _request

log = structlog.get_logger(__name__)

_SAFE_IDENT = re.compile(r"^[a-z_][a-z0-9_]{0,63}$")
_MAX_ROWS = 100

# Schema cache: avoid re-querying information_schema on every session.
# Refreshes every 5 minutes so DDL changes are picked up without a restart.
_schema_cache: dict | None = None
_schema_cache_at: float = 0.0
_SCHEMA_TTL = 300  # seconds
_TIMEOUT = 60.0
_SERVICE = "udr"


@tool
async def get_schema() -> dict:
    """Return the live database schema for the plenum_cafm schema.

    Queries information_schema to return every table and its columns (with data
    types). Always call this FIRST before any query_table or compliance call so
    you know the exact table names and column names that exist right now.

    Returns a dict:
      {
        "tables": {
          "<table_name>": ["col1 (type)", "col2 (type)", ...],
          ...
        }
      }

    Result is cached for 5 minutes so repeated calls within a session are free.
    """
    global _schema_cache, _schema_cache_at

    now = time.monotonic()
    if _schema_cache is not None and (now - _schema_cache_at) < _SCHEMA_TTL:
        log.debug("udr.get_schema.cache_hit")
        return _schema_cache

    async with database.AsyncSessionLocal() as session:
        try:
            rows = (await session.execute(
                text("""
                    SELECT
                        c.table_name,
                        c.column_name,
                        c.data_type
                    FROM information_schema.columns c
                    JOIN information_schema.tables t
                        ON t.table_name  = c.table_name
                       AND t.table_schema = c.table_schema
                    WHERE c.table_schema = 'plenum_cafm'
                      AND t.table_type   = 'BASE TABLE'
                    ORDER BY c.table_name, c.ordinal_position
                """),
            )).mappings().all()
        except Exception as exc:
            log.error("udr.get_schema.error", error=str(exc))
            return {"error": str(exc)}

    tables: dict[str, list[str]] = {}
    for row in rows:
        tbl = row["table_name"]
        col = f"{row['column_name']} ({row['data_type']})"
        tables.setdefault(tbl, []).append(col)

    result = {"tables": tables}
    _schema_cache = result
    _schema_cache_at = now
    log.info("udr.get_schema.refreshed", table_count=len(tables))
    return result


@tool
async def lookup_user(user_id: str) -> dict:
    """Look up a CAFM platform user by their UUID.

    Returns the user's name, email, roles list, department, and phone number.
    Use this whenever you need to resolve who a user is or what permissions they hold.

    Args:
        user_id: UUID string of the user to look up.
    """
    async with database.AsyncSessionLocal() as session:
        try:
            result = await session.execute(
                text("""
                    SELECT u.id, u.full_name, u.email, u.department, u.phone,
                           array_agg(r.name) FILTER (WHERE r.name IS NOT NULL) AS roles
                    FROM plenum_cafm.users u
                    LEFT JOIN plenum_cafm.user_roles ur ON ur.user_id = u.id
                    LEFT JOIN plenum_cafm.roles r ON r.id = ur.role_id
                    WHERE u.id = :user_id
                    GROUP BY u.id, u.full_name, u.email, u.department, u.phone
                """),
                {"user_id": user_id},
            )
            row = result.mappings().one_or_none()
        except Exception as exc:
            log.error("udr.lookup_user.error", user_id=user_id, error=str(exc))
            return {"error": str(exc)}

    if row is None:
        return {"error": f"User {user_id!r} not found"}

    return {
        "user_id": str(row["id"]),
        "name": row["full_name"],
        "email": row["email"],
        "department": row["department"],
        "phone": row["phone"],
        "roles": list(row["roles"] or []),
    }


@tool
async def query_table(table_name: str, filters: dict[str, Any] | None = None) -> list[dict]:
    """Query any table in the plenum_cafm schema with optional equality filters.

    Returns up to 100 records as a list of dicts. Use this to inspect live data
    in any CAFM table. All identifiers are validated before execution.

    Always call get_schema() first so you use the correct table_name and
    column names — never guess them.

    Args:
        table_name: Exact table name in plenum_cafm as returned by get_schema().
        filters: Optional dict of {column_name: value} equality filters.
                 Column names must match what get_schema() returned for this table.
    """
    if not _SAFE_IDENT.match(table_name):
        log.warning("udr.query_table.unsafe_table", table=table_name)
        return [{"error": f"Unsafe table name: {table_name!r}"}]

    params: dict[str, Any] = {}
    where_clause = ""

    if filters:
        conditions: list[str] = []
        for col, val in filters.items():
            if not _SAFE_IDENT.match(col):
                log.warning("udr.query_table.unsafe_column", column=col)
                return [{"error": f"Unsafe column name: {col!r}"}]
            param_key = f"p_{col}"
            conditions.append(f"{col} = :{param_key}")
            params[param_key] = val
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

    sql = f"SELECT * FROM plenum_cafm.{table_name} {where_clause} LIMIT {_MAX_ROWS}"

    async with database.AsyncSessionLocal() as session:
        try:
            result = await session.execute(text(sql), params)
            rows = result.mappings().all()
            return [dict(r) for r in rows]
        except Exception as exc:
            log.error("udr.query_table.error", table=table_name, error=str(exc))
            return [{"error": str(exc)}]


def _err(exc: Exception, op: str) -> dict:
    if isinstance(exc, httpx.HTTPStatusError):
        log.error(f"udr.{op}.http_error", status=exc.response.status_code, body=exc.response.text[:300])
        return {"error": exc.response.text[:300], "status_code": exc.response.status_code}
    log.error(f"udr.{op}.error", error=str(exc)[:300])
    return {"error": str(exc)[:300]}


@tool
async def udr_agent_query(message: str) -> dict:
    """Run a natural-language UDR query via svc-udr agent endpoint.

    Use this for complex ad-hoc UDR requests where structured parameters are not
    known upfront; svc-udr will decide the sequence of list/describe/read/write.
    """
    try:
        resp = await _request(
            "POST",
            settings.udr_base_url,
            "/api/agent/query",
            service=_SERVICE,
            timeout=_TIMEOUT,
            json={"message": message},
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "agent_query")


@tool
async def udr_list_tables() -> dict:
    """List all UDR-exposed tables with row-count metadata."""
    try:
        resp = await _request(
            "GET",
            settings.udr_base_url,
            "/api/tables/",
            service=_SERVICE,
            timeout=_TIMEOUT,
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "list_tables")


@tool
async def udr_describe_table(table: str) -> dict:
    """Describe table schema details including keys and relationships."""
    try:
        resp = await _request(
            "GET",
            settings.udr_base_url,
            f"/api/tables/{table}/schema",
            service=_SERVICE,
            timeout=_TIMEOUT,
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "describe_table")


_MAX_READ_LIMIT = 500


@tool
async def udr_read_records(
    table: str,
    limit: int = 50,
    offset: int = 0,
    order_by: str | None = None,
    order_dir: str = "asc",
) -> dict:
    """Read records from a table with pagination and optional sorting (max 500 rows per call).

    For larger datasets use offset paging or write_file Mode 3 offload.
    """
    params: dict[str, Any] = {
        "limit": min(max(limit, 1), _MAX_READ_LIMIT),
        "offset": max(offset, 0),
        "order_dir": order_dir,
    }
    if order_by:
        params["order_by"] = order_by
    try:
        resp = await _request(
            "GET",
            settings.udr_base_url,
            f"/api/tables/{table}/records",
            service=_SERVICE,
            timeout=_TIMEOUT,
            params=params,
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "read_records")


@tool
async def udr_get_record(table: str, record_id: str, id_column: str = "id") -> dict:
    """Fetch one record by primary key."""
    try:
        resp = await _request(
            "GET",
            settings.udr_base_url,
            f"/api/tables/{table}/records/{record_id}",
            service=_SERVICE,
            timeout=_TIMEOUT,
            params={"id_column": id_column},
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "get_record")


@tool
async def udr_search_records(
    table: str,
    search_term: str,
    search_columns: list[str],
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Search records using case-insensitive partial matches across columns."""
    try:
        resp = await _request(
            "POST",
            settings.udr_base_url,
            f"/api/tables/{table}/records/search",
            service=_SERVICE,
            timeout=_TIMEOUT,
            json={
                "search_term": search_term,
                "search_columns": search_columns,
                "limit": limit,
                "offset": offset,
            },
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "search_records")


@tool
async def udr_create_record(table: str, data: dict[str, Any]) -> dict:
    """Create a record in a UDR table."""
    try:
        resp = await _request(
            "POST",
            settings.udr_base_url,
            f"/api/tables/{table}/records",
            service=_SERVICE,
            timeout=_TIMEOUT,
            max_attempts=1,
            json={"data": data},
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "create_record")


@tool
async def udr_update_record(
    table: str,
    record_id: str,
    data: dict[str, Any],
    id_column: str = "id",
) -> dict:
    """Update fields on a record in a UDR table."""
    try:
        resp = await _request(
            "PATCH",
            settings.udr_base_url,
            f"/api/tables/{table}/records/{record_id}",
            service=_SERVICE,
            timeout=_TIMEOUT,
            max_attempts=1,
            json={"data": data, "id_column": id_column},
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "update_record")


@tool
async def udr_delete_record(table: str, record_id: str, id_column: str = "id") -> dict:
    """Delete a record from a UDR table by primary key."""
    try:
        resp = await _request(
            "DELETE",
            settings.udr_base_url,
            f"/api/tables/{table}/records/{record_id}",
            service=_SERVICE,
            timeout=_TIMEOUT,
            max_attempts=1,
            params={"id_column": id_column},
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "delete_record")


@tool
async def udr_execute_select(sql: str, params: dict[str, Any] | None = None) -> dict:
    """Execute a custom SELECT statement through UDR with safety checks."""
    try:
        resp = await _request(
            "POST",
            settings.udr_base_url,
            "/api/tables/query/select",
            service=_SERVICE,
            timeout=_TIMEOUT,
            json={"sql": sql, "params": params or {}},
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "execute_select")
