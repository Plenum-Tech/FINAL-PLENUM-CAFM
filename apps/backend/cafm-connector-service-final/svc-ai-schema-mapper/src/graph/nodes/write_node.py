"""Node 9: Write to platform — GATE 3 HITL and final DB write (MULTI-TABLE).

Final gate before handoff:
1. Present IntermediateSchema summary for customer approval
2. Wait for GATE 3 approval
3. Apply generated SQL artifact directly to target DB
4. (Fallback) POST IntermediateSchema to svc-ingestion/api/ingest if SQL absent
4. Update migration_jobs table with completion status and output URLs
5. Mark migration complete
6. EL-M.9: IntermediateSchema validated + customer confirmed

All per-table data is embedded in the IntermediateSchema sent to svc-ingestion.
"""

import asyncio
import logging
from datetime import datetime
from datetime import date as _date
from typing import Optional
from uuid import UUID as _UUID
import uuid
import re
from decimal import Decimal

import aiohttp
from langgraph.errors import GraphInterrupt
from langgraph.types import interrupt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..state import ExtraFieldConfig, MigrationState
from ...models.migration import MigrationJob
from ...db import get_async_session_factory

from cafm_shared.logging import get_logger
logger = get_logger(__name__)

# plenum_cafm schema prefix used in all DDL
_SCHEMA = "plenum_cafm"
_SAFE_SQL_IDENT = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# Core plenum_cafm tables whose schema is managed by ORM migrations.
# The fallback write path must NEVER ALTER TABLE these — only filter to
# their existing columns.
_KNOWN_CORE_TABLES = frozenset({
    "assets", "work_orders", "spare_parts", "locations", "organizations",
    "users", "technicians", "vendors", "asset_categories", "maintenance_plans",
    "scheduled_maintenance", "work_order_tasks", "work_order_comments",
    "asset_readings", "asset_documents", "inventory_transactions",
})


# ── DDL Generation ────────────────────────────────────────────────────────────

def _infer_sql_type(sample_values: list) -> str:
    """Best-effort SQL type inference from sample values. Defaults to TEXT."""
    non_null = [v for v in (sample_values or []) if v is not None]
    if not non_null:
        return "TEXT"
    try:
        all(int(str(v)) for v in non_null[:5])
        return "INTEGER"
    except (ValueError, TypeError):
        pass
    try:
        all(float(str(v)) for v in non_null[:5])
        return "NUMERIC"
    except (ValueError, TypeError):
        pass
    return "TEXT"


def _build_migration_ddl_statements(
    extra_fields_config: list[ExtraFieldConfig],
    all_mappings_by_source_table: Optional[dict[str, list[dict]]] = None,
) -> list[dict]:
    """
    Generate DDL statements from Node 4 DDL intent decisions.

    For new tables, ALL confirmed T1+T2+human-mapped columns from the same source
    table are included in the CREATE TABLE — not just the explicitly-declared custom
    columns. This ensures the new table is complete.

    Returns a list of {"sql": "...", "description": "..."}.

    Order:
      1. CREATE TABLE for new tables (must come before ALTER TABLE on those tables)
      2. ALTER TABLE ADD COLUMN for existing tables
    """
    ddl: list[dict] = []

    # Group custom fields by target_table
    new_tables: dict[str, list[ExtraFieldConfig]] = {}
    existing_table_cols: dict[str, list[ExtraFieldConfig]] = {}

    for entry in extra_fields_config:
        if entry.get("storage_strategy") != "custom":
            continue  # raw_metadata and skip need no DDL

        target_table = entry.get("target_table")
        if not target_table:
            continue

        if entry.get("is_new_table", False):
            new_tables.setdefault(target_table, []).append(entry)
        else:
            existing_table_cols.setdefault(target_table, []).append(entry)

    # ── 1. CREATE TABLE for brand-new tables ─────────────────────────
    for table_name, columns in new_tables.items():
        pk_col = columns[0].get("new_table_pk", "id") or "id"
        pk_lower = pk_col.lower()
        source_table = columns[0].get("source_table", "")  # source sheet that maps to this new table
        _source_mappings = (all_mappings_by_source_table or {}).get(source_table, [])

        # If a mapped source column targets the PK name (e.g. asset_id → id), that column
        # IS the business key used for PK/FK relationships: emit it AS the primary key with
        # its real type instead of a synthetic UUID that would clash. Same for a custom PK.
        _pk_mapping = next(
            (m for m in _source_mappings if (m.get("target_field") or "").lower() == pk_lower),
            None,
        )
        _pk_custom = next(
            (c for c in columns if (c.get("custom_column_name") or "").lower() == pk_lower),
            None,
        )
        if _pk_mapping is not None:
            col_defs = [
                f"    {pk_col} {_infer_sql_type(_pk_mapping.get('sample_values') or [])} PRIMARY KEY"
            ]
        elif _pk_custom is not None:
            col_defs = [f"    {pk_col} {_pk_custom.get('data_type', 'TEXT')} PRIMARY KEY"]
        else:
            col_defs = [f"    {pk_col} UUID PRIMARY KEY DEFAULT gen_random_uuid()"]
        # Case-insensitive collision guard; created_at/updated_at are appended below,
        # so reserve them too (a source column of the same name must not be re-emitted).
        seen_lower: set[str] = {pk_lower, "created_at", "updated_at"}
        total_data_cols = 0

        # Include ALL T1+T2+human-mapped columns from the same source sheet.
        # These have already been mapped to canonical field names, so we use
        # their target_field values as the column names in the new table.
        if _source_mappings:
            for mapping in _source_mappings:
                target_field = mapping.get("target_field", "")
                if not target_field or target_field.lower() in seen_lower:
                    continue
                # Prefer a user-chosen SQL type (new-table data-type dropdown);
                # otherwise infer it from the sampled values.
                sql_type = (mapping.get("data_type") or "").strip() or _infer_sql_type(
                    mapping.get("sample_values") or []
                )
                col_defs.append(f"    {target_field} {sql_type}")
                seen_lower.add(target_field.lower())
                total_data_cols += 1

        # Add explicitly-declared custom columns (user-named via DDL intent)
        custom_col_count = 0
        for col in columns:
            col_name = col.get("custom_column_name")
            if not col_name or col_name.lower() in seen_lower:
                continue
            data_type = col.get("data_type", "TEXT")
            nullable_clause = "" if col.get("nullable", True) else " NOT NULL"
            col_defs.append(f"    {col_name} {data_type}{nullable_clause}")
            seen_lower.add(col_name.lower())
            custom_col_count += 1
            total_data_cols += 1

        col_defs.append("    created_at TIMESTAMPTZ NOT NULL DEFAULT now()")
        col_defs.append("    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()")

        col_block = ",\n".join(col_defs)
        sql = (
            f"CREATE TABLE IF NOT EXISTS {_SCHEMA}.{table_name} (\n"
            f"{col_block}\n"
            f");"
        )
        ddl.append({
            "sql": sql,
            "description": (
                f"CREATE TABLE {_SCHEMA}.{table_name} "
                f"({total_data_cols} columns: mapped + {custom_col_count} custom + PK + timestamps)"
            ),
        })

    # ── 2. ALTER TABLE ADD COLUMN for existing tables ─────────────────
    for table_name, columns in existing_table_cols.items():
        for col in columns:
            col_name = col.get("custom_column_name")
            data_type = col.get("data_type", "TEXT")
            nullable_clause = "" if col.get("nullable", True) else " NOT NULL"
            sql = (
                f"ALTER TABLE {_SCHEMA}.{table_name} "
                f"ADD COLUMN IF NOT EXISTS {col_name} {data_type}{nullable_clause};"
            )
            ddl.append({
                "sql": sql,
                "description": (
                    f"ALTER TABLE {_SCHEMA}.{table_name} "
                    f"ADD COLUMN {col_name} {data_type}"
                ),
            })

    return ddl


