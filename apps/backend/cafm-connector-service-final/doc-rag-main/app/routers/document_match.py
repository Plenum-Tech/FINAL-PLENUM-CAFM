"""Document-to-rows mapping endpoint.

POST /documents/{document_id}/match-rows
Automatically finds all enterprise database rows (equipment, assets, etc.)
that are mentioned anywhere in the document. Returns a structured list
of matched rows grouped by table, sorted by confidence.

POST /documents/{document_id}/match-rows/from-file
Same matching logic, but the row pool comes from a user-uploaded CSV or
Excel file instead of the row_semantic_index database table.

POST /documents/{document_id}/confirm-matches
Writes the document_id back into a `document_ids` JSONB column on each
confirmed row's source CMMS table. The column is created automatically
if it does not exist. Subsequent confirmations append without duplicating.

Use case: after uploading a maintenance report, inspection document, or
contract, immediately see which equipment/assets/locations are referenced
without writing any queries.
"""
from __future__ import annotations

import csv
import io
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.db.models import Document, DocumentChunk, RowSemanticIndex
from app.db.session import get_db
from app.schemas import MatchedRow
from app.services.row_match_service import RowData, row_match_service

def _cmms_schema() -> str:
    from app.core.config import settings as _cfg

    return (_cfg.plenum_cmms_schema or "plenum_cafm").strip() or "plenum_cafm"


router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/{document_id}/match-rows")
def match_document_to_rows(
    document_id: str,
    confidence_threshold: float = 0.25,
    group_by_table: bool = True,
    source_table: str | None = None,
    db: Session = Depends(get_db),
):
    """Analyze a document and return ALL database rows it references.

    This runs row-level grounding across every chunk in the document and
    returns a deduplicated list of matched equipment/asset/elevator rows.

    Args:
        document_id: The document to analyze
        confidence_threshold: Minimum match confidence (0.0-1.0, default 0.25)
        group_by_table: If true, group results by source_table
        source_table: When set, only match against rows from this table

    Returns:
        {
          "document_id": "...",
          "file_name": "maintenance_report.pdf",
          "total_chunks_analyzed": 247,
          "unique_rows_matched": 18,
          "matched_rows": [
            {
              "source_table": "equipment",
              "row_pk": "AHU-017",
              "confidence": 0.92,
              "match_method": "exact_key",
              "row_data": {...all columns...},
              "evidence": "chunk text that triggered the match",
              "chunk_ids": ["chunk-1", "chunk-5"]  # all chunks that matched this row
            },
            ...
          ],
          "by_table": {
            "equipment": 12,
            "elevators": 5,
            "assets": 1
          }
        }
    """
    start = time.time()

    # 1. Verify document exists
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    logger.info(
        "Document-to-rows mapping | doc_id={} | file={} | threshold={} | table={}",
        document_id, doc.file_name, confidence_threshold, source_table or "all",
    )

    # 2. Load all chunks for this document
    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index)
        .all()
    )

    if not chunks:
        return {
            "document_id": document_id,
            "file_name": doc.file_name,
            "total_chunks_analyzed": 0,
            "unique_rows_matched": 0,
            "matched_rows": [],
            "by_table": {},
            "latency_ms": int((time.time() - start) * 1000),
        }

    logger.info(
        "Document-to-rows matching | doc_id={} | chunks={} | threshold={}",
        document_id, len(chunks), confidence_threshold,
    )

    # 3. Match each chunk against the row index
    row_matches: dict[tuple[str, str], dict] = {}  # (table, pk) -> match_info
    total_raw_matches = 0
    total_filtered = 0

    for chunk_idx, chunk in enumerate(chunks):
        matches = row_match_service.match_chunk(db, chunk, source_table=source_table)
        total_raw_matches += len(matches)
        for m in matches:
            if m.confidence < confidence_threshold:
                total_filtered += 1
                continue

            key = (m.source_table, m.row_pk)
            if key not in row_matches:
                row_matches[key] = {
                    "source_table": m.source_table,
                    "row_pk": m.row_pk,
                    "confidence": m.confidence,
                    "match_method": m.match_method,
                    "row_data": m.matched_fields,
                    "evidence": m.evidence,
                    "chunk_ids": [chunk.id],
                    "matched_metadata_fields": m.matched_metadata_fields,
                    "match_details": m.match_details,
                    "chunk_matches": [{
                        "chunk_id": chunk.id,
                        "chunk_index": chunk.chunk_index,
                        "page_number": chunk.page_start,
                        "confidence": m.confidence,
                        "semantic_score": m.match_details["semantic_score"],
                        "bm25_score": m.match_details["bm25_overlap"],
                        "metadata_score": m.match_details["metadata_overlap"],
                        "matched_fields": m.matched_metadata_fields,
                        "chunk_text_preview": chunk.text_content[:150] + "..." if len(chunk.text_content) > 150 else chunk.text_content,
                    }]
                }
            else:
                # Row already matched by another chunk
                existing = row_matches[key]
                
                # Add this chunk's match details
                existing["chunk_matches"].append({
                    "chunk_id": chunk.id,
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_start,
                    "confidence": m.confidence,
                    "semantic_score": m.match_details["semantic_score"],
                    "bm25_score": m.match_details["bm25_overlap"],
                    "metadata_score": m.match_details["metadata_overlap"],
                    "matched_fields": m.matched_metadata_fields,
                    "chunk_text_preview": chunk.text_content[:150] + "..." if len(chunk.text_content) > 150 else chunk.text_content,
                })
                
                # Update top-level confidence and metadata if this match is better
                if m.confidence > existing["confidence"]:
                    existing["confidence"] = m.confidence
                    existing["match_method"] = m.match_method
                    existing["evidence"] = m.evidence
                    existing["matched_metadata_fields"] = m.matched_metadata_fields
                    existing["match_details"] = m.match_details
                
                existing["chunk_ids"].append(chunk.id)

    logger.info(
        "Document-to-rows loop done | doc_id={} | total_raw={} | filtered={} | "
        "unique_rows={} | pass_rate={:.1f}%",
        document_id, total_raw_matches, total_filtered, len(row_matches),
        100.0 * len(row_matches) / max(1, total_raw_matches),
    )

    # 4. Build the response
    matched_rows_list = list(row_matches.values())
    matched_rows_list.sort(key=lambda x: x["confidence"], reverse=True)

    # Convert to MatchedRow schema with all new fields
    structured_rows = [
        {
            **MatchedRow(
                source_table=r["source_table"],
                row_pk=r["row_pk"],
                confidence=r["confidence"],
                match_method=r["match_method"],
                row_data=r["row_data"],
                evidence=r["evidence"],
                matched_metadata_fields=r.get("matched_metadata_fields", []),
                match_details=r.get("match_details", {}),
                chunk_matches=r.get("chunk_matches", []),
            ).model_dump(),
            "chunk_ids": r["chunk_ids"],
            "chunk_count": len(r["chunk_ids"]),
        }
        for r in matched_rows_list
    ]

    # Group by table
    by_table: dict[str, int] = {}
    for r in structured_rows:
        table = r["source_table"]
        by_table[table] = by_table.get(table, 0) + 1

    latency_ms = int((time.time() - start) * 1000)

    logger.info(
        "Document-to-rows complete | doc_id={} | chunks={} | "
        "unique_rows={} | {}ms",
        document_id, len(chunks), len(structured_rows), latency_ms,
    )

    result = {
        "document_id": document_id,
        "file_name": doc.file_name,
        "total_chunks_analyzed": len(chunks),
        "unique_rows_matched": len(structured_rows),
        "matched_rows": structured_rows,
        "by_table": by_table,
        "raw_candidate_matches": total_raw_matches,
        "below_threshold_matches": total_filtered,
        "latency_ms": latency_ms,
    }

    if group_by_table:
        # Reorganize matched_rows into a nested dict by table
        grouped: dict[str, list] = {}
        for r in structured_rows:
            table = r["source_table"]
            if table not in grouped:
                grouped[table] = []
            grouped[table].append(r)
        result["matched_rows_by_table"] = grouped

    return result


@router.post("/{document_id}/match-rows/from-file")
async def match_document_to_rows_from_file(
    document_id: str,
    file: UploadFile = File(...),
    pk_column: str | None = Form(default=None),
    source_table: str | None = Form(default=None),
    confidence_threshold: float = Form(default=0.25),
    group_by_table: bool = Form(default=True),
    db: Session = Depends(get_db),
):
    """Match a document's chunks against rows from a user-uploaded CSV or Excel file.

    The file rows are matched using the same hybrid BM25 + metadata scoring
    as the DB-based endpoint. Semantic scoring is skipped because file rows
    have no pre-computed embeddings.

    Args:
        document_id: The document to analyze
        file: CSV (.csv) or Excel (.xlsx / .xls) file containing the row pool
        pk_column: Column name to use as the row primary key. Defaults to first column.
        source_table: Label applied to all file rows (defaults to filename stem)
        confidence_threshold: Minimum match confidence (default 0.25)
        group_by_table: If true, group results by source_table
    """
    start = time.time()

    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # ── Parse uploaded file into a list of RowData ────────────────────────────
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()
    table_label = source_table or Path(filename).stem

    raw_bytes = await file.read()

    file_rows: list[RowData] = []

    if ext == ".csv":
        try:
            text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = raw_bytes.decode("latin-1")
        reader = csv.DictReader(io.StringIO(text))
        headers = reader.fieldnames or []
        pk_col = pk_column if pk_column and pk_column in headers else (headers[0] if headers else None)
        for idx, row_dict in enumerate(reader):
            pk_val = str(row_dict.get(pk_col, idx)) if pk_col else str(idx)
            meta = {k: v for k, v in row_dict.items() if v is not None and v != ""}
            semantic_text = " | ".join(
                f"{k}: {v}" for k, v in row_dict.items() if v is not None and v != ""
            )
            file_rows.append(RowData(
                source_table=table_label,
                row_pk=pk_val,
                semantic_text=semantic_text,
                meta=meta,
                embedding=None,
            ))

    elif ext in (".xlsx", ".xls", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(status_code=500, detail="openpyxl is not installed")
        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        header_row = next(rows_iter, None)
        if header_row is None:
            raise HTTPException(status_code=400, detail="Excel file appears to be empty")
        headers = [str(h) if h is not None else f"col_{i}" for i, h in enumerate(header_row)]
        pk_col = pk_column if pk_column and pk_column in headers else headers[0]
        pk_idx = headers.index(pk_col)
        for idx, row_vals in enumerate(rows_iter):
            row_dict = {headers[i]: row_vals[i] for i in range(min(len(headers), len(row_vals)))}
            pk_val = str(row_dict.get(pk_col, idx)) if pk_col in row_dict else str(idx)
            meta = {k: str(v) for k, v in row_dict.items() if v is not None}
            semantic_text = " | ".join(
                f"{k}: {v}" for k, v in row_dict.items() if v is not None
            )
            file_rows.append(RowData(
                source_table=table_label,
                row_pk=pk_val,
                semantic_text=semantic_text,
                meta=meta,
                embedding=None,
            ))
        wb.close()
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Upload a .csv or .xlsx file.",
        )

    if not file_rows:
        raise HTTPException(status_code=400, detail="Uploaded file contains no data rows")

    logger.info(
        "File-based row match | doc_id={} | file={} | file_rows={} | table={} | threshold={}",
        document_id, filename, len(file_rows), table_label, confidence_threshold,
    )

    # ── Load document chunks ──────────────────────────────────────────────────
    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index)
        .all()
    )
    if not chunks:
        return {
            "document_id": document_id,
            "file_name": doc.file_name,
            "row_source": "file",
            "source_file": filename,
            "total_chunks_analyzed": 0,
            "unique_rows_matched": 0,
            "matched_rows": [],
            "by_table": {},
            "latency_ms": int((time.time() - start) * 1000),
        }

    # ── Match each chunk against file rows ────────────────────────────────────
    row_matches: dict[tuple[str, str], dict] = {}
    total_raw_matches = 0
    total_filtered = 0

    for chunk in chunks:
        matches = row_match_service.match_chunk_against_rows(chunk, file_rows)
        total_raw_matches += len(matches)
        for m in matches:
            if m.confidence < confidence_threshold:
                total_filtered += 1
                continue
            key = (m.source_table, m.row_pk)
            if key not in row_matches:
                row_matches[key] = {
                    "source_table": m.source_table,
                    "row_pk": m.row_pk,
                    "confidence": m.confidence,
                    "match_method": m.match_method,
                    "row_data": m.matched_fields,
                    "evidence": m.evidence,
                    "chunk_ids": [chunk.id],
                    "matched_metadata_fields": m.matched_metadata_fields,
                    "match_details": m.match_details,
                    "chunk_matches": [{
                        "chunk_id": chunk.id,
                        "chunk_index": chunk.chunk_index,
                        "page_number": chunk.page_start,
                        "confidence": m.confidence,
                        "semantic_score": m.match_details["semantic_score"],
                        "bm25_score": m.match_details["bm25_overlap"],
                        "metadata_score": m.match_details["metadata_overlap"],
                        "matched_fields": m.matched_metadata_fields,
                        "chunk_text_preview": chunk.text_content[:150] + "..." if len(chunk.text_content) > 150 else chunk.text_content,
                    }],
                }
            else:
                existing = row_matches[key]
                existing["chunk_matches"].append({
                    "chunk_id": chunk.id,
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_start,
                    "confidence": m.confidence,
                    "semantic_score": m.match_details["semantic_score"],
                    "bm25_score": m.match_details["bm25_overlap"],
                    "metadata_score": m.match_details["metadata_overlap"],
                    "matched_fields": m.matched_metadata_fields,
                    "chunk_text_preview": chunk.text_content[:150] + "..." if len(chunk.text_content) > 150 else chunk.text_content,
                })
                if m.confidence > existing["confidence"]:
                    existing["confidence"] = m.confidence
                    existing["match_method"] = m.match_method
                    existing["evidence"] = m.evidence
                    existing["matched_metadata_fields"] = m.matched_metadata_fields
                    existing["match_details"] = m.match_details
                existing["chunk_ids"].append(chunk.id)

    logger.info(
        "File-based match loop done | doc_id={} | chunks={} | file_rows={} | "
        "total_raw={} | filtered={} | unique_rows={}",
        document_id, len(chunks), len(file_rows),
        total_raw_matches, total_filtered, len(row_matches),
    )

    # ── Build response (same shape as DB-based endpoint) ─────────────────────
    matched_rows_list = sorted(row_matches.values(), key=lambda x: x["confidence"], reverse=True)
    structured_rows = [
        {
            **MatchedRow(
                source_table=r["source_table"],
                row_pk=r["row_pk"],
                confidence=r["confidence"],
                match_method=r["match_method"],
                row_data=r["row_data"],
                evidence=r["evidence"],
                matched_metadata_fields=r.get("matched_metadata_fields", []),
                match_details=r.get("match_details", {}),
                chunk_matches=r.get("chunk_matches", []),
            ).model_dump(),
            "chunk_ids": r["chunk_ids"],
            "chunk_count": len(r["chunk_ids"]),
        }
        for r in matched_rows_list
    ]

    by_table: dict[str, int] = {}
    for r in structured_rows:
        tbl = r["source_table"]
        by_table[tbl] = by_table.get(tbl, 0) + 1

    latency_ms = int((time.time() - start) * 1000)

    logger.info(
        "File-based match complete | doc_id={} | chunks={} | unique_rows={} | {}ms",
        document_id, len(chunks), len(structured_rows), latency_ms,
    )

    result: dict = {
        "document_id": document_id,
        "file_name": doc.file_name,
        "row_source": "file",
        "source_file": filename,
        "total_chunks_analyzed": len(chunks),
        "unique_rows_matched": len(structured_rows),
        "matched_rows": structured_rows,
        "by_table": by_table,
        "raw_candidate_matches": total_raw_matches,
        "below_threshold_matches": total_filtered,
        "latency_ms": latency_ms,
    }

    if group_by_table:
        grouped: dict[str, list] = {}
        for r in structured_rows:
            tbl = r["source_table"]
            if tbl not in grouped:
                grouped[tbl] = []
            grouped[tbl].append(r)
        result["matched_rows_by_table"] = grouped

    return result


@router.get("/{document_id}/match-rows/debug")
def debug_chunk_to_row_matching(
    document_id: str,
    show_all_chunks: bool = False,
    confidence_threshold: float = 0.0,
    db: Session = Depends(get_db),
):
    """TESTING/DEBUG endpoint: show EVERY chunk and what rows it matched.

    This is for evaluating match quality. Unlike /match-rows which returns
    deduplicated rows, this returns chunk-by-chunk results so you can see:
      - Which chunks matched nothing (false negatives?)
      - Which chunks matched the wrong row (false positives?)
      - What the confidence scores look like across all chunks

    Use this to tune confidence_threshold and validate your row index.

    Args:
        document_id: The document to analyze
        show_all_chunks: If true, include chunks that matched nothing
        confidence_threshold: Only show matches above this score

    Returns:
        {
          "document_id": "...",
          "file_name": "...",
          "total_chunks": 247,
          "chunks_with_matches": 89,
          "chunks_without_matches": 158,
          "chunk_details": [
            {
              "chunk_id": "...",
              "chunk_index": 5,
              "page": 3,
              "block_type": "table_row",
              "text": "Equipment AHU-017. Building A, Floor 5...",
              "matched_rows": [
                {
                  "source_table": "equipment",
                  "row_pk": "AHU-017",
                  "confidence": 0.94,
                  "match_method": "exact_key",
                  "row_data": {...}
                }
              ]
            },
            ...
          ]
        }
    """
    from app.db.models import RowSemanticIndex

    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check if row index is populated
    row_count = db.query(RowSemanticIndex).count()
    if row_count == 0:
        return {
            "error": "row_semantic_index is empty",
            "message": (
                "No database rows have been seeded yet. Run "
                "`python -m scripts.seed_row_index` to populate the "
                "index before testing matches."
            ),
            "document_id": document_id,
        }

    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index)
        .all()
    )

    chunk_details = []
    chunks_with_matches = 0

    for chunk in chunks:
        matches = row_match_service.match_chunk(db, chunk)
        # Filter by threshold
        matches = [m for m in matches if m.confidence >= confidence_threshold]

        if matches:
            chunks_with_matches += 1

        # Skip chunks with no matches unless show_all_chunks=true
        if not matches and not show_all_chunks:
            continue

        chunk_details.append({
            "chunk_id": chunk.id,
            "chunk_index": chunk.chunk_index,
            "page": chunk.page_start,
            "block_type": chunk.block_type,
            "section_label": chunk.section_label,
            "text": chunk.text_content[:300] + (
                "..." if len(chunk.text_content) > 300 else ""
            ),
            "text_length": len(chunk.text_content),
            "matched_rows": [
                {
                    "source_table": m.source_table,
                    "row_pk": m.row_pk,
                    "confidence": round(m.confidence, 4),
                    "match_method": m.match_method,
                    "row_data": m.matched_fields,
                    "evidence": m.evidence[:200],
                }
                for m in matches
            ],
            "match_count": len(matches),
        })

    return {
        "document_id": document_id,
        "file_name": doc.file_name,
        "row_index_size": row_count,
        "total_chunks": len(chunks),
        "chunks_with_matches": chunks_with_matches,
        "chunks_without_matches": len(chunks) - chunks_with_matches,
        "chunk_details": chunk_details,
        "showing_chunks": len(chunk_details),
        "note": (
            "Set show_all_chunks=true to include chunks with no matches. "
            "Adjust confidence_threshold to filter weak matches."
        ),
    }


# ── Confirm matches — write document_id back to CMMS rows ────────────────────

class ConfirmRowRef(BaseModel):
    source_table: str
    row_pk: str


class ConfirmMatchesRequest(BaseModel):
    confirmed_rows: list[ConfirmRowRef]


@router.post("/{document_id}/confirm-matches")
def confirm_document_matches(
    document_id: str,
    body: ConfirmMatchesRequest,
    db: Session = Depends(get_db),
):
    """Write this document's ID into the `document_ids` JSONB column of every
    confirmed CMMS row.

    - The `document_ids` column is created on the target table automatically
      if it does not yet exist (Postgres only; SQLite is skipped).
    - Appends without duplicating: re-confirming the same document + row is safe.
    - Groups writes by table to minimise round-trips.

    Request body::

        {
          "confirmed_rows": [
            {"source_table": "assets",    "row_pk": "AHU-017"},
            {"source_table": "equipment", "row_pk": "EQ-042"}
          ]
        }

    Response::

        {
          "document_id": "...",
          "rows_updated": 2,
          "rows_not_found": 0,
          "by_table": {"assets": 1, "equipment": 1},
          "columns_created": ["assets"]
        }
    """
    start = time.time()

    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not body.confirmed_rows:
        return {
            "document_id": document_id,
            "rows_updated": 0,
            "rows_not_found": 0,
            "by_table": {},
            "columns_created": [],
            "latency_ms": 0,
        }

    # ── Resolve pk_column for each (source_table, row_pk) from the index ─────
    # Build a lookup: (source_table, row_pk) → pk_column
    index_entries: dict[tuple[str, str], str | None] = {}
    for ref in body.confirmed_rows:
        key = (ref.source_table, ref.row_pk)
        if key not in index_entries:
            entry = (
                db.query(RowSemanticIndex)
                .filter(
                    RowSemanticIndex.source_table == ref.source_table,
                    RowSemanticIndex.row_pk == ref.row_pk,
                )
                .first()
            )
            index_entries[key] = entry.pk_column if entry else None

    # ── Group confirmed rows by source_table ──────────────────────────────────
    by_table: dict[str, list[ConfirmRowRef]] = {}
    for ref in body.confirmed_rows:
        by_table.setdefault(ref.source_table, []).append(ref)

    rows_updated = 0
    rows_not_found = 0
    columns_created: list[str] = []
    result_by_table: dict[str, int] = {}

    # ── Process each CMMS table ───────────────────────────────────────────────
    from app.core.config import settings as _cfg

    use_sqlite = _cfg.effective_use_sqlite_dev

    with db.bind.begin() as conn:  # type: ignore[attr-defined]
        for table_name, refs in by_table.items():
            # 1. Resolve pk_column:
            #    a) from row_semantic_index.pk_column (set on new rows)
            #    b) fallback: real PRIMARY KEY from information_schema (for rows
            #       indexed before pk_column field was added)
            #    c) fallback: scan meta JSONB to find which column value matches row_pk
            resolved_pk_col: str | None = None

            for ref in refs:
                candidate = index_entries.get((ref.source_table, ref.row_pk))
                if candidate:
                    resolved_pk_col = candidate
                    break

            if not resolved_pk_col and not use_sqlite:
                # Fallback a: query information_schema for the actual PK column
                try:
                    pk_row = conn.execute(
                        text(
                            "SELECT kcu.column_name "
                            "FROM information_schema.table_constraints tc "
                            "JOIN information_schema.key_column_usage kcu "
                            "  ON tc.constraint_name = kcu.constraint_name "
                            "  AND tc.table_schema   = kcu.table_schema "
                            "WHERE tc.constraint_type = 'PRIMARY KEY' "
                            "  AND tc.table_schema    = :schema "
                            "  AND tc.table_name      = :tbl "
                            "ORDER BY kcu.ordinal_position LIMIT 1"
                        ),
                        {"schema": _cmms_schema(), "tbl": table_name},
                    ).scalar()
                    if pk_row:
                        resolved_pk_col = str(pk_row)
                        logger.info(
                            "confirm-matches | resolved pk_column={} for table={} "
                            "via information_schema PK lookup",
                            resolved_pk_col, table_name,
                        )
                except Exception as exc:
                    logger.debug("confirm-matches | PK lookup failed for {}: {}", table_name, exc)

            if not resolved_pk_col:
                # Fallback b: find which meta column's value matches row_pk
                sample = db.query(RowSemanticIndex).filter(
                    RowSemanticIndex.source_table == table_name,
                    RowSemanticIndex.row_pk == refs[0].row_pk,
                ).first()
                if sample and sample.meta:
                    for col, val in sample.meta.items():
                        if str(val) == refs[0].row_pk:
                            resolved_pk_col = col
                            logger.info(
                                "confirm-matches | resolved pk_column={} for table={} "
                                "via meta value scan",
                                resolved_pk_col, table_name,
                            )
                            break

            if not resolved_pk_col:
                logger.warning(
                    "confirm-matches | could not resolve pk_column for table={} — "
                    "re-index with import-db-table to persist pk_column",
                    table_name,
                )
                rows_not_found += len(refs)
                continue

            # 2. Ensure document_ids column exists on the CMMS table
            if not use_sqlite:
                # Check information_schema first (cheaper than catching an error)
                col_exists = conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_schema = :schema AND table_name = :tbl "
                        "AND column_name = 'document_ids'"
                    ),
                    {"schema": _cmms_schema(), "tbl": table_name},
                ).scalar()

                if not col_exists:
                    try:
                        conn.execute(
                            text(
                                f'ALTER TABLE {_cmms_schema()}."{table_name}" '
                                "ADD COLUMN document_ids JSONB DEFAULT '[]'::jsonb"
                            )
                        )
                        columns_created.append(table_name)
                        logger.info(
                            "confirm-matches | added document_ids column to {}.{}",
                            _cmms_schema(), table_name,
                        )
                    except Exception as exc:
                        logger.warning(
                            "confirm-matches | could not add document_ids to {}.{}: {}",
                            _cmms_schema(), table_name, exc,
                        )

            # 3. Update each confirmed row — append doc id without duplicating
            updated_in_table = 0
            for ref in refs:
                try:
                    if use_sqlite:
                        # SQLite: store as simple JSON text, no CMMS schema prefix
                        result = conn.execute(
                            text(
                                f'UPDATE "{table_name}" '
                                f"SET document_ids = json_insert("
                                f"  COALESCE(document_ids, '[]'), "
                                f"  '$[#]', :doc_id"
                                f") "
                                f'WHERE "{resolved_pk_col}" = :row_pk '
                                f"  AND NOT EXISTS ("
                                f"    SELECT 1 FROM json_each(COALESCE(document_ids, '[]')) "
                                f"    WHERE value = :doc_id"
                                f"  )"
                            ),
                            {"doc_id": document_id, "row_pk": ref.row_pk},
                        )
                    else:
                        # Postgres: JSONB array append, deduplicated via @> containment
                        result = conn.execute(
                            text(
                                f'UPDATE {_cmms_schema()}."{table_name}" '
                                "SET document_ids = CASE "
                                "  WHEN document_ids IS NULL "
                                "    THEN jsonb_build_array(CAST(:doc_id AS text)) "
                                "  WHEN document_ids @> jsonb_build_array(CAST(:doc_id AS text)) "
                                "    THEN document_ids "
                                "  ELSE document_ids || jsonb_build_array(CAST(:doc_id AS text)) "
                                "END "
                                f'WHERE "{resolved_pk_col}"::text = CAST(:row_pk AS text)'
                            ),
                            {"doc_id": document_id, "row_pk": ref.row_pk},
                        )

                    if result.rowcount > 0:
                        updated_in_table += 1
                        rows_updated += 1
                    else:
                        rows_not_found += 1
                        logger.debug(
                            "confirm-matches | row not found: table={} pk_col={} row_pk={}",
                            table_name, resolved_pk_col, ref.row_pk,
                        )

                except Exception as exc:
                    logger.warning(
                        "confirm-matches | update failed for {}.{} row_pk={}: {}",
                        table_name, resolved_pk_col, ref.row_pk, exc,
                    )
                    rows_not_found += 1

            result_by_table[table_name] = updated_in_table
            logger.info(
                "confirm-matches | table={} updated={} / {}",
                table_name, updated_in_table, len(refs),
            )

    latency_ms = int((time.time() - start) * 1000)
    logger.info(
        "confirm-matches complete | doc={} | updated={} | not_found={} | {}ms",
        document_id, rows_updated, rows_not_found, latency_ms,
    )

    return {
        "document_id": document_id,
        "file_name": doc.file_name,
        "rows_updated": rows_updated,
        "rows_not_found": rows_not_found,
        "by_table": result_by_table,
        "columns_created": columns_created,
        "latency_ms": latency_ms,
    }
