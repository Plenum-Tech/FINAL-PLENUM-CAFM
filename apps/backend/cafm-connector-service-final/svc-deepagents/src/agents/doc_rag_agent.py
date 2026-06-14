"""
Doc RAG agent tools — wraps schema-mapper Doc RAG endpoints.
Handles document indexing, semantic search, text extraction, and metadata queries.
"""
import asyncio
import json
import mimetypes
import random
from pathlib import Path
from typing import Any

import httpx
import structlog
from langchain_core.tools import tool

from ..config import settings
from ..http_client import request as _request

log = structlog.get_logger(__name__)

_TIMEOUT = 60.0
_INDEX_TIMEOUT = 180.0
_SERVICE = "doc_rag"


def _err(exc: Exception, op: str) -> dict:
    if isinstance(exc, httpx.HTTPStatusError):
        log.error(f"doc_rag.{op}.http_error", status=exc.response.status_code, body=exc.response.text[:300])
        return {"error": exc.response.text[:300], "status_code": exc.response.status_code}
    msg = (str(exc) or exc.__class__.__name__)[:300]
    log.error(f"doc_rag.{op}.error", error=msg)
    return {"error": msg}


def _is_overloaded_error(exc: Exception) -> bool:
    if "overloaded" in str(exc).lower():
        return True
    if not isinstance(exc, httpx.HTTPStatusError):
        return False
    body = (exc.response.text or "").lower()
    if "overloaded_error" in body or "overloaded" in body:
        return True
    try:
        payload = exc.response.json()
    except (ValueError, json.JSONDecodeError):
        return False
    return "overloaded" in str(payload).lower()


def _is_retryable_transport_error(exc: Exception) -> bool:
    if isinstance(exc, (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.PoolTimeout)):
        return True
    return "timeout" in str(exc).lower()


@tool
async def index_document(file_path: str, document_type: str = "auto") -> dict:
    """Upload and index a document into the RAG store for future semantic search.

    Supported types: pdf, docx, txt, png, jpg, jpeg, webp, tif, tiff, gif, and 'auto'.
    The document is extracted, chunked, embedded, and stored in pgvector.
    Returns a document_id for future reference.

    Args:
        file_path: Absolute path to the document on the server filesystem.
        document_type: Hint — pdf, docx, txt, scan, image, or auto.
    """
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return {"error": f"File not found: {file_path}"}

    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    ext = path.suffix.lower()
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".tif", ".tiff"}:
        if ext == ".jpg":
            mime_type = "image/jpeg"
        elif ext in {".tif", ".tiff"}:
            mime_type = "image/tiff"
        elif not mime_type.startswith("image/"):
            mime_type = f"image/{ext.lstrip('.')}"

    # Primary path (current schema-mapper doc-rag API): multipart upload.
    # If provider returns overloaded_error, perform controlled retries.
    file_bytes = path.read_bytes()
    max_attempts = 5
    for attempt in range(max_attempts):
        try:
            resp = await _request(
                "POST",
                settings.doc_rag_base_url,
                "/doc-rag/documents/upload",
                service=_SERVICE,
                timeout=_INDEX_TIMEOUT,
                files={"file": (path.name, file_bytes, mime_type)},
                max_attempts=1,
            )
            return resp.json()
        except Exception as exc:
            if attempt < max_attempts - 1 and (_is_overloaded_error(exc) or _is_retryable_transport_error(exc)):
                # Exponential backoff + jitter to smooth concurrent retries.
                delay_s = min(2.0 ** (attempt + 1), 20.0) + random.uniform(0.0, 0.5)
                log.warning(
                    "doc_rag.index.retry",
                    file=path.name,
                    attempt=attempt + 1,
                    delay_s=round(delay_s, 2),
                    reason=exc.__class__.__name__,
                )
                await asyncio.sleep(delay_s)
                continue
            # Backward-compatible fallback for standalone doc-rag deployments.
            try:
                resp = await _request(
                    "POST",
                    settings.doc_rag_base_url,
                    "/documents/upload",
                    service=_SERVICE,
                    timeout=_INDEX_TIMEOUT,
                    files={"file": (path.name, file_bytes, mime_type)},
                    max_attempts=1,
                )
                return resp.json()
            except Exception:
                return _err(exc, "index")
    return {"error": "Document indexing failed after retries (overload/timeout). Please retry shortly."}


@tool
async def query_docs(query: str, top_k: int = 5) -> dict:
    """Ask a natural language question and get an answer grounded in indexed documents.

    The RAG service retrieves the most relevant document chunks and synthesises
    a grounded answer. Always returns source citations.

    Args:
        query: Plain English question about documents (e.g. 'What does the AHU manual say about belt tension?').
        top_k: Number of document chunks to retrieve (default 5, max 20).
    """
    payload = {"query": query, "top_k": min(top_k, 20)}
    try:
        resp = await _request(
            "POST",
            settings.doc_rag_base_url,
            "/doc-rag/rag/query",
            service=_SERVICE,
            timeout=_TIMEOUT,
            json=payload,
        )
        return resp.json()
    except Exception as exc:
        try:
            resp = await _request(
                "POST",
                settings.doc_rag_base_url,
                "/api/query",
                service=_SERVICE,
                timeout=_TIMEOUT,
                json=payload,
            )
            return resp.json()
        except Exception:
            return _err(exc, "query")