async def write_node(state: MigrationState) -> MigrationState:
    """
    Node 9: GATE 3 HITL and final handoff to svc-ingestion.

    Entry conditions:
    - intermediate_schema is built and validated (EL-M.8 passed)

    Execution:
    1. Prepare final summary for customer approval
    2. Call interrupt() to pause for GATE 3
    3. On resume: POST IntermediateSchema to svc-ingestion
    4. Mark migration as complete
    5. EL-M.9: Validate response from svc-ingestion
    """

    migration_id = state.get("migration_id")
    intermediate_schema = state.get("intermediate_schema")
    db_session = state.get("db_session")
    extra_fields_config: list[ExtraFieldConfig] = state.get("extra_fields_config", [])

    logger.info(f"[Node 9] Starting: migration_id={migration_id}")

    # ── Phase 0: DDL Execution (before GATE 3) ───────────────────────────
    # Execute DDL for any custom fields decided at Node 4 (GATE 1).
    # All statements run in a single transaction — full rollback on ANY failure.

    # Build all confirmed mappings keyed by source table so CREATE TABLE DDL
    # can include every T1+T2+human-mapped column for new tables.
    all_mappings_by_source_table: dict[str, list[dict]] = {}
    for tbl, mappings in state.get("tier1_mappings_by_table", {}).items():
        all_mappings_by_source_table.setdefault(tbl, []).extend(
            [m if isinstance(m, dict) else dict(m) for m in mappings]
        )
    for tbl, mappings in state.get("tier2_auto_by_table", {}).items():
        all_mappings_by_source_table.setdefault(tbl, []).extend(
            [m if isinstance(m, dict) else dict(m) for m in mappings]
        )
    for tbl, mappings in state.get("tier2_human_decisions_by_table", {}).items():
        all_mappings_by_source_table.setdefault(tbl, []).extend(
            [m if isinstance(m, dict) else dict(m) for m in mappings]
        )

    ddl_statements = _build_migration_ddl_statements(
        extra_fields_config,
        all_mappings_by_source_table=all_mappings_by_source_table,
    )

    custom_count = sum(1 for e in extra_fields_config if e.get("storage_strategy") == "custom")
    new_table_count = sum(1 for e in extra_fields_config if e.get("is_new_table"))
    logger.info(
        f"[Node 9] DDL plan: {len(ddl_statements)} statements "
        f"({custom_count} custom columns, {new_table_count} new tables)"
    )

    if ddl_statements:
        if not db_session:
            logger.warning(
                "[Node 9] No db_session in state — opening fallback session for DDL execution"
            )
            db_session = get_async_session_factory()()

        executed: list[str] = []
        try:
            for stmt in ddl_statements:
                sql = stmt["sql"]
                desc = stmt["description"]
                logger.info(f"[Node 9] Executing DDL: {desc}")
                await db_session.execute(text(sql))
                executed.append(desc)

            await db_session.commit()
            logger.info(f"[Node 9] ✓ DDL transaction committed ({len(executed)} statements)")

        except Exception as ddl_exc:
            try:
                await db_session.rollback()
            except Exception:
                pass

            failed_desc = (
                ddl_statements[len(executed)]["description"]
                if len(executed) < len(ddl_statements)
                else "unknown"
            )
            error_detail = (
                f"DDL execution failed at statement {len(executed) + 1}/{len(ddl_statements)}: "
                f"'{failed_desc}'. "
                f"Database error: {str(ddl_exc)[:300]}. "
                f"All {len(executed)} previously executed statements were rolled back."
            )
            logger.error(f"[Node 9] DDL ROLLBACK: {error_detail}")

            state["status"] = "ddl_failed"
            state["error_message"] = error_detail
            state["error_node"] = 9

            if migration_id:
                try:
                    from .db_writer import write_error
                    await write_error(
                        migration_id, error_detail,
                        error_node=9, status="ddl_failed"
                    )
                except Exception:
                    pass

            return state
    else:
        logger.info("[Node 9] No DDL statements (no custom columns requested)")

    if not intermediate_schema:
        logger.error("[Node 9] No IntermediateSchema found")
        state["error_message"] = "Missing IntermediateSchema from Node 8"
        state["error_node"] = 9
        return state

    # ── Write all confirmed field mappings to migration_field_mappings ───────
    # This is the ONLY place mappings are persisted. Gates 0/1/2 only update
    # in-memory state; the DB write happens here once, after everything is confirmed.
    if migration_id:
        try:
            from ...models.migration import MigrationFieldMapping

            session_factory = get_async_session_factory()
            mapping_rows: list[MigrationFieldMapping] = []

            # Tier 1 mappings (all tables)
            for table_name, mappings in state.get("tier1_mappings_by_table", {}).items():
                for m in mappings:
                    mapping_rows.append(MigrationFieldMapping(
                        migration_id=migration_id,
                        source_field=m.get("source_field", ""),
                        target_field=m.get("target_field", ""),
                        confidence=m.get("confidence", 0.0),
                        tier=m.get("tier", "T1"),
                        rationale=m.get("rationale", ""),
                        sample_values=m.get("sample_values", {}),
                        transformation=m.get("transformation"),
                    ))

            # Tier 2 auto-accepted mappings
            for table_name, mappings in state.get("tier2_auto_by_table", {}).items():
                for m in mappings:
                    mapping_rows.append(MigrationFieldMapping(
                        migration_id=migration_id,
                        source_field=m.get("source_field", ""),
                        target_field=m.get("target_field", ""),
                        confidence=m.get("confidence", 0.0),
                        tier=m.get("tier", "T2_semantic"),
                        rationale=m.get("rationale", ""),
                        sample_values=m.get("sample_values", {}),
                        transformation=m.get("transformation"),
                    ))

            # Tier 2 human-confirmed mappings (Gate 1 decisions — in-memory only until now)
            for table_name, mappings in state.get("tier2_human_decisions_by_table", {}).items():
                for m in mappings:
                    sf = m.get("source_field") if isinstance(m, dict) else getattr(m, "source_field", "")
                    tf = m.get("target_field") if isinstance(m, dict) else getattr(m, "target_field", "")
                    conf = m.get("confidence", 0.0) if isinstance(m, dict) else getattr(m, "confidence", 0.0)
                    rat = m.get("rationale", "") if isinstance(m, dict) else getattr(m, "rationale", "")
                    rev_id = m.get("reviewer_id") if isinstance(m, dict) else getattr(m, "reviewer_id", None)
                    if rev_id and not isinstance(rev_id, _UUID):
                        try:
                            rev_id = _UUID(str(rev_id))
                        except Exception:
                            rev_id = None
                    mapping_rows.append(MigrationFieldMapping(
                        migration_id=migration_id,
                        source_field=sf,
                        target_field=tf,
                        confidence=conf,
                        tier="T2_human",
                        rationale=rat,
                        sample_values={},
                        reviewer_id=rev_id,
                    ))

            if mapping_rows:
                async with session_factory() as session:
                    session.add_all(mapping_rows)
                    await session.commit()
                logger.info(f"[Node 9] ✓ Wrote {len(mapping_rows)} field mappings to DB")
            else:
                logger.info("[Node 9] No field mappings to write")

        except Exception as map_err:
            logger.error(f"[Node 9] Failed to write field mappings (non-fatal): {map_err}")
            # Non-fatal — handoff can still proceed

    try:
        # ── Prepare GATE 3 approval payload ──────────────────────────────
        entity_counts = {}
        for entity_type, records in intermediate_schema.get("entities", {}).items():
            if records:
                entity_counts[entity_type] = len(records)

        gate3_payload = {
            "migration_id": migration_id,
            "summary": {
                "source_type": intermediate_schema.get("source_type"),
                "source_filename": intermediate_schema.get("source_filename"),
                "overall_confidence": intermediate_schema.get("confidence", {}).get("eval_score", 0),
                "entity_counts": entity_counts,
                "total_entities": sum(entity_counts.values()),
            },
            "instructions": (
                "Review the migration summary. Click CONFIRM to send to svc-ingestion or REJECT to return for corrections."
            ),
        }

        logger.info(f"[Node 9] Interrupting for GATE 3 final approval")
        for entity_type, count in entity_counts.items():
            logger.info(f"[Node 9]   {entity_type}: {count}")

        state["write_review_payload"] = gate3_payload

        # ── Write gate payload to DB so frontend can render GATE 3 UI ──
        if migration_id:
            from .db_writer import write_gate_payload
            await write_gate_payload(migration_id, "write", gate3_payload)

        # ── Interrupt for customer approval ──────────────────────────
        gate3_decision = interrupt(gate3_payload)

        # ── Clear gate payload now that we have a decision ─────────────
        if migration_id:
            from .db_writer import clear_gate_payload
            await clear_gate_payload(migration_id)

        # ── Process GATE 3 decision ──────────────────────────────────
        # Frontend sends { confirmed: true/false }; legacy format uses { action: "confirm" }
        if "confirmed" in gate3_decision:
            action = "confirm" if gate3_decision.get("confirmed") else "reject"
        else:
            action = gate3_decision.get("action", "reject")

        if action != "confirm":
            logger.warning(f"[Node 9] GATE 3 REJECTED by customer")
            state["handoff_status"] = "rejected"
            state["error_message"] = "Customer rejected handoff at GATE 3"
            state["current_step"] = 9
            state["event_log"].append({
                "timestamp": datetime.utcnow().isoformat(),
                "event": "gate3_rejected",
                "node": 9,
                "detail": "Customer rejected IntermediateSchema"
            })
            return state

        logger.info(f"[Node 9] GATE 3 CONFIRMED - proceeding with handoff")

        # ── Primary write path: apply generated SQL artifact directly ─────────
        sql_script = (state.get("output_sql_script") or "").strip()
        if sql_script:
            logger.info("[Node 9] Applying output SQL artifact directly to target DB")
            try:
                sql_apply_result = await _apply_sql_artifact(sql_script)
                state["handoff_status"] = "applied_sql"
                state["svc_ingestion_response"] = {
                    "status": "applied_sql",
                    **sql_apply_result,
                }
                logger.info(
                    "[Node 9] ✓ SQL artifact applied: "
                    f"{sql_apply_result['statement_count']} statement(s)"
                )
            except Exception as e:
                # Primary SQL artifact uses schema-mapper canonical names which may
                # not match the target DB schema. Always fall back to schema-aligned
                # inserts from cleaned_tables when they are available.
                logger.warning(
                    f"[Node 9] SQL artifact failed ({type(e).__name__}: "
                    f"{str(e)[:150]}); trying schema-aligned inserts"
                )
                if isinstance(state.get("cleaned_tables"), dict):
                    try:
                        aligned_result = await _apply_records_with_schema_alignment(
                            cleaned_tables=state.get("cleaned_tables", {}),
                            organization_id=str(state.get("organization_id") or ""),
                        )
                        state["handoff_status"] = "applied_sql_aligned"
                        state["svc_ingestion_response"] = {
                            "status": "applied_sql_aligned",
                            **aligned_result,
                        }
                        logger.info(
                            "[Node 9] ✓ Schema-aligned inserts applied: "
                            f"{aligned_result.get('rows_inserted', 0)} row(s) across "
                            f"{aligned_result.get('tables_written', 0)} table(s), "
                            f"{aligned_result.get('rows_skipped', 0)} skipped"
                        )
                    except Exception as aligned_exc:
                        logger.exception(
                            f"[Node 9] Schema-aligned fallback also failed: {aligned_exc}"
                        )
                        state["error_message"] = (
                            f"SQL artifact failed ({type(e).__name__}): {str(e)[:200]}; "
                            f"schema-aligned fallback failed: {str(aligned_exc)[:200]}"
                        )
                        state["error_node"] = 9
                        state["el_m9_passed"] = False
                        return state
                else:
                    logger.error(
                        f"[Node 9] SQL artifact failed and no cleaned_tables for fallback: {e}"
                    )
                    state["error_message"] = f"SQL artifact apply failed: {str(e)[:300]}"
                    state["error_node"] = 9
                    state["el_m9_passed"] = False
                    return state
        else:
            # ── Fallback: POST to svc-ingestion when SQL artifact is unavailable ─
            svc_ingestion_url = await _get_svc_ingestion_url()
            endpoint = f"{svc_ingestion_url}/api/ingest"

            logger.info(f"[Node 9] SQL artifact missing; POSTing IntermediateSchema to {endpoint}")

            try:
                response_json = await _post_to_svc_ingestion(
                    endpoint=endpoint,
                    payload=intermediate_schema
                )

                logger.info(f"[Node 9] ✓ svc-ingestion accepted")
                state["handoff_status"] = "sent"
                state["svc_ingestion_response"] = response_json

            except Exception as e:
                logger.exception(f"[Node 9] Failed to POST to svc-ingestion: {e}")
                state["error_message"] = f"svc-ingestion handoff failed: {str(e)}"
                state["error_node"] = 9
                state["el_m9_passed"] = False
                return state

        # ── EL-M.9 Validation ────────────────────────────────────────
        if state.get("handoff_status") not in [
            "sent",
            "acknowledged",
            "applied_sql",
            "applied_sql_aligned",
        ]:
            logger.error("[Node 9] EL-M.9 FAILED: svc-ingestion did not acknowledge")
            state["el_m9_passed"] = False
            return state

        state["el_m9_passed"] = True
        logger.info("[Node 9] EL-M.9 PASSED: IntermediateSchema sent and acknowledged")

        # ── Update migration_jobs database record ──────────────────────
        try:
            session_factory = get_async_session_factory()
            async with session_factory() as session:
                db_migration = await session.get(MigrationJob, migration_id)
                if db_migration:
                    db_migration.status = "complete"
                    db_migration.completed_at = datetime.utcnow()
                    db_migration.output_json_url = state.get("output_json_url")
                    db_migration.output_csv_url = state.get("output_csv_url")
                    db_migration.output_sql_url = state.get("output_sql_url")
                    db_migration.migration_report_url = state.get("migration_report_url")
                    db_migration.progress_pct = 100.0
                    await session.commit()
                    logger.info(f"[Node 9] Updated migration_jobs: status=complete")
                else:
                    logger.warning(f"[Node 9] Migration record {migration_id} not found in DB")

        except Exception as e:
            logger.exception(f"[Node 9] Failed to update migration_jobs: {e}")
            # Continue anyway — state is already updated
            state["error_message"] = f"DB update failed (handoff sent): {str(e)}"

        # ── Mark migration complete ──────────────────────────────────
        state["status"] = "complete"
        state["current_step"] = 9
        state["event_log"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "event": "node_complete",
            "node": 9,
            "detail": f"Handoff to svc-ingestion: {state.get('handoff_status')}"
        })

        logger.info(f"[Node 9] ═══════════════════════════════════════════")
        logger.info(f"[Node 9] ✓ MIGRATION COMPLETE")
        logger.info(f"[Node 9] Status: {state.get('handoff_status')}")

        if migration_id:
            from .db_writer import update_node_progress
            await update_node_progress(
                migration_id, "9_complete",
                status="complete",
            )

        # ── Save updated registry snapshot to DB ─────────────────────────────
        # Persists any newly learned aliases from this migration run so that
        # future startups load them from the DB cache instead of introspecting.
        try:
            from ...services.registry_cache import save_new_version, compute_schema_hash
            from ...config import get_settings as _get_settings
            _db_url = _get_settings().db_url
            _mapper = state.get("mapper_config", {})
            _hash = compute_schema_hash(_mapper.get("canonical_fields", {}))
            _ver = await save_new_version(_db_url, _mapper, _hash)
            logger.info(f"[Node 9] Registry snapshot saved as v{_ver}")
        except Exception as _reg_exc:
            logger.warning(f"[Node 9] Registry snapshot save failed (non-fatal): {_reg_exc}")

        return state

    except GraphInterrupt:
        raise

    except Exception as e:
        logger.exception(f"[Node 9] Unhandled exception: {e}")
        state["error_message"] = str(e)
        state["error_node"] = 9
        state["error_timestamp"] = datetime.utcnow()
        state["status"] = "failed"
        state["el_m9_passed"] = False
        return state


async def _get_svc_ingestion_url() -> str:
    """Get svc-ingestion endpoint URL from config or default."""
    try:
        from ...config import settings
        return settings.svc_ingestion_url or "http://svc-ingestion:8001"
    except Exception:
        return "http://svc-ingestion:8001"


async def _post_to_svc_ingestion(endpoint: str, payload: dict) -> dict:
    """
    POST IntermediateSchema to svc-ingestion /api/ingest endpoint.

    Args:
        endpoint: Full URL to svc-ingestion API endpoint
        payload: IntermediateSchema dict to POST

    Returns:
        Response JSON from svc-ingestion

    Raises:
        Exception if POST fails or returns non-2xx status
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=3600),
            ) as response:
                response_text = await response.text()

                if response.status not in [200, 202, 201]:
                    error_msg = f"HTTP {response.status}: {response_text[:200]}"
                    logger.error(f"[Node 9] svc-ingestion error: {error_msg}")
                    raise Exception(error_msg)

                try:
                    response_json = await response.json()
                    logger.info(f"[Node 9] svc-ingestion response: {response.status}")
                    return response_json
                except Exception as e:
                    logger.warning(f"[Node 9] Could not parse response JSON: {e}")
                    # Return minimal response if JSON parsing fails
                    return {"status": "sent", "http_status": response.status}

    except aiohttp.ClientError as e:
        logger.error(f"[Node 9] Network error: {e}")
        raise Exception(f"Network error connecting to svc-ingestion: {str(e)}")
    except asyncio.TimeoutError:
        logger.error(f"[Node 9] Request timeout")
        raise Exception("Request to svc-ingestion timed out after 60 seconds")


def _split_sql_statements(sql_script: str) -> list[str]:
    """
    Split SQL script into executable statements while handling quoted semicolons.
    """
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    prev = ""

    for ch in sql_script:
        if ch == "'" and not in_double_quote and prev != "\\":
            in_single_quote = not in_single_quote
        elif ch == '"' and not in_single_quote and prev != "\\":
            in_double_quote = not in_double_quote

        if ch == ";" and not in_single_quote and not in_double_quote:
            stmt = "".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
        else:
            current.append(ch)
        prev = ch

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)

    cleaned: list[str] = []
    for stmt in statements:
        lines = []
        for line in stmt.splitlines():
            striped = line.strip()
            if not striped or striped.startswith("--"):
                continue
            lines.append(line)
        final_stmt = "\n".join(lines).strip()
        if final_stmt:
            cleaned.append(final_stmt)
    return cleaned


async def _apply_sql_artifact(sql_script: str) -> dict:
    """
    Execute generated SQL artifact inside one transaction.
    """
    statements = _split_sql_statements(sql_script)
    if not statements:
        raise Exception("output.sql is empty or contains no executable statements")

    session_factory = get_async_session_factory()
    async with session_factory() as session:
        try:
            for stmt in statements:
                await session.execute(text(stmt))
            await session.commit()
        except Exception:
            await session.rollback()
            raise

    return {"statement_count": len(statements)}


def _normalize_row_for_table(table_name: str, row: dict, organization_id: str) -> dict:
    """
    Best-effort canonicalization for common migration table payloads.
    """
    normalized = dict(row or {})
    t = table_name.lower()

    if organization_id:
        normalized.setdefault("organization_id", organization_id)

    if t == "assets":
        # asset_id → id: if the source carries a UUID-shaped PK, preserve it.
        # The insert path auto-generates id=uuid4() only when id is absent, so
        # mapping here lets idempotent re-runs hit the ON CONFLICT clause instead
        # of inserting duplicates. Non-UUID values are left to the per-row
        # exception handler (row skipped, logged).
        if "asset_id" in normalized:
            if "id" not in normalized:
                normalized["id"] = normalized.pop("asset_id")
            else:
                normalized.pop("asset_id")

        # asset_type has no direct column; repurpose as asset_code fallback.
        if "asset_type" in normalized:
            if not normalized.get("asset_code"):
                normalized["asset_code"] = normalized.pop("asset_type")
            else:
                normalized.pop("asset_type")

        # FK columns that require UUID resolution — cannot be filled from a text
        # value at write time, so drop them rather than creating phantom columns.
        for _fk_col in ("site_id", "location", "location_code", "category"):
            normalized.pop(_fk_col, None)

        # serial → serial_number (move so the old key doesn't surface as missing)
        if "serial" in normalized:
            if "serial_number" not in normalized:
                normalized["serial_number"] = normalized.pop("serial")
            else:
                normalized.pop("serial")

        # install_date → installation_date (move)
        if "install_date" in normalized:
            if "installation_date" not in normalized:
                normalized["installation_date"] = normalized.pop("install_date")
            else:
                normalized.pop("install_date")

        # asset_name is NOT NULL — derive it from any available identifier.
        if not normalized.get("asset_name"):
            normalized["asset_name"] = (
                normalized.get("name")
                or normalized.get("asset")
                or normalized.get("asset_code")
                or "Unknown Asset"
            )
    elif t == "locations":
        if "site_name" in normalized and "name" not in normalized:
            normalized["name"] = normalized.get("site_name")
        if "location_name" in normalized and "name" not in normalized:
            normalized["name"] = normalized.get("location_name")
        if "site_type" in normalized and "type" not in normalized:
            normalized["type"] = normalized.get("site_type")
        if not normalized.get("type"):
            normalized["type"] = "site"
    elif t == "work_orders":
        # work_order_id is NOT NULL in the actual DB schema — map from any available code.
        if not normalized.get("work_order_id"):
            normalized["work_order_id"] = (
                normalized.get("wo_code")
                or normalized.get("work_order_number")
                or normalized.get("wo_number")
                or normalized.get("order_number")
            )
        if not normalized.get("title"):
            normalized["title"] = (
                normalized.get("description")
                or normalized.get("wo_code")
                or normalized.get("work_order_number")
                or normalized.get("work_order_id")
                or "Work Order"
            )
    return normalized


def _infer_sql_type_for_value(value: object) -> str:
    """
    Conservative type inference for newly added columns.
    """
    if isinstance(value, bool):
        return "BOOLEAN"
    if isinstance(value, int):
        return "BIGINT"
    if isinstance(value, float):
        return "DOUBLE PRECISION"
    # Keep unknown/string-like values as TEXT to avoid write failures.
    return "TEXT"


def _to_safe_identifier(raw: str) -> str | None:
    """
    Normalize and validate SQL identifier for dynamic column creation.
    """
    if raw is None:
        return None
    normalized = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    normalized = re.sub(r"[^a-z0-9_]", "", normalized)
    if not _SAFE_SQL_IDENT.match(normalized):
        return None
    return normalized


def _build_dml_for_row(schema_name: str, table_name: str, filtered: dict) -> tuple[str, dict]:
    """
    Build INSERT/UPSERT statement per table with conflict-safe behavior.
    """
    cols = list(filtered.keys())
    col_sql = ", ".join(cols)
    val_sql = ", ".join(f":{c}" for c in cols)

    # Domain-aware upsert for assets to prevent duplicate-key failures and keep data fresh.
    if table_name == "assets":
        updatable = [
            c for c in cols
            if c not in {"id", "organization_id", "serial_number", "asset_code"}
        ]
        set_sql = ", ".join(f"{c} = EXCLUDED.{c}" for c in updatable)
        if "organization_id" in cols and "serial_number" in cols:
            return (
                f"INSERT INTO {schema_name}.{table_name} ({col_sql}) VALUES ({val_sql}) "
                f"ON CONFLICT (organization_id, serial_number) DO UPDATE SET {set_sql}"
                if set_sql
                else
                f"INSERT INTO {schema_name}.{table_name} ({col_sql}) VALUES ({val_sql}) "
                f"ON CONFLICT (organization_id, serial_number) DO NOTHING",
                filtered,
            )
        if "organization_id" in cols and "asset_code" in cols:
            return (
                f"INSERT INTO {schema_name}.{table_name} ({col_sql}) VALUES ({val_sql}) "
                f"ON CONFLICT (organization_id, asset_code) DO UPDATE SET {set_sql}"
                if set_sql
                else
                f"INSERT INTO {schema_name}.{table_name} ({col_sql}) VALUES ({val_sql}) "
                f"ON CONFLICT (organization_id, asset_code) DO NOTHING",
                filtered,
            )

    return (
        f"INSERT INTO {schema_name}.{table_name} ({col_sql}) VALUES ({val_sql}) "
        f"ON CONFLICT DO NOTHING",
        filtered,
    )


def _coerce_value_for_db_type(value: object, db_type: str) -> object:
    """
    Convert incoming values to best-effort Python type expected by asyncpg.
    """
    if value is None:
        return None
    t = (db_type or "").lower()

    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None

        if "timestamp" in t:
            s2 = s.replace("Z", "+00:00")
            try:
                return datetime.fromisoformat(s2)
            except Exception:
                return value
        if t == "date":
            try:
                return _date.fromisoformat(s[:10])
            except Exception:
                return value
        if "int" in t:
            try:
                return int(s)
            except Exception:
                return value
        if "numeric" in t or "decimal" in t or "double" in t or "real" in t:
            try:
                return Decimal(s)
            except Exception:
                return value
        if t == "boolean":
            low = s.lower()
            if low in {"1", "true", "t", "yes", "y"}:
                return True
            if low in {"0", "false", "f", "no", "n"}:
                return False
            return value
    return value


async def _apply_records_with_schema_alignment(
    cleaned_tables: dict,
    organization_id: str,
    schema_name: str = "plenum_cafm",
) -> dict:
    """
    Insert cleaned records while filtering to real DB columns.
    """
    session_factory = get_async_session_factory()
    rows_inserted = 0
    tables_written = 0
    rows_skipped = 0
    row_errors: list[str] = []

    async with session_factory() as session:
        try:
            # Defensive: the primary SQL-artifact path can fail mid-INSERT (e.g. a
            # mapped column that doesn't exist) and leave the pooled connection in an
            # aborted-transaction state. Roll back to a clean state BEFORE the first
            # query, otherwise it dies with asyncpg's "Can't reconnect until invalid
            # transaction is rolled back" and this fallback never gets to filter the
            # bad column out.
            try:
                await session.rollback()
            except Exception:
                pass
            effective_org_id = await _resolve_valid_organization_id(
                session=session,
                requested_org_id=organization_id,
                schema_name=schema_name,
            )
            for table_name, records in cleaned_tables.items():
                if not isinstance(records, list) or not records:
                    continue
                safe_table = _to_safe_identifier(table_name)
                if not safe_table:
                    logger.warning(
                        f"[Node 9] Skipping unsafe table name for DB sync: {table_name!r}"
                    )
                    continue

                _tbl_started_at = datetime.utcnow()
                logger.info(f"[Node 9] ► Table '{safe_table}': {len(records)} records")
                cols_rs = await session.execute(
                    text(
                        """
                        SELECT column_name, data_type
                        FROM information_schema.columns
                        WHERE table_schema = :schema_name AND table_name = :table_name
                        """
                    ),
                    {"schema_name": schema_name, "table_name": safe_table},
                )
                db_col_type_map = {str(r[0]): str(r[1]) for r in cols_rs.fetchall()}
                db_cols = set(db_col_type_map.keys())
                if db_cols:
                    logger.info(f"[Node 9]   {safe_table}: {len(db_cols)} DB columns found")
                if not db_cols:
                    # Table does not exist in target schema; create it from incoming shape.
                    sample_row = next(
                        (r for r in records if isinstance(r, dict) and r),
                        {},
                    )
                    inferred_cols: dict[str, str] = {
                        "id": "UUID PRIMARY KEY",
                        "organization_id": "UUID",
                    }
                    for raw_k, raw_v in sample_row.items():
                        safe_k = _to_safe_identifier(str(raw_k))
                        if not safe_k or safe_k in {"id", "organization_id"}:
                            continue
                        inferred_cols[safe_k] = _infer_sql_type_for_value(raw_v)

                    col_defs = ", ".join(f"{k} {v}" for k, v in inferred_cols.items())
                    await session.execute(
                        text(
                            f"CREATE TABLE IF NOT EXISTS {schema_name}.{safe_table} "
                            f"({col_defs})"
                        )
                    )
                    logger.warning(
                        f"[Node 9] Created missing table {schema_name}.{safe_table} "
                        f"with {len(inferred_cols)} columns"
                    )

                    # Re-read columns after CREATE TABLE
                    cols_rs = await session.execute(
                        text(
                            """
                            SELECT column_name, data_type
                            FROM information_schema.columns
                            WHERE table_schema = :schema_name AND table_name = :table_name
                            """
                        ),
                        {"schema_name": schema_name, "table_name": safe_table},
                    )
                    db_col_type_map = {str(r[0]): str(r[1]) for r in cols_rs.fetchall()}
                    db_cols = set(db_col_type_map.keys())
                    if not db_cols:
                        continue

                # Collect missing columns from normalized records and add them to DB first.
                missing_columns: dict[str, str] = {}
                normalized_records: list[dict] = []
                for row in records:
                    if not isinstance(row, dict):
                        continue
                    normalized = _normalize_row_for_table(
                        safe_table, row, effective_org_id
                    )
                    safe_row: dict[str, object] = {}
                    for raw_k, raw_v in normalized.items():
                        safe_k = _to_safe_identifier(str(raw_k))
                        if not safe_k:
                            continue
                        safe_row[safe_k] = raw_v
                        if safe_k not in db_cols and safe_k not in missing_columns:
                            if raw_v is not None and str(raw_v) != "":
                                missing_columns[safe_k] = _infer_sql_type_for_value(raw_v)
                    normalized_records.append(safe_row)

                if missing_columns and safe_table in _KNOWN_CORE_TABLES:
                    logger.warning(
                        f"[Node 9] Dropping {len(missing_columns)} unknown column(s) "
                        f"from core table {safe_table}: {sorted(missing_columns)!r} "
                        "— schema is ORM-managed, ALTER TABLE skipped"
                    )
                    missing_columns = {}

                for col_name, col_type in missing_columns.items():
                    await session.execute(
                        text(
                            f"ALTER TABLE {schema_name}.{safe_table} "
                            f"ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
                        )
                    )
                    logger.info(
                        f"[Node 9] Added missing column {schema_name}.{safe_table}.{col_name} "
                        f"({col_type})"
                    )
                if missing_columns:
                    # keep local set in sync for filtering inserts below
                    db_cols.update(missing_columns.keys())
                    # Newly created columns use inferred SQL types.
                    db_col_type_map.update(missing_columns)

                # Log column acceptance/rejection for this table
                if normalized_records:
                    _first_row = normalized_records[0]
                    _accepted = [k for k in _first_row if k in db_cols]
                    _rejected = [k for k in _first_row if k not in db_cols]
                    if _rejected:
                        logger.info(
                            f"[Node 9]   {safe_table}: accepting {len(_accepted)} columns, "
                            f"dropping {len(_rejected)} unknown: {_rejected[:8]!r}"
                        )
                    else:
                        logger.info(
                            f"[Node 9]   {safe_table}: {len(_accepted)} columns accepted"
                        )

                # If the table's PK is a serial/integer, never inject a UUID
                # string into it — let the DB sequence auto-generate it.
                _id_db_type = db_col_type_map.get("id", "").lower()
                _id_is_serial = any(t in _id_db_type for t in ("int", "serial", "bigint"))
                if _id_is_serial:
                    logger.info(
                        f"[Node 9]   {safe_table}: id is integer/serial — "
                        "skipping id column, DB will auto-generate"
                    )

                tbl_rows_skipped = 0
                table_rows = 0
                for normalized in normalized_records:
                    filtered = {
                        k: v for k, v in normalized.items()
                        if k in db_cols and v is not None and str(v) != ""
                        and not (k == "id" and _id_is_serial)
                    }

                    if "id" in db_cols and "id" not in filtered and not _id_is_serial:
                        filtered["id"] = str(uuid.uuid4())

                    if not filtered:
                        continue

                    for k in list(filtered.keys()):
                        filtered[k] = _coerce_value_for_db_type(
                            filtered[k], db_col_type_map.get(k, "")
                        )

                    try:
                        dml_sql, params = _build_dml_for_row(
                            schema_name, safe_table, filtered
                        )
                        # SAVEPOINT per row: a failed INSERT must not abort the
                        # outer transaction, which would poison every subsequent
                        # session.execute() call (InFailedSQLTransactionError).
                        _row_count = 0
                        async with session.begin_nested():
                            result = await session.execute(text(dml_sql), params)
                            _row_count = int(getattr(result, "rowcount", 0) or 0)
                        table_rows += _row_count
                    except Exception as row_exc:
                        rows_skipped += 1
                        tbl_rows_skipped += 1
                        if len(row_errors) < 20:
                            row_errors.append(
                                f"{safe_table}: {str(row_exc)[:220]}"
                            )
                        logger.warning(
                            f"[Node 9] Skipping bad row in {safe_table}: {row_exc}"
                        )
                        continue

                _tbl_elapsed = (datetime.utcnow() - _tbl_started_at).total_seconds()
                if table_rows > 0:
                    tables_written += 1
                    rows_inserted += table_rows
                    logger.info(
                        f"[Node 9]   {safe_table}: ✓ {table_rows} inserted, "
                        f"{tbl_rows_skipped} skipped ({_tbl_elapsed:.1f}s)"
                    )
                elif tbl_rows_skipped:
                    logger.warning(
                        f"[Node 9]   {safe_table}: 0 inserted, {tbl_rows_skipped} skipped "
                        f"({_tbl_elapsed:.1f}s)"
                    )
                else:
                    logger.info(
                        f"[Node 9]   {safe_table}: 0 rows to insert ({_tbl_elapsed:.1f}s)"
                    )

            logger.info(
                f"[Node 9] Schema-aligned write done — "
                f"{rows_inserted} row(s) across {tables_written} table(s), "
                f"{rows_skipped} skipped"
            )
            await session.commit()
        except Exception:
            await session.rollback()
            raise

    return {
        "rows_inserted": rows_inserted,
        "tables_written": tables_written,
        "rows_skipped": rows_skipped,
        "row_errors": row_errors,
    }


async def _resolve_valid_organization_id(
    session: AsyncSession,
    requested_org_id: str,
    schema_name: str,
) -> str:
    """
    Ensure organization_id used for inserts exists in organizations table.
    """
    requested = (requested_org_id or "").strip()
    if requested:
        try:
            _found = False
            # SAVEPOINT: a failed SELECT must not abort the outer transaction.
            async with session.begin_nested():
                exists_rs = await session.execute(
                    text(
                        f"SELECT 1 FROM {schema_name}.organizations "
                        f"WHERE id::text = :org_id LIMIT 1"
                    ),
                    {"org_id": requested},
                )
                _found = exists_rs.first() is not None
            if _found:
                return requested
        except Exception as _lookup_err:
            logger.warning(
                f"[Node 9] org_id lookup failed ({_lookup_err}); falling back to first org"
            )

    try:
        _fallback_id = None
        async with session.begin_nested():
            fallback_rs = await session.execute(
                text(
                    f"SELECT id::text FROM {schema_name}.organizations "
                    f"ORDER BY created_at ASC LIMIT 1"
                )
            )
            _fallback_id = fallback_rs.scalar_one_or_none()
    except Exception as _fb_err:
        raise Exception(
            "org fallback query failed — no organizations found in target DB"
        ) from _fb_err
    fallback = _fallback_id
    if fallback:
        logger.warning(
            "[Node 9] Requested organization_id missing; using existing organization_id="
            f"{fallback}"
        )
        return str(fallback)

    raise Exception(
        "No organizations found in target DB; cannot satisfy assets.organization_id FK"
    )
