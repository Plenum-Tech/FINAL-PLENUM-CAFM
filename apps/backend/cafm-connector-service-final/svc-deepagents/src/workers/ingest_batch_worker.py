"""Background processor for bulk ingest batches."""
from __future__ import annotations

import asyncio
from pathlib import Path

import structlog

from ..agents.single_door_flow import ingest_single_file, remove_files
from ..config import settings
from ..services import ingest_batch_service as batch_svc

log = structlog.get_logger(__name__)

_background_tasks: set[asyncio.Task] = set()
_cancelled_batches: set[str] = set()


def schedule_ingest_batch(batch_id: str) -> None:
    task = asyncio.create_task(_run_batch(batch_id), name=f"ingest-batch-{batch_id[:8]}")
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def mark_batch_cancelled(batch_id: str) -> None:
    _cancelled_batches.add(batch_id)


async def _run_batch(batch_id: str) -> None:
    batch = await batch_svc.get_ingest_batch(batch_id)
    if not batch:
        log.warning("ingest_batch.worker.missing", batch_id=batch_id)
        return

    session_id = batch["session_id"]
    org = batch["organization_id"]
    cmms = batch.get("cmms_name") or "Custom"
    items = batch.get("items") or []
    file_paths = [str(i.get("file_path") or "") for i in items]

    await batch_svc.set_batch_status(batch_id, "running")
    sem = asyncio.Semaphore(max(1, settings.ingest_batch_concurrency))

    async def _process_index(index: int, file_path: str) -> None:
        if batch_id in _cancelled_batches:
            return
        current = await batch_svc.get_ingest_batch(batch_id)
        if current and current.get("status") == "cancelled":
            return
        async with sem:
            if batch_id in _cancelled_batches:
                return
            await batch_svc.update_batch_item(batch_id, index, status="running")
            try:
                result = await ingest_single_file(
                    file_path=file_path,
                    organization_id=org,
                    cmms_name=cmms,
                )
                ok = result.get("status") == "done"
                if ok:
                    succeeded += 1
                await batch_svc.update_batch_item(
                    batch_id,
                    index,
                    status="done" if ok else "error",
                    kind=str(result.get("kind") or ""),
                    summary=str(result.get("summary") or ""),
                    error=result.get("error"),
                    increment=True,
                    succeeded=ok,
                )
            except Exception as exc:
                log.exception("ingest_batch.file.error", batch_id=batch_id, file=file_path)
                await batch_svc.update_batch_item(
                    batch_id,
                    index,
                    status="error",
                    summary="",
                    error=str(exc)[:300],
                    increment=True,
                    succeeded=False,
                )

    try:
        await asyncio.gather(
            *[_process_index(i, p) for i, p in enumerate(file_paths) if p]
        )
    except Exception as exc:
        await batch_svc.set_batch_status(batch_id, "failed", error_message=str(exc)[:500])
        log.exception("ingest_batch.worker.failed", batch_id=batch_id)
        return
    finally:
        _cancelled_batches.discard(batch_id)
        remove_files(file_paths)

    final = await batch_svc.get_ingest_batch(batch_id)
    if not final:
        return
    if final.get("status") == "cancelled":
        return

    from ..agents.session_workspace import record_batch_ingestion_complete

    record_batch_ingestion_complete(
        session_id,
        batch_id=batch_id,
        succeeded_count=int(final.get("completed_count") or 0),
    )
    log.info(
        "ingest_batch.worker.done",
        batch_id=batch_id,
        completed=final.get("completed_count"),
        failed=final.get("failed_count"),
    )