@tool
async def semantic_search(query: str, filter_type: str | None = None) -> list[dict]:
    """Search indexed documents by semantic similarity and return matching chunks.

    Unlike query_docs, this returns raw chunks without answer synthesis —
    useful when you want to see all relevant passages, not a summarised answer.

    Args:
        query: Search query string.
        filter_type: Optional document type to restrict search ('pdf', 'docx', 'txt').
    """
    payload: dict = {"query": query}
    if filter_type:
        payload["filter_type"] = filter_type

    try:
        # New API doesn't expose /api/search; use rag/query and return sources/chunks.
        resp = await _request(
            "POST",
            settings.doc_rag_base_url,
            "/doc-rag/rag/query",
            service=_SERVICE,
            timeout=_TIMEOUT,
            json={"query": query, "top_k": 8},
        )
        body = resp.json()
        if isinstance(body, dict) and "sources" in body and isinstance(body["sources"], list):
            return body["sources"]
        return [body] if isinstance(body, dict) else body
    except Exception as exc:
        try:
            resp = await _request(
                "POST",
                settings.doc_rag_base_url,
                "/api/search",
                service=_SERVICE,
                timeout=_TIMEOUT,
                json=payload,
            )
            return resp.json()
        except Exception:
            return [_err(exc, "search")]


@tool
async def extract_text(file_path: str) -> dict:
    """Extract raw text from a PDF or DOCX file without indexing it.

    Use this when you need to read a document's content once without
    storing it in the vector store. Returns the full extracted text.

    Args:
        file_path: Absolute path to the PDF or DOCX file.
    """
    try:
        resp = await _request(
            "POST", settings.doc_rag_base_url, "/api/documents/extract",
            service=_SERVICE, timeout=_TIMEOUT,
            json={"file_path": file_path},
        )
        return resp.json()
    except Exception as exc:
        return _err(exc, "extract")


@tool
async def get_document_metadata(document_id: str) -> dict:
    """Get metadata for an indexed document: filename, type, page count, indexed_at, chunk count.

    Use this to verify a document is indexed before querying it.

    Args:
        document_id: UUID of the indexed document as returned by index_document.
    """
    try:
        resp = await _request(
            "GET",
            settings.doc_rag_base_url,
            f"/doc-rag/documents/{document_id}",
            service=_SERVICE,
            timeout=_TIMEOUT,
        )
        return resp.json()
    except Exception as exc:
        try:
            resp = await _request(
                "GET",
                settings.doc_rag_base_url,
                f"/api/documents/{document_id}",
                service=_SERVICE,
                timeout=_TIMEOUT,
            )
            return resp.json()
        except Exception:
            return _err(exc, "metadata")


@tool
async def delete_document(document_id: str) -> dict:
    """Remove a document and all its chunks from the RAG index.

    Use when a document is superseded, incorrect, or no longer relevant.
    This is irreversible — the document must be re-indexed to restore it.

    Args:
        document_id: UUID of the indexed document to delete.
    """
    try:
        resp = await _request(
            "DELETE",
            settings.doc_rag_base_url,
            f"/doc-rag/documents/{document_id}",
            service=_SERVICE,
            timeout=_TIMEOUT,
        )
        return resp.json()
    except Exception as exc:
        try:
            resp = await _request(
                "DELETE",
                settings.doc_rag_base_url,
                f"/api/documents/{document_id}",
                service=_SERVICE,
                timeout=_TIMEOUT,
            )
            return resp.json()
        except Exception:
            return _err(exc, "delete")


_MATCH_TIMEOUT = 180.0


@tool
async def list_row_index_tables() -> list[dict]:
    """List CMMS tables in the row semantic index used for document-to-row matching."""
    try:
        resp = await _request(
            "GET",
            settings.doc_rag_base_url,
            "/doc-rag/row-index/tables",
            service=_SERVICE,
            timeout=_TIMEOUT,
        )
        body = resp.json()
        return body if isinstance(body, list) else []
    except Exception as exc:
        return [_err(exc, "list_row_index_tables")]


@tool
async def list_doc_rag_db_tables() -> list[dict]:
    """List plenum_cafm database tables available to import into the row index."""
    try:
        resp = await _request(
            "GET",
            settings.doc_rag_base_url,
            "/doc-rag/row-index/db-tables",
            service=_SERVICE,
            timeout=_TIMEOUT,
        )
        body = resp.json()
        return body if isinstance(body, list) else []
    except Exception as exc:
        return [_err(exc, "list_doc_rag_db_tables")]


@tool
async def match_document_to_rows(
    document_id: str,
    source_table: str | None = None,
    confidence_threshold: float = 0.25,
    group_by_table: bool = True,
) -> dict:
    """Match an indexed document to CMMS row index entries (Doc RAG Match Schema tab).

    Returns matched rows with confidence, row_data columns, matched_fields,
    and per-chunk semantic_score / bm25_score / metadata_score (same as Doc RAG UI).

    Args:
        document_id: UUID from index_document.
        source_table: Optional table name filter (e.g. assets, equipment).
        confidence_threshold: Minimum match confidence 0.0–1.0 (default 0.25).
        group_by_table: Group results by source_table in response.
    """
    params: dict[str, Any] = {
        "confidence_threshold": confidence_threshold,
        "group_by_table": group_by_table,
    }
    if source_table:
        params["source_table"] = source_table
    try:
        resp = await _request(
            "POST",
            settings.doc_rag_base_url,
            f"/doc-rag/documents/{document_id}/match-rows",
            service=_SERVICE,
            timeout=_MATCH_TIMEOUT,
            params=params,
        )
        return resp.json()
    except Exception as exc:
        try:
            resp = await _request(
                "POST",
                settings.doc_rag_base_url,
                f"/documents/{document_id}/match-rows",
                service=_SERVICE,
                timeout=_MATCH_TIMEOUT,
                params=params,
            )
            return resp.json()
        except Exception:
            return _err(exc, "match_document_to_rows")
