"""Shared DB write utilities for all schema mapping graph nodes.

Mirrors db_writer.py but targets SchemaMappingJob instead of MigrationJob.

Every node calls these helpers so the frontend can track live progress by
polling GET /api/schema-mapping/{id}/status.

Pattern per regular node:
    db_session = state.get("db_session")
    schema_mapping_id = state.get("schema_mapping_id")
    if db_session and schema_mapping_id:
        await schema_update_node_progress(db_session, schema_mapping_id, 2, "deterministic")

Pattern per gate node (before interrupt, then after resume):
    if db_session and schema_mapping_id:
        await schema_write_gate_payload(db_session, schema_mapping_id, "field_mapping", payload)
    decisions = interrupt(payload)
    if db_session and schema_mapping_id:
        await schema_clear_gate_payload(db_session, schema_mapping_id)
"""

import logging
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ...models.migration import SchemaMappingJob

from cafm_shared.logging import get_logger
logger = get_logger(__name__)


async def schema_update_node_progress(
    db_session: AsyncSession,
    schema_mapping_id: str,
    current_node: int,
    status: str = "running",
    **extra_fields: Any,
) -> None:
    """
    Write node completion to schema_mapping_jobs.

    Args:
        db_session:         Active AsyncSession (passed through state).
        schema_mapping_id:  SchemaMappingJob UUID string.
        current_node:       Node number (0–8).
        status:             Job status string (default "running").
        **extra_fields:     Any additional SchemaMappingJob columns to update
                            (e.g. tier1_mapped=42, progress_pct=50.0).
    """
    try:
        progress_pct = extra_fields.pop("progress_pct", ((current_node + 1) / 9.0) * 100.0)
        values: dict[str, Any] = {
            "current_node": current_node,
            "status": status,
            "progress_pct": progress_pct,
            **extra_fields,
        }
        await db_session.execute(
            update(SchemaMappingJob)
            .where(SchemaMappingJob.id == UUID(schema_mapping_id))
            .values(**values)
        )
        await db_session.commit()
        logger.debug(
            f"[schema_db_writer] node={current_node} status={status} "
            f"schema_mapping={schema_mapping_id}"
        )
    except Exception as e:
        logger.warning(f"[schema_db_writer] schema_update_node_progress failed (non-fatal): {e}")
        try:
            await db_session.rollback()
        except Exception:
            pass


async def schema_write_gate_payload(
    db_session: AsyncSession,
    schema_mapping_id: str,
    gate_type: str,
    payload: dict[str, Any],
) -> None:
    """
    Write HITL gate payload to DB and flip status to 'awaiting_review'.

    Called by gate nodes BEFORE interrupt() so the frontend can read the payload
    via GET /api/schema-mapping/{id}/status → pending_gate_payload and render
    the review UI.

    gate_type values:
        "field_mapping"  — Node 4 (schema human review gate)
        "hierarchy"      — Node 6 (verify hierarchy gate)
    """
    try:
        await db_session.execute(
            update(SchemaMappingJob)
            .where(SchemaMappingJob.id == UUID(schema_mapping_id))
            .values(
                status="awaiting_review",
                pending_gate_type=gate_type,
                pending_gate_payload=payload,
            )
        )
        await db_session.commit()
        logger.info(
            f"[schema_db_writer] Gate payload written: gate={gate_type} "
            f"schema_mapping={schema_mapping_id}"
        )
    except Exception as e:
        logger.warning(f"[schema_db_writer] schema_write_gate_payload failed (non-fatal): {e}")
        try:
            await db_session.rollback()
        except Exception:
            pass


async def schema_clear_gate_payload(
    db_session: AsyncSession,
    schema_mapping_id: str,
) -> None:
    """
    Clear gate payload and flip status back to 'running' after graph resumes.

    Called by gate nodes immediately after interrupt() returns with decisions.
    """
    try:
        await db_session.execute(
            update(SchemaMappingJob)
            .where(SchemaMappingJob.id == UUID(schema_mapping_id))
            .values(
                status="running",
                pending_gate_type=None,
                pending_gate_payload=None,
            )
        )
        await db_session.commit()
        logger.debug(
            f"[schema_db_writer] Gate payload cleared schema_mapping={schema_mapping_id}"
        )
    except Exception as e:
        logger.warning(f"[schema_db_writer] schema_clear_gate_payload failed (non-fatal): {e}")
        try:
            await db_session.rollback()
        except Exception:
            pass


async def schema_write_step_pause(
    db_session: AsyncSession,
    schema_mapping_id: str,
    node_num: int,
    step_key: str,
    payload: dict[str, Any],
) -> None:
    """
    Write step-pause state to schema_mapping_jobs.

    Called by regular (non-gate) nodes at the end of their execution, before
    returning from the node function. interrupt_after will then pause the graph
    after the node returns. The frontend polls status=="step_paused" and renders
    a node summary before the user clicks "Next Node →".

    Args:
        db_session:          Active AsyncSession (passed through state).
        schema_mapping_id:   SchemaMappingJob UUID string.
        node_num:            Node number (0–8).
        step_key:            Identifies which step paused (e.g. "step_0_canonical").
        payload:             Rich node-output data displayed in the UI.
    """
    try:
        progress_pct = ((node_num + 1) / 9.0) * 100.0
        await db_session.execute(
            update(SchemaMappingJob)
            .where(SchemaMappingJob.id == UUID(schema_mapping_id))
            .values(
                current_node=node_num,
                status="step_paused",
                progress_pct=progress_pct,
                pending_gate_type=step_key,
                pending_gate_payload=payload,
            )
        )
        await db_session.commit()
        logger.debug(
            f"[schema_db_writer] step_pause node={node_num} step={step_key} "
            f"schema_mapping={schema_mapping_id}"
        )
    except Exception as e:
        logger.warning(f"[schema_db_writer] schema_write_step_pause failed (non-fatal): {e}")
        try:
            await db_session.rollback()
        except Exception:
            pass


