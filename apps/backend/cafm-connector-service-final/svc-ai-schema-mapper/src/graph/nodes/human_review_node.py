"""Node 4: Human review — GATE 1 HITL interrupt (MULTI-TABLE).

HITL Gate 1 logic (per table):
1. Collect tier2_flagged_for_review items grouped BY SOURCE TABLE
2. Customer approves/rejects flagged mappings per table
3. Process decisions: accepted → T2_human, rejected → unmappable
4. EL-M.4: Validate each decision has action + source_field + table_name
5. Resume graph execution
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from langgraph.errors import GraphInterrupt
from langgraph.types import interrupt
from sqlalchemy import text

from ...db import get_async_session_factory
from ...matchers.registry import registry_append
from ..state import ExtraFieldConfig, FieldMapping, MigrationState

from cafm_shared.logging import get_logger
logger = get_logger(__name__)


async def _list_plenum_cafm_tables() -> list[str]:
    """All base tables in plenum_cafm — so the target-table dropdown lists every CAFM table."""
    try:
        factory = get_async_session_factory()
        async with factory() as session:
            res = await session.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'plenum_cafm' AND table_type = 'BASE TABLE' "
                    "ORDER BY table_name"
                )
            )
            return [str(r[0]) for r in res.fetchall()]
    except Exception as exc:  # pragma: no cover - dropdown is best-effort
        logger.warning(f"[Node 4] Could not list plenum_cafm tables for dropdown: {exc}")
        return []


async def human_review_node(state: MigrationState) -> MigrationState:
    """
    Node 4: HITL Gate 1 — Customer approves/rejects flagged mappings per table.

    Entry conditions:
    - tier2_flagged_by_table has entries, OR
    - overall_confidence < 0.80 (EL-3.0 forcing review)

    Execution:
    1. Prepare review payload with flagged fields grouped by source table
    2. Call interrupt() to pause graph execution
    3. Wait for external resume with customer decisions (structured per table)
    4. Process decisions: accept/reject/override
    5. Update tier2_human_decisions_by_table
    6. Continue to Node 5
    """

    migration_id = state.get("migration_id")
    tier2_flagged_by_table = state.get("tier2_flagged_by_table", {})
    tier2_unmappable_by_table = state.get("tier2_unmappable_by_table", {})
    overall_confidence = state.get("overall_confidence", 1.0)

    # Count total flagged items across all tables
    total_flagged = sum(len(items) for items in tier2_flagged_by_table.values())
    total_unmappable = sum(len(items) for items in tier2_unmappable_by_table.values())

    logger.info(f"[Node 4] GATE 1 HITL: migration_id={migration_id}")
    logger.info(
        f"[Node 4] Total flagged: {total_flagged}, unmappable: {total_unmappable}, "
        f"confidence: {overall_confidence:.2f}"
    )

    # Check entry conditions
    if total_flagged == 0 and total_unmappable == 0 and overall_confidence >= 0.80:
        logger.info("[Node 4] No flagged/unmappable fields and confidence ≥ 0.80; skipping Gate 1")
        state["tier2_human_decisions_by_table"] = {}
        state["tier2_human_count"] = 0
        state["extra_fields_config"] = []
        state["current_step"] = 4
        return state

    try:
        # ── Prepare review payload (GROUPED BY TABLE) ──────────────────────────────
        review_items_by_table = {}
        confidence_alert = None

        if overall_confidence < 0.80:
            logger.warning(
                f"[Node 4] EL-3.0 triggered: overall_confidence={overall_confidence:.2f} < 0.80"
            )
            confidence_alert = {
                "type": "confidence_alert",
                "message": f"Overall mapping confidence is {overall_confidence:.1%}, below 0.80 threshold. Please review all flagged mappings.",
                "severity": "warning",
            }

        # Group flagged items by table for presentation
        for table_name in sorted(tier2_flagged_by_table.keys()):
            flagged_items = tier2_flagged_by_table[table_name]
            if not flagged_items:
                continue

            logger.info(f"[Node 4] ► Table {table_name}: {len(flagged_items)} flagged items")

            table_review_items = review_items_by_table.setdefault(table_name, [])
            for mapping in flagged_items:
                table_review_items.append({
                    "source_table": table_name,
                    "source_field": mapping.get("source_field"),
                    "item_type": "flagged",  # needs approve/reject/override
                    "suggested_target": mapping.get("target_field"),
                    "confidence": mapping.get("confidence"),
                    "rationale": mapping.get("rationale"),
                    "sample_values": mapping.get("sample_values", []),
                    "suggestions": mapping.get("suggestions", []),  # Top-3 alternatives
                    "langsmith_run_id": mapping.get("langsmith_run_id"),
                    "notes": "",  # Filled by customer
                })

        # Include unmapped fields — customer decides storage strategy + DDL intent
        unmappable_items_by_table = {}
        for table_name in sorted(tier2_unmappable_by_table.keys()):
            unmappable_fields = tier2_unmappable_by_table[table_name]
            if not unmappable_fields:
                continue

            logger.info(f"[Node 4] ► Table {table_name}: {len(unmappable_fields)} unmappable fields")

            table_unmappable = []
            for field_info in unmappable_fields:
                # field_info can be a string or a dict
                field_name = field_info if isinstance(field_info, str) else field_info.get("field_name") or field_info.get("source_field", "")
                table_unmappable.append({
                    "source_table": table_name,
                    "source_field": field_name,
                    "item_type": "unmapped",  # needs storage strategy
                    "available_actions": ["custom", "raw_metadata", "skip"],
                    "action_details": {
                        "custom": {
                            "description": "Create a new column in a plenum_cafm table",
                            "required_fields": ["target_table", "custom_column_name", "data_type"],
                            "optional_fields": ["is_new_table", "new_table_pk", "nullable"],
                        },
                        "raw_metadata": {
                            "description": "Store in existing raw_metadata JSONB column (no DDL needed)",
                        },
                        "skip": {
                            "description": "Discard this field — will not be migrated",
                        },
                    },
                })
            unmappable_items_by_table[table_name] = table_unmappable

        # Canonical table list — for the frontend dropdown when choosing target_table.
        # Use the FULL plenum_cafm table list so a source table can be routed to ANY
        # existing CAFM table (fall back to mapped tables if the DB query fails).
        db_tables = await _list_plenum_cafm_tables()
        existing_canonical_tables = db_tables or sorted(state.get("tier1_mappings_by_table", {}).keys())

        # Prepare final payload
        review_payload = {
            "migration_id": migration_id,
            "total_flagged": total_flagged,
            "total_unmappable": total_unmappable,
            "overall_confidence": overall_confidence,
            "confidence_alert": confidence_alert,
            "review_items_by_table": review_items_by_table,
            "unmappable_items_by_table": unmappable_items_by_table,
            "existing_canonical_tables": existing_canonical_tables,
            "instructions": (
                "Review flagged mappings per table. For each field: "
                "1) Accept suggestion, 2) Reject (unmappable), 3) Override with alternative. "
                "For unmapped fields: choose custom (DDL), raw_metadata, or skip."
            ),
        }

        logger.info(
            f"[Node 4] Interrupting for customer review: "
            f"{len(review_items_by_table)} flagged tables, "
            f"{len(unmappable_items_by_table)} unmapped tables"
        )
        state["human_review_payload"] = review_payload

        # ── Write gate payload to DB so frontend can render the review UI ──
        if migration_id:
            from .db_writer import write_gate_payload
            await write_gate_payload(migration_id, "field_mapping", review_payload)

        # ── Interrupt graph execution ──────────────────────────────
        # External system resumes with decisions structured as:
        # {
        #   "flagged": {
        #     "work_orders": [
        #       {"action": "accept", "source_field": "...", "target_field": "..."},
        #       {"action": "reject", "source_field": "..."}
        #     ],
        #     "assets": [...]
        #   },
        #   "unmapped": {
        #     "assets": [
        #       {"action": "custom", "source_field": "vendor_ref",
        #        "target_table": "assets", "custom_column_name": "vendor_ref",
        #        "data_type": "VARCHAR(100)", "nullable": true},
        #       {"action": "raw_metadata", "source_field": "legacy_id"},
        #       {"action": "skip", "source_field": "internal_notes"}
        #     ]
        #   }
        # }
        _gate_started_at = datetime.utcnow()
        all_decisions = interrupt(review_payload)

        # ── Clear gate payload now that we have decisions ──────────────────
        if migration_id:
            from .db_writer import clear_gate_payload
            await clear_gate_payload(migration_id)

        # decisions may be a flat dict (legacy: table → [decisions]) or the new
        # structured {"flagged": {...}, "unmapped": {...}} format
        if "flagged" in all_decisions or "unmapped" in all_decisions:
            decisions_by_table = all_decisions.get("flagged", {})
            unmapped_decisions_by_table = all_decisions.get("unmapped", {})
        else:
            # Legacy flat format — treat all as flagged decisions
            decisions_by_table = all_decisions
            unmapped_decisions_by_table = {}

        # ── Process customer decisions ──────────────────────────────
        logger.info(
            f"[Node 4] Resumed with flagged decisions for {len(decisions_by_table)} tables, "
            f"unmapped decisions for {len(unmapped_decisions_by_table)} tables"
        )

        tier2_human_decisions_by_table = {}
        total_accepted = 0
        # Start from any DDL config already produced by the pre-semantic gate (WP-5)
        # so Node-2 table/column edits are preserved through to the DB write.
        extra_fields_config: list[ExtraFieldConfig] = list(state.get("extra_fields_config") or [])

        # ── Process unmapped field DDL decisions ───────────────────────────
        for table_name, unmapped_decisions in unmapped_decisions_by_table.items():
            for decision in unmapped_decisions:
                action = decision.get("action")
                source_field = decision.get("source_field")

                if not action or not source_field:
                    logger.warning(f"[Node 4] Invalid unmapped decision (missing action/source_field): {decision}")
                    continue

                if action == "custom":
                    target_table = decision.get("target_table")
                    custom_column_name = decision.get("custom_column_name")
                    data_type = decision.get("data_type")

                    if not target_table or not custom_column_name or not data_type:
                        logger.error(
                            f"[Node 4] Custom DDL decision for {source_field} missing "
                            f"required fields (target_table, custom_column_name, data_type)"
                        )
                        state["error_message"] = (
                            f"Invalid custom DDL decision for '{source_field}': "
                            f"target_table, custom_column_name, and data_type are required"
                        )
                        state["error_node"] = 4
                        state["el_m4_passed"] = False
                        return state

                    extra_fields_config.append(ExtraFieldConfig(
                        source_field=source_field,
                        source_table=table_name,
                        storage_strategy="custom",
                        target_table=target_table,
                        custom_column_name=custom_column_name,
                        data_type=data_type,
                        is_new_table=decision.get("is_new_table", False),
                        new_table_pk=decision.get("new_table_pk", "id"),
                        nullable=decision.get("nullable", True),
                        user_approved=True,
                    ))
                    logger.info(
                        f"[Node 4] Custom DDL: {table_name}.{source_field} → "
                        f"plenum_cafm.{target_table}.{custom_column_name} ({data_type})"
                    )

                elif action == "raw_metadata":
                    extra_fields_config.append(ExtraFieldConfig(
                        source_field=source_field,
                        source_table=table_name,
                        storage_strategy="raw_metadata",
                        user_approved=True,
                    ))
                    logger.info(f"[Node 4] Raw metadata: {table_name}.{source_field}")

                elif action == "skip":
                    extra_fields_config.append(ExtraFieldConfig(
                        source_field=source_field,
                        source_table=table_name,
                        storage_strategy="skip",
                        user_approved=True,
                    ))
                    logger.info(f"[Node 4] Skip: {table_name}.{source_field}")

                else:
                    logger.warning(f"[Node 4] Unknown unmapped action '{action}' for {source_field}")

        logger.info(
            f"[Node 4] DDL intent captured: "
            f"{sum(1 for e in extra_fields_config if e.get('storage_strategy') == 'custom')} custom, "
            f"{sum(1 for e in extra_fields_config if e.get('storage_strategy') == 'raw_metadata')} raw_metadata, "
            f"{sum(1 for e in extra_fields_config if e.get('storage_strategy') == 'skip')} skip"
        )

        # EL-M.4 validation (flagged field decisions)
        for table_name, decisions in decisions_by_table.items():
            if table_name not in tier2_flagged_by_table:
                logger.warning(f"[Node 4] EL-M.4 FAILED: Unexpected table in decisions: {table_name}")
                state["error_message"] = f"Unexpected table in decisions: {table_name}"
                state["error_node"] = 4
                state["el_m4_passed"] = False
                return state

            human_decisions = []
            accepted_count = 0

            for decision in decisions:
                # EL-M.4: Validate decision structure
                action = decision.get("action")
                source_field = decision.get("source_field")

                if not action or not source_field:
                    logger.error(f"[Node 4] EL-M.4 FAILED: Invalid decision structure: {decision}")
                    state["error_message"] = "Invalid decision: missing action or source_field"
                    state["error_node"] = 4
                    state["el_m4_passed"] = False
                    return state

                if action not in ["accept", "reject", "override"]:
                    logger.error(f"[Node 4] EL-M.4 FAILED: Invalid action '{action}'")
                    state["error_message"] = f"Invalid action: {action}"
                    state["error_node"] = 4
                    state["el_m4_passed"] = False
                    return state

                # Find original mapping
                original_mapping = next(
                    (m for m in tier2_flagged_by_table[table_name] if m.get("source_field") == source_field),
                    None,
                )

                if action == "accept":
                    # Accept suggested target
                    target = decision.get("target_field") or (
                        original_mapping.get("target_field") if original_mapping else None
                    )
                    if not target:
                        logger.error(f"[Node 4] No target field for acceptance: {source_field}")
                        state["error_message"] = f"No target for accepted field: {source_field}"
                        state["el_m4_passed"] = False
                        return state

                    confidence = original_mapping.get("confidence", 0.70) if original_mapping else 0.70
                    mapping = FieldMapping(
                        source_field=source_field, target_field=target,
                        confidence=confidence,
                        tier="T2_human", rationale="Human approved flagged mapping",
                        reviewer_id=decision.get("reviewer_id"),
                        review_timestamp=datetime.utcnow(),
                        langsmith_run_id=(original_mapping.get("langsmith_run_id") if original_mapping else None),
                    )
                    human_decisions.append(mapping)
                    accepted_count += 1

                    logger.info(f"[Node 4]   ✓ ACCEPTED: {table_name}.{source_field} → {target}")

                    # Promote to registry — future runs hit Strategy R instead of LLM
                    try:
                        await registry_append(
                            alias=source_field,
                            canonical=target,
                            source_cmms=state.get("cmms_name", "Unknown"),
                            confidence=confidence,
                            approved_by="human",
                            migration_id=str(migration_id) if migration_id else None,
                        )
                    except Exception as _reg_err:
                        logger.debug(f"[Node 4]   Registry append failed (non-fatal): {_reg_err}")

                elif action == "reject":
                    logger.info(f"[Node 4]   ✗ REJECTED: {table_name}.{source_field}")

                elif action == "override":
                    # Customer provided override
                    override_target = decision.get("target_field")
                    if not override_target:
                        logger.error(f"[Node 4] EL-M.4 FAILED: Override without target: {source_field}")
                        state["el_m4_passed"] = False
                        return state

                    override_rationale = f"User manual override: {decision.get('notes', '')}"
                    mapping = FieldMapping(
                        source_field=source_field, target_field=override_target,
                        confidence=0.50,  # Lower confidence for manual override
                        tier="T2_human", rationale=override_rationale,
                        reviewer_id=decision.get("reviewer_id"),
                        review_timestamp=datetime.utcnow(),
                        langsmith_run_id=(original_mapping.get("langsmith_run_id") if original_mapping else None),
                    )
                    human_decisions.append(mapping)
                    accepted_count += 1

                    logger.info(f"[Node 4]   ⚙ OVERRIDE: {table_name}.{source_field} → {override_target}")

                    # Promote override to registry with slightly lower confidence
                    try:
                        await registry_append(
                            alias=source_field,
                            canonical=override_target,
                            source_cmms=state.get("cmms_name", "Unknown"),
                            confidence=0.90,  # Human overrides are authoritative
                            approved_by="human",
                            migration_id=str(migration_id) if migration_id else None,
                        )
                    except Exception as _reg_err:
                        logger.debug(f"[Node 4]   Registry append failed (non-fatal): {_reg_err}")

            tier2_human_decisions_by_table[table_name] = human_decisions
            total_accepted += accepted_count
            logger.info(f"[Node 4] ✓ Table {table_name}: {accepted_count} decisions processed")

        state["el_m4_passed"] = True
        logger.info(f"[Node 4] EL-M.4 PASSED: {total_accepted} decisions across all tables")

        # ── Update table_routing for is_new_table=True DDL decisions ──────
        # When a user marks a source table as needing a new target table,
        # override the routing so IntermediateSchema and DDL use the correct target.
        table_routing: dict[str, str] = dict(state.get("table_routing") or {})
        new_tables_list: list[str] = list(state.get("new_tables") or [])

        for entry in extra_fields_config:
            if entry.get("storage_strategy") == "custom" and entry.get("is_new_table", False):
                source_table = entry.get("source_table", "")
                target_table = entry.get("target_table", "")
                if source_table and target_table:
                    table_routing[source_table] = target_table
                    if target_table not in new_tables_list:
                        new_tables_list.append(target_table)
                    logger.info(
                        f"[Node 4]   table_routing updated: '{source_table}' → '{target_table}' (new table)"
                    )

        state["table_routing"] = table_routing
        state["new_tables"] = new_tables_list

        # ── Update state ───────────────────────────────────────────
        state["tier2_human_decisions_by_table"] = tier2_human_decisions_by_table
        state["tier2_human_count"] = total_accepted
        state["extra_fields_config"] = extra_fields_config

        # Recalculate overall confidence including human decisions
        tier1_confs = []
        for mappings in state.get("tier1_mappings_by_table", {}).values():
            tier1_confs.extend([m.get("confidence", 0) for m in mappings])

        tier2_auto_confs = []
        for mappings in state.get("tier2_auto_by_table", {}).values():
            tier2_auto_confs.extend([m.get("confidence", 0) for m in mappings])

        human_confs = []
        for mappings in tier2_human_decisions_by_table.values():
            human_confs.extend([m.get("confidence", 0) for m in mappings])

        all_confs = tier1_confs + tier2_auto_confs + human_confs
        new_overall = sum(all_confs) / len(all_confs) if all_confs else 0.0
        state["overall_confidence"] = new_overall

        logger.info(f"[Node 4] Overall confidence updated to {new_overall:.2f}")

        state["current_step"] = 4
        state["event_log"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "event": "node_complete",
            "node": 4,
            "detail": f"{total_accepted} decisions processed (by table)"
        })

        if migration_id:
            from .db_writer import update_node_progress
            await update_node_progress(
                migration_id, "4_field_mapping_review",
                t2_human_count=total_accepted,
            )

        if migration_id:
            from .schema_db_writer import migration_append_node_log_auto
            await migration_append_node_log_auto(
                migration_id, 5, "Human Review (Gate 1)", _gate_started_at, datetime.utcnow(),
                output={"decisions_processed": total_accepted,
                        "tier2_human_count": total_accepted,
                        "extra_fields_config_count": len(extra_fields_config),
                        "overall_confidence": round(state.get("overall_confidence", 0.0), 3)},
                logs=[f"Gate 1: field mapping human review",
                      f"{total_accepted} decisions processed across all tables",
                      f"{len(extra_fields_config)} unmapped field DDL decisions captured",
                      f"Overall confidence updated to {state.get('overall_confidence', 0.0):.2f}",
                      f"EL-M.4: {'PASSED' if state.get('el_m4_passed') else 'FAILED'}"],
            )

        return state

    except GraphInterrupt:
        # GraphInterrupt is the LangGraph HITL mechanism — it MUST propagate to the
        # graph runner so the execution is checkpointed and paused.  Never catch it.
        raise

    except Exception as e:
        logger.exception(f"[Node 4] Unhandled exception: {e}")
        state["error_message"] = str(e)
        state["error_node"] = 4
        state["error_timestamp"] = datetime.utcnow()
        state["status"] = "failed"
        return state
