from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import structlog

from .meta_tools import get_session_context, set_session_context
from .session_workspace import (
    record_hierarchy_complete,
    record_mapping_complete,
    record_unstructured_register_ready,
    register_migration_file,
    register_migration_id,
    set_ingestion_mode_structured,
)
from ..config import settings
from .doc_rag_agent import (
    get_document_metadata,
    index_document,
    list_doc_rag_db_tables,
    list_row_index_tables,
    match_document_to_rows,
    query_docs,
    semantic_search,
)
from .migration_agent import (
    run_migration,
    start_migration,
    start_migration_multi,
    submit_field_mapping,
    submit_hierarchy,
    submit_pre_semantic,
)

log = structlog.get_logger(__name__)

STRUCTURED_EXTS = {".csv", ".xlsx", ".xls", ".xlsm"}
SCHEMA_EXTS = {".yaml", ".yml", ".json"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"}
DOCUMENT_EXTS = {".pdf", ".docx", ".doc", ".txt", *IMAGE_EXTS}

DEFAULT_DOC_RAG_QUERY = (
    "Summarize this document for CAFM: assets, locations, maintenance issues, "
    "dates, work order references, and recommended schema field mappings."
)


def document_type_hint(file_path: str) -> str:
    """Doc RAG document_type hint for uploads (auto | scan | image)."""
    path = Path(file_path)
    ext = path.suffix.lower()
    name_l = path.name.lower()
    if ext in {".tif", ".tiff"} or "scan" in name_l:
        return "scan"
    if ext in IMAGE_EXTS:
        return "image"
    return "auto"


@dataclass
class SingleDoorResult:
    summary_text: str
    tool_calls: list[dict[str, Any]]
    context_note: str
    step_summaries: list[str] = field(default_factory=list)
    match_report: str = ""


def _infer_source_tables(user_query: str | None, indexed_tables: list[str]) -> list[str | None]:
    """If the user names table(s), match only those; otherwise match all indexed tables."""
    if not indexed_tables:
        return [None]
    if not user_query:
        return [None]
    msg = user_query.lower()
    picked = [
        t
        for t in indexed_tables
        if t.lower() in msg or t.lower().replace("_", " ") in msg
    ]
    if picked:
        return picked
    return [None]


def format_matched_rows_report(match_result: dict[str, Any], *, max_rows: int = 20) -> str:
    """Human-readable report aligned with Doc RAG UI Match tab (RowCard details)."""
    if match_result.get("error"):
        return f"Row matching failed: {match_result.get('error')}"

    rows = match_result.get("matched_rows") or []
    if not isinstance(rows, list):
        rows = []

    lines = [
        "## Document → row matching",
        f"- Chunks analyzed: {match_result.get('total_chunks_analyzed', 0)}",
        f"- Unique rows matched: {match_result.get('unique_rows_matched', len(rows))}",
        f"- Latency: {match_result.get('latency_ms', 0)} ms",
    ]
    by_table = match_result.get("by_table") or {}
    if by_table:
        lines.append(
            "- By table: "
            + ", ".join(f"{k} ({v})" for k, v in sorted(by_table.items(), key=lambda x: -x[1]))
        )
    if match_result.get("source_table"):
        lines.append(f"- Filter: `{match_result.get('source_table')}`")

    if not rows:
        lines.append(
            "\nNo rows matched above threshold. Import CMMS tables into the row index "
            "(Doc RAG → Index tab) or lower the confidence threshold."
        )
        return "\n".join(lines)

    for row in rows[:max_rows]:
        if not isinstance(row, dict):
            continue
        table = row.get("source_table", "?")
        pk = row.get("row_pk", "?")
        conf = float(row.get("confidence") or 0)
        method = row.get("match_method", "")
        lines.append(f"\n### {table} · `{pk}` — **{conf:.0%}** ({method})")

        meta_fields = row.get("matched_metadata_fields") or []
        if meta_fields:
            lines.append(f"- Matched columns: {', '.join(str(f) for f in meta_fields)}")

        details = row.get("match_details") or {}
        if isinstance(details, dict) and details:
            lines.append(
                "- Scores: "
                f"semantic {float(details.get('semantic_score', 0)):.3f}, "
                f"bm25 {float(details.get('bm25_overlap', details.get('bm25_score', 0))):.3f}, "
                f"metadata {float(details.get('metadata_overlap', details.get('metadata_score', 0))):.3f}"
            )

        row_data = row.get("row_data") or {}
        if isinstance(row_data, dict) and row_data:
            lines.append("- Row fields:")
            for key, val in list(row_data.items())[:12]:
                lines.append(f"  - `{key}`: {val}")

        evidence = row.get("evidence")
        if evidence:
            lines.append(f"- Evidence: {str(evidence)[:300]}")

        chunk_matches = row.get("chunk_matches") or []
        if chunk_matches:
            lines.append("- Chunk matches:")
            for cm in chunk_matches[:5]:
                if not isinstance(cm, dict):
                    continue
                fields = cm.get("matched_fields") or []
                lines.append(
                    f"  - chunk #{cm.get('chunk_index')} "
                    f"conf {float(cm.get('confidence', 0)):.0%} · "
                    f"sem {float(cm.get('semantic_score', 0)):.3f} · "
                    f"bm25 {float(cm.get('bm25_score', 0)):.3f} · "
                    f"meta {float(cm.get('metadata_score', 0)):.3f}"
                    + (f" · fields [{', '.join(str(f) for f in fields)}]" if fields else "")
                )
                preview = cm.get("chunk_text_preview")
                if preview:
                    lines.append(f"    > {str(preview)[:200]}")

    if len(rows) > max_rows:
        lines.append(f"\n_(Showing top {max_rows} of {len(rows)} matched rows.)_")

    return "\n".join(lines)


async def run_document_rag_pipeline(
    *,
    file_path: str,
    index_result: dict[str, Any],
    user_query: str | None = None,
    skip_row_match: bool = False,
) -> tuple[list[dict[str, Any]], str]:
    """
    Deterministic Doc RAG follow-up (mirrors dedicated Doc RAG UI pipeline):
      index → verify → match rows to CMMS tables → grounded query → semantic evidence.
    """
    tool_calls: list[dict[str, Any]] = []
    match_reports: list[str] = []
    query = (user_query or "").strip() or DEFAULT_DOC_RAG_QUERY
    doc_id = str(
        index_result.get("document_id")
        or index_result.get("doc_id")
        or index_result.get("id")
        or ""
    )
    threshold = settings.doc_match_confidence_threshold
    max_rows = settings.doc_match_max_rows_in_report

    if doc_id:
        meta = await get_document_metadata.ainvoke({"document_id": doc_id})
        tool_calls.append(
            {
                "tool": "get_document_metadata",
                "input": {"document_id": doc_id},
                "output": meta,
            }
        )

        indexed_raw = await list_row_index_tables.ainvoke({})
        indexed_tables: list[str] = []
        if isinstance(indexed_raw, list):
            for entry in indexed_raw:
                if isinstance(entry, dict) and entry.get("source_table"):
                    indexed_tables.append(str(entry["source_table"]))
        tool_calls.append(
            {"tool": "list_row_index_tables", "input": {}, "output": indexed_raw}
        )

        if skip_row_match:
            match_reports.append(
                "## Row matching (UI)\n"
                "Use the orchestrator **Row match** panel to select a CMMS table, "
                "review chunk similarity scores, and confirm `document_id` on selected rows."
            )
        elif not indexed_tables:
            db_tables = await list_doc_rag_db_tables.ainvoke({})
            tool_calls.append(
                {"tool": "list_doc_rag_db_tables", "input": {}, "output": db_tables}
            )
            match_reports.append(
                "## Row index empty\n"
                "No tables in the row semantic index yet. In Doc RAG UI use **Index → "
                "Import DB table** (or upload CSV) before document-to-row matching works."
            )
        else:
            for source_table in _infer_source_tables(user_query, indexed_tables):
                match_input = {
                    "document_id": doc_id,
                    "confidence_threshold": threshold,
                    "group_by_table": True,
                }
                if source_table:
                    match_input["source_table"] = source_table
                match_out = await match_document_to_rows.ainvoke(match_input)
                tool_calls.append(
                    {
                        "tool": "match_document_to_rows",
                        "input": match_input,
                        "output": match_out,
                    }
                )
                if isinstance(match_out, dict):
                    label = source_table or "all indexed tables"
                    report = format_matched_rows_report(match_out, max_rows=max_rows)
                    match_reports.append(f"### Table scope: `{label}`\n\n{report}")

    rag = await query_docs.ainvoke({"query": query, "top_k": 8})
    tool_calls.append(
        {"tool": "query_docs", "input": {"query": query, "top_k": 8}, "output": rag}
    )

    evidence = await semantic_search.ainvoke({"query": query})
    tool_calls.append(
        {"tool": "semantic_search", "input": {"query": query}, "output": evidence}
    )

    parts: list[str] = [f"Doc RAG pipeline complete for {Path(file_path).name}"]
    if doc_id:
        parts.append(f"document_id={doc_id}")
    if isinstance(rag, dict) and not rag.get("error"):
        answer = rag.get("answer") or rag.get("response") or rag.get("text")
        if answer:
            parts.append(f"Answer: {str(answer)[:2500]}")
        sources = rag.get("sources") or rag.get("citations") or []
        if isinstance(sources, list) and sources:
            parts.append(f"{len(sources)} source chunk(s)")
    elif isinstance(rag, dict) and rag.get("error"):
        parts.append(f"query_docs: {rag.get('error')}")

    summary = " | ".join(parts)
    match_report = "\n\n".join(match_reports).strip()
    return tool_calls, summary, match_report


def _file_kind(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    if ext in STRUCTURED_EXTS:
        return "structured"
    if ext in SCHEMA_EXTS:
        return "schema"
    if ext in DOCUMENT_EXTS:
        return "document"
    return "skipped"


async def start_schema_mapping_from_file(
    *,
    file_path: str,
    organization_id: str,
    cmms_name: str = "Custom",
) -> dict[str, Any]:
    """POST /api/schema-mapping with YAML/JSON schema file content."""
    path = Path(file_path)
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"error": f"Cannot read schema file: {exc}"}
    fmt = path.suffix.lstrip(".").lower() or "yaml"
    body = {
        "connector_type": "yaml",
        "external_cmms_name": cmms_name,
        "organization_id": organization_id,
        "schema_content": content,
        "schema_source": path.name,
        "schema_format": fmt,
    }
    try:
        async with httpx.AsyncClient(
            base_url=settings.migration_base_url,
            timeout=1800.0,
            follow_redirects=True,
        ) as client:
            resp = await client.post("/api/schema-mapping", json=body)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        log.warning("single_door.schema_start.failed", error=str(exc)[:200])
        if isinstance(exc, httpx.HTTPStatusError):
            return {"error": exc.response.text[:300], "status_code": exc.response.status_code}
        return {"error": str(exc)[:300]}


async def _drive_migration_gates(
    *,
    migration_id: str,
    interactive_migration: bool = False,
) -> dict[str, Any]:
    """Drive run_migration + auto gate-approvals for one migration_id.

    Returns {status: 'done'|'error'|'awaiting_gate', summary, gate_type?, error?, tool_calls}.
    Shared by single-file (ingest_single_file) and multi-file (ingest_structured_batch).
    """
    tool_calls: list[dict[str, Any]] = []
    max_rounds = 15
    for _ in range(max_rounds):
        status = await run_migration.ainvoke({"migration_id": migration_id})
        tool_calls.append(
            {"tool": "run_migration", "input": {"migration_id": migration_id}, "output": status}
        )
        run_status = str(status.get("status") or "").lower()
        if run_status == "complete":
            return {
                "status": "done",
                "summary": f"Migration completed ({migration_id})",
                "error": None,
                "tool_calls": tool_calls,
            }
        if run_status == "failed":
            return {
                "status": "error",
                "summary": "Migration failed",
                "error": str(status.get("error", "unknown error")),
                "tool_calls": tool_calls,
            }
        if run_status != "gate":
            continue
        gate_type = str(status.get("gate_type") or "").lower()
        if interactive_migration:
            return {
                "status": "awaiting_gate",
                "summary": (
                    f"Migration paused at {gate_type.replace('_', ' ')} gate — "
                    f"review in Migration panel ({migration_id})"
                ),
                "gate_type": gate_type,
                "error": None,
                "tool_calls": tool_calls,
            }
        if gate_type == "pre_semantic":
            gate_resp = await submit_pre_semantic.ainvoke(
                {"migration_id": migration_id, "approve_all": True}
            )
            tool_calls.append(
                {
                    "tool": "submit_pre_semantic",
                    "input": {"migration_id": migration_id, "approve_all": True},
                    "output": gate_resp,
                }
            )
            continue
        if gate_type == "field_mapping":
            gate_resp = await submit_field_mapping.ainvoke(
                {"migration_id": migration_id, "approve_all": True}
            )
            tool_calls.append(
                {
                    "tool": "submit_field_mapping",
                    "input": {"migration_id": migration_id, "approve_all": True},
                    "output": gate_resp,
                }
            )
            continue
        if gate_type == "hierarchy":
            gate_resp = await submit_hierarchy.ainvoke(
                {"migration_id": migration_id, "approve_all": True}
            )
            tool_calls.append(
                {
                    "tool": "submit_hierarchy",
                    "input": {"migration_id": migration_id, "approve_all": True},
                    "output": gate_resp,
                }
            )
            continue
        return {
            "status": "error",
            "summary": f"Unhandled gate {gate_type}",
            "error": gate_type,
            "tool_calls": tool_calls,
        }
    return {
        "status": "error",
        "summary": "Migration did not complete in allotted rounds",
        "error": "max_rounds",
        "tool_calls": tool_calls,
    }


async def ingest_structured_batch(
    *,
    file_paths: list[str],
    organization_id: str | None = None,
    cmms_name: str = "Custom",
    interactive_migration: bool = False,
) -> dict[str, Any]:
    """TRACK 1 — start ONE migration covering ALL structured files, then drive its gates.

    All CSV/Excel files become source tables inside a single migration_id (via
    start_migration_multi). Never one migration per spreadsheet.
    """
    org = organization_id or "00000000-0000-0000-0000-000000000001"
    names = [Path(p).name for p in file_paths]
    tool_calls: list[dict[str, Any]] = []

    started = await start_migration_multi.ainvoke(
        {"file_paths": file_paths, "cmms_name": cmms_name, "organization_id": org}
    )
    tool_calls.append(
        {"tool": "start_migration_multi", "input": {"file_paths": file_paths}, "output": started}
    )
    migration_id = str(started.get("migration_id") or "")
    if not migration_id:
        return {
            "kind": "structured",
            "status": "error",
            "file_names": names,
            "summary": "Migration start failed",
            "error": str(started.get("error", "start_migration_multi failed")),
            "tool_calls": tool_calls,
        }

    session_id = get_session_context()
    if session_id and session_id != "shared":
        for name in names:
            register_migration_file(session_id, migration_id, name)

    driven = await _drive_migration_gates(
        migration_id=migration_id,
        interactive_migration=interactive_migration,
    )
    return {
        "kind": "structured",
        "status": driven["status"],
        "file_names": names,
        "summary": driven["summary"],
        "migration_id": migration_id,
        "gate_type": driven.get("gate_type"),
        "error": driven.get("error"),
        "tool_calls": tool_calls + driven["tool_calls"],
    }


async def ingest_single_file(
    *,
    file_path: str,
    organization_id: str | None = None,
    cmms_name: str = "Custom",
    user_query: str | None = None,
    run_doc_rag_pipeline: bool = True,
    skip_row_match: bool = False,
    interactive_migration: bool = False,
) -> dict[str, Any]:
    """Process one uploaded file through migration or doc-rag. Used inline and in bulk batches."""
    path = Path(file_path)
    kind = _file_kind(file_path)
    org = organization_id or "00000000-0000-0000-0000-000000000001"
    tool_calls: list[dict[str, Any]] = []

    if kind == "skipped":
        return {
            "file_name": path.name,
            "kind": kind,
            "status": "error",
            "summary": f"Unsupported file type: {path.suffix}",
            "error": "unsupported_extension",
            "tool_calls": tool_calls,
        }

    if kind == "schema":
        started = await start_schema_mapping_from_file(
            file_path=file_path,
            organization_id=org,
            cmms_name=cmms_name,
        )
        tool_calls.append(
            {
                "tool": "start_schema_mapping",
                "input": {"file_path": file_path},
                "output": started,
            }
        )
        schema_id = str(started.get("schema_mapping_id") or "")
        if not schema_id:
            return {
                "file_name": path.name,
                "kind": kind,
                "status": "error",
                "summary": "Schema mapping start failed",
                "error": str(started.get("error", "start_schema_mapping failed")),
                "tool_calls": tool_calls,
            }
        return {
            "file_name": path.name,
            "kind": kind,
            "status": "awaiting_gate",
            "summary": f"Schema mapping started ({schema_id}) — continue in Schema panel",
            "schema_mapping_id": schema_id,
            "error": None,
            "tool_calls": tool_calls,
        }

    if kind == "structured":
        started = await start_migration.ainvoke(
            {"file_path": file_path, "cmms_name": cmms_name, "organization_id": org}
        )
        tool_calls.append(
            {"tool": "start_migration", "input": {"file_path": file_path}, "output": started}
        )
        migration_id = str(started.get("migration_id") or "")
        if not migration_id:
            return {
                "file_name": path.name,
                "kind": kind,
                "status": "error",
                "summary": "Migration start failed",
                "error": str(started.get("error", "start_migration failed")),
                "tool_calls": tool_calls,
            }

        session_id = get_session_context()
        if session_id and session_id != "shared":
            register_migration_file(session_id, migration_id, path.name)

        driven = await _drive_migration_gates(
            migration_id=migration_id,
            interactive_migration=interactive_migration,
        )
        return {
            "file_name": path.name,
            "kind": kind,
            "status": driven["status"],
            "summary": driven["summary"],
            "migration_id": migration_id,
            "gate_type": driven.get("gate_type"),
            "error": driven.get("error"),
            "tool_calls": tool_calls + driven["tool_calls"],
        }

    doc_type = document_type_hint(file_path)
    indexed = await index_document.ainvoke(
        {"file_path": file_path, "document_type": doc_type}
    )
    tool_calls.append(
        {"tool": "index_document", "input": {"file_path": file_path}, "output": indexed}
    )
    if indexed.get("error"):
        return {
            "file_name": path.name,
            "kind": kind,
            "status": "error",
            "summary": "Document indexing failed",
            "error": str(indexed.get("error")),
            "tool_calls": tool_calls,
        }

    summary = f"Document indexed: {path.name}"
    match_report = ""
    if run_doc_rag_pipeline:
        pipeline_calls, pipeline_summary, match_report = await run_document_rag_pipeline(
            file_path=file_path,
            index_result=indexed,
            user_query=user_query,
            skip_row_match=skip_row_match,
        )
        tool_calls.extend(pipeline_calls)
        summary = pipeline_summary

    return {
        "file_name": path.name,
        "kind": kind,
        "status": "done",
        "summary": summary,
        "match_report": match_report,
        "error": None,
        "tool_calls": tool_calls,
    }


async def run_single_door_ingestion_sequence(
    *,
    session_id: str,
    file_paths: list[str],
    organization_id: str | None = None,
    cmms_name: str = "Custom",
    user_message: str | None = None,
    skip_row_match: bool = False,
    interactive_migration: bool = False,
) -> SingleDoorResult:
    """
    Execute the "single-door" sequence for uploaded files:
      1) structured files => migration flow (auto gate approvals)
      2) document files   => doc-rag indexing
      3) return context summary so orchestrator can continue in same chat window
    """
    set_session_context(session_id)
    tool_calls: list[dict[str, Any]] = []
    notes: list[str] = []
    step_summaries: list[str] = []
    n_structured = 0
    n_documents = 0
    n_schema = 0
    n_skipped = 0
    n_structured_done = 0
    n_documents_done = 0
    n_schema_started = 0
    n_migration_awaiting = 0
    user_query = (user_message or "").strip() or None
    combined_match_report: list[str] = []

    # Partition files into the two independent tracks (+ schema/skipped), order preserved.
    structured_paths = [p for p in file_paths if _file_kind(p) == "structured"]
    schema_paths = [p for p in file_paths if _file_kind(p) == "schema"]
    document_paths = [p for p in file_paths if _file_kind(p) == "document"]
    skipped_paths = [p for p in file_paths if _file_kind(p) == "skipped"]
    n_skipped = len(skipped_paths)
    mixed_tracks = bool(structured_paths) and bool(document_paths)

    if mixed_tracks:
        step_summaries.append(
            "[Mixed upload] Two independent tracks — "
            f"Structured (Migration): {', '.join(Path(p).name for p in structured_paths)}  |  "
            f"Documents (Doc RAG): {', '.join(Path(p).name for p in document_paths)}"
        )

    # ── TRACK 1 — structured batch FIRST: ONE migration for all spreadsheets ──
    if structured_paths:
        if len(structured_paths) > 1:
            step_summaries.append(
                f"[Migration · structured batch] {len(structured_paths)} files → ONE migration: "
                + ", ".join(Path(p).name for p in structured_paths)
            )
        else:
            step_summaries.append(
                f"[Migration] {Path(structured_paths[0]).name}: start → gates → mapping/hierarchy"
            )
        batch = await ingest_structured_batch(
            file_paths=structured_paths,
            organization_id=organization_id,
            cmms_name=cmms_name,
            interactive_migration=interactive_migration,
        )
        tool_calls.extend(batch.get("tool_calls") or [])
        n_structured = len(structured_paths)
        summary = str(batch.get("summary") or "")
        if summary:
            notes.append(summary)
        if batch.get("status") == "done":
            n_structured_done = len(structured_paths)
            set_ingestion_mode_structured(session_id)
            record_mapping_complete(session_id)
            record_hierarchy_complete(session_id)
        if batch.get("migration_id") and batch.get("status") == "awaiting_gate":
            n_migration_awaiting += 1
            register_migration_id(session_id, str(batch.get("migration_id") or ""))

    # ── Schema files (YAML/JSON) ──
    for file_path in schema_paths:
        step_summaries.append(
            f"[Schema] {Path(file_path).name}: ingest → gates → hierarchy → output"
        )
        result = await ingest_single_file(
            file_path=file_path,
            organization_id=organization_id,
            cmms_name=cmms_name,
            user_query=user_query,
            run_doc_rag_pipeline=False,
            interactive_migration=False,
        )
        tool_calls.extend(result.get("tool_calls") or [])
        n_schema += 1
        summary = str(result.get("summary") or "")
        if summary:
            notes.append(summary)
        if result.get("schema_mapping_id"):
            n_schema_started += 1

    # ── TRACK 2 — documents AFTER the structured batch (separate ingestion each) ──
    for file_path in document_paths:
        step_summaries.append(
            f"[Doc RAG] {Path(file_path).name}: index → verify → match rows → query → evidence"
        )
        result = await ingest_single_file(
            file_path=file_path,
            organization_id=organization_id,
            cmms_name=cmms_name,
            user_query=user_query,
            run_doc_rag_pipeline=True,
            skip_row_match=skip_row_match,
            interactive_migration=False,
        )
        tool_calls.extend(result.get("tool_calls") or [])
        n_documents += 1
        summary = str(result.get("summary") or "")
        if summary:
            notes.append(summary)
        mr = str(result.get("match_report") or "").strip()
        if mr:
            combined_match_report.append(f"## {Path(file_path).name}\n\n{mr}")
        if result.get("status") == "done":
            n_documents_done += 1

    if n_documents_done > 0 and n_structured_done == 0 and n_schema_started == 0:
        record_unstructured_register_ready(session_id)

    if n_documents_done > 0 or n_structured_done > 0:
        try:
            from .udr_hybrid_tools import retrieve_workspace_corpus_summary

            corpus = await retrieve_workspace_corpus_summary.ainvoke({})
            tool_calls.append(
                {
                    "tool": "retrieve_workspace_corpus_summary",
                    "input": {},
                    "output": corpus,
                }
            )
            if isinstance(corpus, dict) and not corpus.get("error"):
                step_summaries.append("[Hybrid UDR] Workspace corpus summary ready")
        except Exception as exc:
            log.warning("single_door.corpus_summary.failed", error=str(exc)[:200])

    if not notes:
        notes.append("No recognized files were provided for ingestion.")

    summary = " ".join(notes)
    context_parts = [
        f"Single-door preprocessing for session {session_id}: {summary}",
    ]
    if n_documents_done > 0:
        if skip_row_match:
            context_parts.append(
                "DOCUMENT REGISTER: Files are indexed in Doc RAG. The user will match "
                "rows in the orchestrator Row match panel (table select, similarity, "
                "confirm document_id). Continue with query_docs / hybrid UDR as needed; "
                "do not re-run index_document unless asked."
            )
        else:
            context_parts.append(
                "DOCUMENT REGISTER: Files are indexed in Doc RAG. Row matching results "
                "are already in the response — present matched table columns, row_data, "
                "and chunk similarity scores. Continue with query_docs / hybrid UDR as needed; "
                "do not re-run index_document or match_document_to_rows unless asked."
            )
    if n_structured_done > 0:
        context_parts.append(
            "STRUCTURED DATA: Migration mapping/hierarchy completed for CSV/Excel. "
            "Use udr_* / query_table for tabular answers."
        )
    if n_schema_started > 0 or n_migration_awaiting > 0:
        context_parts.append(
            "SCHEMA / MIGRATION UI: Pipeline paused for human gates. The user completes "
            "pre-semantic, field mapping, and hierarchy review in the orchestrator side "
            "panels (same as dedicated Schema Mapper / Migration Ingestor UIs). "
            "Do not auto-submit gates unless the user asks."
        )
    if mixed_tracks:
        context_parts.append(
            "MIXED UPLOAD (two independent tracks): The CSV/Excel files were migrated as "
            "ONE structured job (Migration panel); the PDF/Word/TXT/image files were indexed "
            "separately in Doc RAG (Documents / Row match panel), one document_id each. "
            "Structured ran first, then the documents."
        )
    context_parts.append(
        "Do NOT call index_document, start_migration, or start_migration_multi again for "
        "these same files. For multiple CSV/Excel files in one upload, ONE migration "
        "(start_migration_multi) was used — each file and each Excel sheet is a source table "
        "inside that single migration_id (not one migration per file or per sheet). "
        "Execute the user's full multi-step request in this turn."
    )
    context_note = " ".join(context_parts)
    log.info(
        "single_door.sequence.done",
        session_id=session_id,
        structured=n_structured,
        documents=n_documents,
        skipped=n_skipped,
    )
    return SingleDoorResult(
        summary_text=summary,
        tool_calls=tool_calls,
        context_note=context_note,
        step_summaries=step_summaries,
        match_report="\n\n".join(combined_match_report).strip(),
    )


def ensure_upload_dir(path_str: str) -> Path:
    path = Path(path_str)
    path.mkdir(parents=True, exist_ok=True)
    return path


def sanitize_filename(name: str) -> str:
    safe = "".join(ch for ch in name if ch.isalnum() or ch in ("-", "_", ".", " "))
    safe = safe.strip().replace(" ", "_")
    return safe or "upload.bin"


def remove_files(paths: list[str]) -> None:
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass
