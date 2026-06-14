"""Node 1: Ingest and configure — file parsing and detection.

Handles:
1. Download blob from Azure
2. Detect encoding (chardet)
3. Detect delimiter (CSV analysis)
4. Parse CSV/Excel into pandas DataFrames
5. Generate dataset summary
6. EL-M.1 validation: row_count > 0, column_count > 0
"""

import io
import logging
from datetime import datetime
from uuid import UUID

import chardet
import pandas as pd
from anthropic import AsyncAnthropic
from azure.storage.blob.aio import BlobClient
from sqlalchemy.ext.asyncio import AsyncSession

from ...matchers import describe_dataset
from ...services.mapping_service import MappingService
from ..state import MigrationState

from cafm_shared.logging import get_logger
logger = get_logger(__name__)


def _detect_excel_header_row(
    excel_file: io.BytesIO,
    sheet_name: str,
    max_scan: int = 10,
) -> int:
    """
    Detect the 0-indexed row that contains real column headers in an Excel sheet.

    Real exports often start with a title/banner row (sometimes merged across
    the full width — e.g. "🚗 FM Transportation Log — Technician Mobility..."),
    leaving only the first cell populated. Reading with the default ``header=0``
    would then label every later cell as ``Unnamed: N``.

    Strategy: read up to ``max_scan`` rows with no header, then pick the FIRST
    row whose non-null cell count is at least half the widest non-null count
    seen so far. That naturally skips banner rows (1 non-null cell) and stops
    at the first row that "looks like" a header strip across the sheet.

    Falls back to row 0 if the sheet is empty or no row meets the threshold.
    """
    excel_file.seek(0)
    try:
        raw = pd.read_excel(
            excel_file,
            sheet_name=sheet_name,
            header=None,
            nrows=max_scan,
            dtype=str,
        )
    except Exception:
        return 0
    finally:
        excel_file.seek(0)

    if raw is None or raw.empty:
        return 0

    counts = [int(raw.iloc[i].notna().sum()) for i in range(len(raw))]
    if not counts:
        return 0
    widest = max(counts)
    if widest <= 1:
        return 0  # nothing helpful — let pandas default behaviour run
    threshold = max(2, widest // 2)
    for i, c in enumerate(counts):
        if c >= threshold:
            return i
    return 0


def _sanitize_column_names(df: pd.DataFrame) -> pd.DataFrame:
    """
    Replace pandas' Unnamed: N fallback column labels with positional col_N
    placeholders. The original source has no header at that position; keeping
    the pandas-internal name leaks an implementation detail into the schema
    mapper and produces meaningless "Unnamed: N" rows in the field-mapping UI.
    """
    if df is None or df.empty:
        return df
    new_cols: list[str] = []
    for idx, raw in enumerate(df.columns):
        s = str(raw).strip()
        if not s or s.lower().startswith("unnamed:") or s.lower() == "nan":
            new_cols.append(f"col_{idx + 1}")
        else:
            new_cols.append(s)
    df = df.copy()
    df.columns = new_cols
    return df


def _sanitize_records(records: list) -> list:
    """
    Convert all pandas/numpy non-JSON-serializable values in a list of record
    dicts to plain Python types safe for LangGraph msgpack checkpointing.

    Handles:
      - pd.NaT          → None
      - float NaN       → None
      - pd.Timestamp    → ISO-8601 string
      - numpy scalars   → native int / float via .item()
    """
    def _clean(v):
        # NA check: covers NaT, float NaN, None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass  # pd.isna raises for non-scalar types

        if isinstance(v, pd.Timestamp):
            return v.isoformat()

        # numpy scalar → native Python type
        if hasattr(v, "item"):
            try:
                return v.item()
            except Exception:
                return str(v)

        return v

    return [{k: _clean(v) for k, v in row.items()} for row in records]


async def ingest_node(state: MigrationState) -> MigrationState:
    """
    Node 1: Download, parse, and analyze uploaded CMMS export.

    Args:
        state: MigrationState with source_blob_url populated

    Returns:
        Updated state with parsed_tables, row_count, column_count, table_health, column_descriptions
    """

    _node_started_at = datetime.utcnow()
    migration_id = state.get("migration_id")
    source_blob_url = state.get("source_blob_url")
    source_blob_path = state.get("source_blob_path")
    source_file_bytes = state.get("source_file_bytes")

    if not source_file_bytes and not source_blob_url and not source_blob_path:
        logger.error("[Node 1] No source_file_bytes / source_blob_url / source_blob_path provided")
        state["error_message"] = "No file available — provide direct bytes, a Blob URL, or a stored source path"
        state["error_node"] = 1
        return state

    logger.info(f"[Node 1] Starting ingest: migration_id={migration_id}")

    try:
        # ── Step 1: Obtain file content (direct upload OR Azure Blob) ─────
        if source_file_bytes:
            # Fast path: caller already supplied raw bytes (direct upload)
            file_content: bytes = source_file_bytes
            logger.info(f"[Node 1] Using directly-uploaded file bytes ({len(file_content):,} bytes)")
        elif source_blob_path:
            # Re-run path: re-pull the persisted source from Blob, authenticated via the
            # connection string (works even on a private container).
            from ...config import get_settings as _gs
            _settings = _gs()
            conn = getattr(_settings, "azure_storage_connection_string", "") or ""
            container = getattr(_settings, "azure_blob_container_name", "") or "plenum-agentic-ai-attachments"
            if not conn:
                logger.error("[Node 1] source_blob_path set but Azure storage is not configured")
                state["error_message"] = "Source is stored in Blob but Azure storage is not configured for re-download."
                state["error_node"] = 1
                return state
            from azure.storage.blob.aio import BlobServiceClient as _BSC
            async with _BSC.from_connection_string(conn) as svc:
                bc = svc.get_blob_client(container=container, blob=source_blob_path)
                stream = await bc.download_blob()
                file_content = await stream.readall()
            logger.info(
                f"[Node 1] Re-pulled source from blob path {source_blob_path} ({len(file_content):,} bytes)"
            )
        else:
            # Fallback: download from a full Azure Blob URL (legacy / SAS)
            logger.info(f"[Node 1] Downloading file from Blob: {source_blob_url[:60]}...")
            async with BlobClient.from_blob_url(source_blob_url) as blob_client:
                file_bytes = await blob_client.download_blob()
                file_content = await file_bytes.readall()
            logger.info(f"[Node 1] Downloaded {len(file_content):,} bytes from Blob")

        state["source_file_bytes"] = file_content  # Transient; will be cleared before checkpoint

        # ── Step 2: Detect encoding ────────────────────────────────────
        detected = chardet.detect(file_content)
        encoding = detected.get("encoding", "utf-8")
        if not encoding:
            encoding = "utf-8"
        logger.info(f"[Node 1] Detected encoding: {encoding} (confidence: {detected.get('confidence', 0):.2f})")
        state["source_encoding"] = encoding

        # Decode to string
        try:
            file_str = file_content.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            logger.warning(f"[Node 1] Encoding {encoding} failed, trying utf-8")
            file_str = file_content.decode("utf-8", errors="replace")
            state["source_encoding"] = "utf-8"

        # ── Step 3: Detect file format and delimiter ───────────────────
        # Sample first 4KB for analysis
        sample = file_str[:4096]

        # Detect delimiter (CSV)
        delimiter = _detect_delimiter(sample)
        state["source_delimiter"] = delimiter
        logger.info(f"[Node 1] Detected delimiter: {repr(delimiter)}")

        # ── Step 4: Parse into pandas DataFrames ──────────────────────
        # Load ONLY first 5 rows (+ header) for analysis
        parsed_tables = {}
        total_rows = 0
        total_columns = 0
        actual_row_count = 0  # Track full file row count
        actual_col_count = 0

        # Try CSV first
        try:
            logger.info("[Node 1] Attempting CSV parse (first 5 rows only for analysis)...")
            # First pass: get actual row count from full file
            df_full = pd.read_csv(
                io.StringIO(file_str),
                delimiter=delimiter,
                dtype=str,
                nrows=None,  # Read all to get accurate count
            )
            df_full = _sanitize_column_names(df_full)
            actual_row_count = len(df_full)
            actual_col_count = len(df_full.columns)

            # Second pass: use only first 5 rows for analysis
            df = pd.read_csv(
                io.StringIO(file_str),
                delimiter=delimiter,
                dtype=str,
                nrows=5,  # ← LIMIT TO 5 ROWS FOR ANALYSIS
            )
            df = _sanitize_column_names(df)
            parsed_tables["data"] = _sanitize_records(df.to_dict(orient="records"))

            # STORE FULL FILE separately for Node 5+ processing
            full_tables = {}
            full_tables["data"] = _sanitize_records(df_full.to_dict(orient="records"))
            state["full_tables"] = full_tables

            state["detected_file_format"] = "csv"
            logger.info(f"[Node 1] CSV parsed: {actual_row_count:,} rows × {actual_col_count} columns (analyzing first {len(df)} rows)")
        except Exception as e:
            logger.warning(f"[Node 1] CSV parse failed: {e}")
            # Try Excel
            try:
                logger.info("[Node 1] Attempting Excel parse (first 5 rows only for analysis)...")
                excel_file = io.BytesIO(file_content)
                xls = pd.ExcelFile(excel_file)
                full_tables = {}
                for sheet_name in xls.sheet_names:
                    # Detect which row is actually the header — skip banner /
                    # title rows so we don't end up with "Unnamed: N" columns
                    # spread across what was really blank padding.
                    header_row = _detect_excel_header_row(excel_file, sheet_name)
                    if header_row > 0:
                        logger.info(
                            f"[Node 1] Sheet {sheet_name}: skipping {header_row} banner row(s) "
                            f"before real header at row {header_row}"
                        )

                    # First pass: get actual row count
                    excel_file.seek(0)
                    df_full = pd.read_excel(
                        excel_file,
                        sheet_name=sheet_name,
                        dtype=str,
                        header=header_row,
                    )
                    df_full = _sanitize_column_names(df_full)
                    actual_row_count = len(df_full)
                    actual_col_count = len(df_full.columns)

                    # Second pass: use only first 5 rows for analysis
                    excel_file.seek(0)  # Reset file pointer
                    df = pd.read_excel(
                        excel_file,
                        sheet_name=sheet_name,
                        dtype=str,
                        nrows=5,
                        header=header_row,
                    )
                    df = _sanitize_column_names(df)
                    parsed_tables[sheet_name] = _sanitize_records(df.to_dict(orient="records"))

                    # STORE FULL FILE separately for Node 5+ processing
                    full_tables[sheet_name] = _sanitize_records(df_full.to_dict(orient="records"))

                    logger.info(f"[Node 1] Sheet {sheet_name}: {actual_row_count:,} rows × {actual_col_count} columns (analyzing first {len(df)} rows)")

                # Store full tables for later nodes
                state["full_tables"] = full_tables
                state["detected_file_format"] = "excel"
            except Exception as e2:
                logger.error(f"[Node 1] Excel parse failed: {e2}")
                state["error_message"] = f"Could not parse file: {str(e2)}"
                state["error_node"] = 1
                return state

        # ── Step 5: Analyze data quality (on sample only, but report full file size) ──────────────────────────────
        state["parsed_tables"] = parsed_tables

        # Calculate table health (based on sample, but report actual full file counts)
        # IMPORTANT: Include ALL tables, even if empty, so user can see completeness of all sheets
        table_health = {}
        for table_name, records in parsed_tables.items():
            if not records:
                # Empty table - still include it with 0% completeness
                table_health[table_name] = {
                    "row_count": 0,
                    "column_count": 0,
                    "null_percentages": {},
                    "avg_null_percentage": 0.0,
                }
                continue

            df = pd.DataFrame(records)
            sample_row_count = len(df)
            col_count = len(df.columns)
            total_rows = actual_row_count  # Use ACTUAL full file row count
            total_columns = max(total_columns, col_count)

            # Calculate null percentage per column (on sample only)
            null_pcts = {}
            for col in df.columns:
                null_pcts[col] = float((df[col].isna().sum() / sample_row_count) * 100)

            table_health[table_name] = {
                "row_count": total_rows,  # Report ACTUAL row count from full file
                "column_count": col_count,
                "null_percentages": null_pcts,
                "avg_null_percentage": sum(null_pcts.values()) / len(null_pcts) if null_pcts else 0,
            }

        state["table_health"] = table_health
        state["row_count"] = total_rows
        state["column_count"] = total_columns

        # ── Node 1 overall summary (WP-5: 7-node flow, Node 1) ─────────────
        # Consolidated per-table + dataset stats so the UI can show an
        # "overall summary" immediately after ingestion.
        summary_tables = []
        total_rows_all = 0
        for tname, th in table_health.items():
            rows = int(th.get("row_count", 0) or 0)
            total_rows_all += rows
            summary_tables.append({
                "name": tname,
                "rows": rows,
                "columns": int(th.get("column_count", 0) or 0),
                "avg_null_pct": round(float(th.get("avg_null_percentage", 0.0) or 0.0), 1),
            })
        overall_summary = {
            "table_count": len(table_health),
            "total_rows": total_rows_all,
            "total_columns": total_columns,
            "detected_format": state.get("detected_file_format", "unknown"),
            "tables": summary_tables,
        }
        state["overall_summary"] = overall_summary

        # ── Table-level CAFM match (Excel sheet → plenum_cafm table) ───────
        # Surfaces the source→target table comparison directly in the File
        # Ingestion card (e.g. assets→assets, sites_2→sites). Deterministic name
        # match first, then one Haiku call for the leftovers. Non-fatal: any
        # failure just yields an empty/partial map and the card shows "no match".
        cafm_table_matches: dict[str, str | None] = {}
        try:
            from ...db import get_plenum_cafm_columns_by_table
            from ...matchers import match_tables_to_cafm
            from ...app import get_anthropic_client as _get_client

            _columns_by_table = await get_plenum_cafm_columns_by_table()
            _cafm_tables = sorted(_columns_by_table.keys())
            _source_tables = {
                name: (list(records[0].keys()) if records else [])
                for name, records in parsed_tables.items()
            }
            if _cafm_tables and _source_tables:
                cafm_table_matches = await match_tables_to_cafm(
                    _source_tables, _cafm_tables, _get_client()
                )
                logger.info(f"[Node 1] CAFM table matches: {cafm_table_matches}")
        except Exception as e:
            logger.warning(f"[Node 1] CAFM table match skipped: {e}")
        state["cafm_table_matches"] = cafm_table_matches
        overall_summary["cafm_table_matches"] = cafm_table_matches

        # ── Step 6: Generate dataset summary (via Haiku) ───────────────
        logger.info("[Node 1] Generating dataset description...")

        # Get first table for analysis
        first_table = next(iter(parsed_tables.values())) if parsed_tables else []
        if first_table:
            df = pd.DataFrame(first_table[:5])  # First 5 rows
            df_head_str = df.to_string()
            column_names = list(df.columns)

            # Import AsyncAnthropic here to avoid circular imports
            from ...app import get_anthropic_client

            client = get_anthropic_client()

            # Call describe_dataset (Haiku)
            column_descriptions = await describe_dataset(df_head_str, column_names, client)
            state["column_descriptions"] = column_descriptions
            logger.info(f"[Node 1] Column descriptions generated for {len(column_names)} columns")

            # Create human-readable summary
            summary = f"CMMS export: {state.get('cmms_name', 'Unknown')} system. "
            summary += f"{total_rows} total rows across {len(parsed_tables)} table(s). "
            if table_health:
                avg_health = sum(t["avg_null_percentage"] for t in table_health.values()) / len(
                    table_health
                )
                summary += f"Data quality: {100 - avg_health:.1f}% complete (avg)."
            state["dataset_summary"] = summary

        # ── Step 7: Try to auto-load stored mapping configuration ───────
        # Attempt to lookup a stored mapping based on source_system and table_name
        try:
            organization_id = state.get("organization_id")
            source_system = state.get("cmms_name", "").strip()
            table_name = next(iter(parsed_tables.keys())) if parsed_tables else "unknown"

            if organization_id and source_system:
                # Get a DB session for the lookup
                from ...db import get_async_session_factory
                session_factory = get_async_session_factory()

                async with session_factory() as session:
                    mapping_service = MappingService(session)
                    stored_mapping = await mapping_service.lookup_mapping(
                        organization_id=UUID(organization_id) if isinstance(organization_id, str) else organization_id,
                        source_system=source_system,
                        table_name=table_name,
                    )

                    if stored_mapping:
                        logger.info(
                            f"[Node 1] Auto-loaded stored mapping for {source_system}/{table_name}"
                        )
                        state["json_mapper"] = stored_mapping
                        state["mapping_source"] = "stored"
                    else:
                        logger.debug(
                            f"[Node 1] No stored mapping found for {source_system}/{table_name}"
                        )
                        state["mapping_source"] = "provided_or_default"
        except Exception as e:
            logger.warning(
                f"[Node 1] Failed to auto-load stored mapping: {str(e)}. Proceeding with provided config."
            )
            state["mapping_source"] = "provided_or_default"

        # ── EL-M.1 Validation ────────────────────────────────────────
        # Check: row_count > 0 and column_count > 0
        if state["row_count"] <= 0:
            logger.error("[Node 1] EL-M.1 FAILED: row_count == 0")
            state["error_message"] = "No data rows found in file"
            state["error_node"] = 1
            state["el_m1_passed"] = False
            return state

        if state["column_count"] <= 0:
            logger.error("[Node 1] EL-M.1 FAILED: column_count == 0")
            state["error_message"] = "No columns found in file"
            state["error_node"] = 1
            state["el_m1_passed"] = False
            return state

        state["el_m1_passed"] = True
        logger.info(
            f"[Node 1] EL-M.1 PASSED: {state['row_count']} rows × {state['column_count']} columns"
        )

        # ── Clear transient file bytes before checkpoint ───────────────
        state["source_file_bytes"] = None

        state["current_step"] = 1
        state["status"] = "running"
        state["event_log"].append(
            {
                "timestamp": datetime.utcnow().isoformat(),
                "event": "node_complete",
                "node": 1,
                "detail": f"Parsed {state['row_count']} rows",
            }
        )

        logger.info(f"[Node 1] Complete: {state['row_count']} rows, {state['column_count']} columns")

        migration_id = state.get("migration_id")
        if migration_id:
            from .db_writer import update_node_progress, write_step_pause
            await update_node_progress(
                migration_id, "1_ingest",
                total_fields=state.get("column_count", 0),
            )
            await write_step_pause(
                migration_id,
                "step_1_ingest",
                {
                    "node": 1,
                    "label": "Ingest & Configure",
                    "rows": state.get("row_count", 0),
                    "columns": state.get("column_count", 0),
                    "tables": list((state.get("full_tables") or {}).keys()),
                    "format": state.get("detected_file_format", "unknown"),
                    "table_health": state.get("table_health", {}),
                    "overall_summary": state.get("overall_summary", {}),
                    # Excel sheet → plenum_cafm table comparison (incl. LLM matches
                    # like sites_2 → sites) for the ingest card.
                    "cafm_table_matches": state.get("cafm_table_matches", {}),
                },
            )
            from .schema_db_writer import migration_append_node_log_auto
            await migration_append_node_log_auto(
                migration_id, 1, "File Ingestion", _node_started_at, datetime.utcnow(),
                output={"row_count": state.get("row_count", 0),
                        "column_count": state.get("column_count", 0),
                        "table_count": len(state.get("full_tables") or {}),
                        "tables": list((state.get("full_tables") or {}).keys()),
                        "detected_format": state.get("detected_file_format", "unknown"),
                        "overall_summary": state.get("overall_summary", {}),
                        "cafm_table_matches": state.get("cafm_table_matches", {})},
                logs=[f"Parsed {state.get('row_count', 0)} rows × {state.get('column_count', 0)} columns",
                      f"Detected format: {state.get('detected_file_format', 'unknown')}",
                      f"EL-M.1: {'PASSED' if state.get('el_m1_passed') else 'FAILED'}"],
            )

        return state

    except Exception as e:
        logger.exception(f"[Node 1] Unhandled exception: {e}")
        state["error_message"] = str(e)
        state["error_node"] = 1
        state["error_timestamp"] = datetime.utcnow()
        state["status"] = "failed"
        return state


def _detect_delimiter(sample_text: str) -> str:
    """
    Detect CSV delimiter by analyzing sample text.

    Common delimiters: , \t ; |

    Returns: Most likely delimiter (default: comma)
    """
    # Count occurrences of each delimiter in first 5 lines
    lines = sample_text.split("\n")[:5]
    delimiter_counts = {",": 0, "\t": 0, ";": 0, "|": 0}

    for line in lines:
        for delim in delimiter_counts:
            delimiter_counts[delim] += line.count(delim)

    # Find delimiter with most consistent count
    # (all lines should have roughly the same count)
    if delimiter_counts[","] > 0:
        return ","
    if delimiter_counts["\t"] > 0:
        return "\t"
    if delimiter_counts[";"] > 0:
        return ";"
    if delimiter_counts["|"] > 0:
        return "|"

    # Default to comma
    return ","