async def schema_write_gate_payload_auto(
    schema_mapping_id: str,
    gate_type: str,
    payload: dict[str, Any],
) -> None:
    """
    Write HITL gate payload using a self-managed DB session.

    Use this in gate nodes instead of schema_write_gate_payload() so that
    no AsyncSession is placed in graph state (which breaks MemorySaver checkpointing).
    """
    from ...db import get_async_session_factory
    sf = get_async_session_factory()
    async with sf() as db_session:
        await schema_write_gate_payload(db_session, schema_mapping_id, gate_type, payload)


async def schema_clear_gate_payload_auto(
    schema_mapping_id: str,
) -> None:
    """
    Clear gate payload using a self-managed DB session.

    Called by gate nodes immediately after interrupt() returns with decisions.
    """
    from ...db import get_async_session_factory
    sf = get_async_session_factory()
    async with sf() as db_session:
        await schema_clear_gate_payload(db_session, schema_mapping_id)


async def schema_write_step_pause_auto(
    schema_mapping_id: str,
    node_num: int,
    step_key: str,
    payload: dict[str, Any],
) -> None:
    """
    Write step-pause state using a self-managed DB session.

    Use this in LangGraph nodes instead of schema_write_step_pause() so that
    the AsyncSession is never placed in the graph state (which would fail msgpack
    serialization when MemorySaver checkpoints the state).
    """
    from ...db import get_async_session_factory
    sf = get_async_session_factory()
    async with sf() as db_session:
        await schema_write_step_pause(db_session, schema_mapping_id, node_num, step_key, payload)


async def schema_append_node_log_auto(
    schema_mapping_id: str,
    node_id: int,
    node_name: str,
    started_at: "datetime",
    completed_at: "datetime",
    output: dict,
    logs: list,
) -> None:
    """
    Append a node completion entry to SchemaMappingJob.node_logs using a self-managed session.

    Use this in LangGraph nodes instead of passing an AsyncSession through graph state
    (which would break MemorySaver checkpointing).
    """
    from datetime import datetime as _dt
    from uuid import UUID as _UUID
    from ...db import get_async_session_factory
    from ...services.job_progress import append_node_log

    sf = get_async_session_factory()
    async with sf() as db_session:
        await append_node_log(
            db_session,
            _UUID(schema_mapping_id),
            node_id,
            node_name,
            started_at,
            completed_at,
            output,
            logs,
        )


async def migration_append_node_log_auto(
    migration_id: str,
    node_id: int,
    node_name: str,
    started_at: "datetime",
    completed_at: "datetime",
    output: dict,
    logs: list,
) -> None:
    """
    Append a node completion entry to MigrationJob.node_logs using a self-managed session.

    Use this in LangGraph ingestor nodes instead of passing an AsyncSession through state.
    """
    from uuid import UUID as _UUID
    from ...db import get_async_session_factory
    from ...services.job_progress import append_migration_node_log

    sf = get_async_session_factory()
    async with sf() as db_session:
        await append_migration_node_log(
            db_session,
            _UUID(migration_id),
            node_id,
            node_name,
            started_at,
            completed_at,
            output,
            logs,
        )


async def schema_update_artifact_urls_auto(
    schema_mapping_id: str,
    output_json_url: str,
    output_csv_url: str,
    output_sql_url: str,
) -> None:
    """
    Persist artifact URLs to schema_mapping_jobs using a self-managed session.

    Called by schema_output_node after uploading artifacts to Azure Blob.
    """
    from ...db import get_async_session_factory
    sf = get_async_session_factory()
    async with sf() as db_session:
        try:
            await db_session.execute(
                update(SchemaMappingJob)
                .where(SchemaMappingJob.id == UUID(schema_mapping_id))
                .values(
                    output_json_url=output_json_url or None,
                    output_csv_url=output_csv_url or None,
                    output_sql_url=output_sql_url or None,
                )
            )
            await db_session.commit()
            logger.info(
                f"[schema_db_writer] Artifact URLs persisted for "
                f"schema_mapping={schema_mapping_id}"
            )
        except Exception as e:
            logger.warning(
                f"[schema_db_writer] schema_update_artifact_urls_auto failed (non-fatal): {e}"
            )
            try:
                await db_session.rollback()
            except Exception:
                pass


async def schema_write_error(
    db_session: AsyncSession,
    schema_mapping_id: str,
    error_message: str,
    error_node: Optional[int] = None,
    status: str = "error",
) -> None:
    """
    Write error state to schema_mapping_jobs.

    Args:
        status: "error" for general failures, "ddl_failed" for DDL rollbacks
                (DDL rollbacks expose the failing SQL to the frontend so the
                user can correct their field definitions and re-submit).
    """
    try:
        values: dict[str, Any] = {
            "status": status,
            "error_message": error_message[:2000],  # DDL errors can be verbose
            "error_timestamp": datetime.utcnow(),
        }
        if error_node is not None:
            values["current_node"] = error_node
        await db_session.execute(
            update(SchemaMappingJob)
            .where(SchemaMappingJob.id == UUID(schema_mapping_id))
            .values(**values)
        )
        await db_session.commit()
    except Exception as e:
        logger.warning(f"[schema_db_writer] schema_write_error failed (non-fatal): {e}")
        try:
            await db_session.rollback()
        except Exception:
            pass
