"""
Phase 5 — Hybrid UDR tools: structured DB + document vector evidence + cross-source links.
"""
from __future__ import annotations

from langchain_core.tools import tool

from .doc_rag_agent import query_docs, semantic_search
from .meta_tools import get_session_context
from .session_workspace import workspace_snapshot
from .udr_agent import get_schema, udr_read_records


@tool
async def retrieve_workspace_corpus_summary() -> dict:
    """Summarize the current workspace ingestion and UDR readiness (Phase 5 hybrid register)."""
    session_id = get_session_context()
    if not session_id or session_id == "shared":
        return {"error": "No active session"}
    snap = workspace_snapshot(session_id)
    schema = await get_schema.ainvoke({})
    table_count = len((schema.get("tables") or {})) if isinstance(schema, dict) else 0
    return {
        "session_id": session_id,
        "workspace": snap,
        "plenum_cafm_table_count": table_count,
        "guidance": (
            "Use retrieve_vector_evidence for document-backed facts; "
            "udr_read_records / query_table for structured rows."
        ),
    }


@tool
async def retrieve_vector_evidence(query: str, top_k: int = 8) -> dict:
    """Retrieve semantic document chunks (unstructured path) for the workspace corpus."""
    _ = top_k
    return await semantic_search.ainvoke({"query": query})


@tool
async def resolve_cross_source_links(
    entity_hint: str,
    query: str,
    table: str = "assets",
    id_column: str = "asset_code",
) -> dict:
    """Link structured UDR rows with unstructured document evidence for one entity (Phase 5)."""
    structured = await udr_read_records.ainvoke(
        {
            "table": table,
            "limit": 10,
            "offset": 0,
        }
    )
    vector = await query_docs.ainvoke({"query": f"{entity_hint} {query}", "top_k": 5})
    return {
        "entity_hint": entity_hint,
        "structured_sample": structured,
        "document_answer": vector,
        "note": "Filter structured rows client-side by entity_hint; citations are in document_answer.",
    }
