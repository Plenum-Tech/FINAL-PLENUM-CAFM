"""Pre-Semantic Human Review Gate (between Node 2 and Node 3).

For every deterministic match produced by Node 2, EXCLUDING T1_alias
(alias matches are high-confidence and auto-approved without human review):

    T1_exact, T1_variation, T1_regex, T1_llm  →  shown to human for yes/no
    T1_alias                                   →  automatically approved, skipped

Per-column decision:
    "approve"  →  mapping is finalised; stays in tier1_mappings_by_table
    "semantic" →  mapping is rejected; source field is added back to
                  unresolved_by_table so Node 3 attempts a semantic match

After this gate Node 3 processes:
    • Fields that were already unresolved after Node 2
    • Fields rejected ("semantic") at this gate

Approved T1 fields never touch Node 3 and flow straight through to Node 5
via the existing conditional edge.

Expected interrupt resume payload (from external API caller):
{
  "work_orders": [
    {"source_field": "WO_ID",       "decision": "approve"},
    {"source_field": "FAULT_DESC",  "decision": "semantic"}
  ],
  "assets": [
    {"source_field": "EQUIP_NUM",   "decision": "approve"}
  ]
}

Omitted tables default to approve for all their reviewable mappings.
Omitted fields within a table also default to approve.
"""

from datetime import datetime

from langgraph.types import interrupt
from sqlalchemy import text

from cafm_shared.logging import get_logger
from ...db import get_async_session_factory
from ..state import FieldMapping, MigrationState

logger = get_logger(__name__)


async def _list_plenum_cafm_tables() -> list[str]:
    """All base tables in plenum_cafm — populates the target-table dropdown at this gate."""
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
        logger.warning(f"[Pre-Semantic Gate] Could not list plenum_cafm tables: {exc}")
        return []

# Tiers that require human sign-off at this gate.
# T1_alias is intentionally absent — alias matches auto-pass.
_TIERS_REQUIRING_REVIEW: frozenset[str] = frozenset(
    {"T1_exact", "T1_table_exact", "T1_variation", "T1_regex", "T1_llm"}
)


async def pre_semantic_review_node(state: MigrationState) -> MigrationState:
    """
    Pre-Semantic Human Review Gate — interrupts for per-column approve/semantic.

    Logic:
    1. Partition tier1_mappings_by_table into:
       - reviewable (T1_exact / T1_variation / T1_regex / T1_llm)
       - auto_pass  (T1_alias and any unknown tier)
    2. If nothing is reviewable, skip the gate entirely (no interrupt).
    3. Otherwise interrupt → wait for external decisions.
    4. Process decisions:
       - approve  → mapping stays in tier1_mappings_by_table
       - semantic → mapping removed; source_field added to unresolved_by_table
    5. Store updated tier1_mappings_by_table and unresolved_by_table in state.
    """

    migration_id = state.get("migration_id")
    tier1_mappings_by_table: dict = state.get("tier1_mappings_by_table", {})
    unresolved_by_table: dict = dict(state.get("unresolved_by_table", {}))  # shallow copy

    # ── Partition mappings ─────────────────────────────────────────────
    reviewable_by_table: dict[str, list[FieldMapping]] = {}
    auto_pass_by_table: dict[str, list[FieldMapping]] = {}

    for table_name, mappings in tier1_mappings_by_table.items():
        reviewable = [m for m in mappings if m.get("tier") in _TIERS_REQUIRING_REVIEW]
        auto_pass = [m for m in mappings if m.get("tier") not in _TIERS_REQUIRING_REVIEW]
        reviewable_by_table[table_name] = reviewable
        auto_pass_by_table[table_name] = auto_pass

    total_reviewable = sum(len(v) for v in reviewable_by_table.values())

    # ── Fast-path: nothing to review ──────────────────────────────────
    if total_reviewable == 0:
        logger.info(
            "[Pre-Semantic Gate] No reviewable T1 mappings (all alias or none). "
            "Gate skipped — all deterministic mappings auto-approved."
        )
        state["tier1_approved_by_table"] = tier1_mappings_by_table
        state["pre_semantic_review_payload"] = None
        state["event_log"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "event": "gate_skipped",
            "gate": "pre_semantic",
            "detail": "No reviewable T1 mappings; gate bypassed",
        })
        return state

    # ── Build interrupt payload ────────────────────────────────────────
    review_items_by_table: dict[str, list[dict]] = {}

    for table_name, mappings in reviewable_by_table.items():
        if not mappings:
            continue
        items = []
        for m in mappings:
            items.append({
                "source_table": table_name,
                "source_field": m.get("source_field"),
                "target_field": m.get("target_field"),
                "confidence": m.get("confidence"),
                "tier": m.get("tier"),
                "rationale": m.get("rationale"),
                "sample_values": m.get("sample_values", []),
            })
        review_items_by_table[table_name] = items

    # Full plenum_cafm table list so the target-table dropdown can route a source
    # table to ANY existing CAFM table (fall back to the reviewed tables).
    db_tables = await _list_plenum_cafm_tables()
    existing_canonical_tables = db_tables or sorted(review_items_by_table.keys())

    # Columns for each candidate target table. Lets the frontend re-match a source
    # table's columns the instant the user picks a different target table, without
    # another round-trip. Best-effort — empty map just disables the live re-match.
    canonical_columns_by_table: dict[str, list[str]] = {}
    try:
        from ...db import get_plenum_cafm_columns_by_table
        _cols_by_tbl = await get_plenum_cafm_columns_by_table()
        for _t in existing_canonical_tables:
            _cols = _cols_by_tbl.get(_t.lower())
            if _cols:
                canonical_columns_by_table[_t] = sorted(_cols)
    except Exception as exc:  # pragma: no cover - best-effort
        logger.warning(f"[Pre-Semantic Gate] Could not load canonical columns: {exc}")

    review_payload = {
        "migration_id": migration_id,
        "gate": "pre_semantic",
        "total_reviewable": total_reviewable,
        "review_items_by_table": review_items_by_table,
        "existing_canonical_tables": existing_canonical_tables,
        # table → its columns, for live column re-matching when the target changes.
        "canonical_columns_by_table": canonical_columns_by_table,
        # Mapper's best-guess CAFM target table per source table (assets_test2 → assets),
        # so the dropdown can default to the matching table instead of the source name.
        "suggested_target_by_table": dict(state.get("table_routing") or {}),
        "instructions": (
            "Review each deterministically matched field. "
            "Decision options per field:\n"
            "  'approve'  — accept the mapping as final (skips semantic matching)\n"
            "  'semantic' — reject and run through semantic matching instead\n"
            "Alias-matched fields have already been auto-approved and are not shown."
        ),
    }

    logger.info(
        f"[Pre-Semantic Gate] Interrupting for review: {total_reviewable} fields across "
        f"{len(review_items_by_table)} tables. migration_id={migration_id}"
    )
    state["pre_semantic_review_payload"] = review_payload

    # ── Write payload to DB so frontend can read it ────────────────────
    if migration_id:
        from .db_writer import write_gate_payload
        await write_gate_payload(migration_id, "pre_semantic", review_payload)

    # ── Interrupt — resume with decisions dict ──────────────────────────
    # decisions_by_table: dict[table_name, list[{source_field, decision}]]
    _gate_started_at = datetime.utcnow()
    resumed = interrupt(review_payload)
    # Structured resume (WP-5): {"decisions": {...}, "table_overrides": {...}}.
    # Legacy flat resume: {table_name: [{source_field, decision}]}.
    if isinstance(resumed, dict) and "decisions" in resumed:
        decisions_by_table: dict = resumed.get("decisions") or {}
        table_overrides: dict = resumed.get("table_overrides") or {}
    else:
        decisions_by_table = resumed if isinstance(resumed, dict) else {}
        table_overrides = {}

    # ── Clear gate payload now that we have decisions ──────────────────
    if migration_id:
        from .db_writer import clear_gate_payload
        await clear_gate_payload(migration_id)

    logger.info(
        f"[Pre-Semantic Gate] Resumed with decisions for {len(decisions_by_table)} tables"
    )

    # ── Identify source tables that the user is creating as NEW tables. ─────
    # Their columns are deterministically approved here and MUST skip the
    # semantic mapper — otherwise the same column ends up in both Approved
    # and Semantic queues, which is the bug the New Table rule prevents.
    source_is_new_lookup: dict[str, bool] = {}
    if isinstance(table_overrides, dict):
        for _src, _ovr in table_overrides.items():
            if isinstance(_ovr, dict) and bool(_ovr.get("is_new_table", False)):
                source_is_new_lookup[_src] = True

    def _snake_case(field: str) -> str:
        """Conservative fallback when the frontend omits target_field."""
        out = []
        prev_lower = False
        for ch in (field or "").strip():
            if ch.isalnum():
                if ch.isupper() and prev_lower:
                    out.append("_")
                out.append(ch.lower())
                prev_lower = ch.islower() or ch.isdigit()
            else:
                if out and out[-1] != "_":
                    out.append("_")
                prev_lower = False
        return "".join(out).strip("_") or "column"

    # ── Process decisions ──────────────────────────────────────────────
    updated_tier1_by_table: dict[str, list[FieldMapping]] = {}
    total_approved = 0
    total_sent_to_semantic = 0
    node_log_lines: list[str] = []  # raw per-field decisions surfaced in the Process log

    # Iterate over the UNION of:
    #   1. tables that produced T1 candidates (pre-existing behaviour), and
    #   2. tables that have decisions submitted at this gate, and
    #   3. tables flagged as new in table_overrides.
    # Without (2) and (3), a brand-new source table (zero T1 matches) would
    # have its approve decisions silently dropped — its unresolved fields
    # would then flow into the semantic mapper and double-count as both
    # Approved (UI) and Semantic (backend), which is exactly the bug fixed
    # by the "+ New Table" rule.
    ordered_tables: list[str] = list(tier1_mappings_by_table.keys())
    for t in decisions_by_table.keys():
        if t not in ordered_tables:
            ordered_tables.append(t)
    for t in source_is_new_lookup.keys():
        if t not in ordered_tables:
            ordered_tables.append(t)

    for table_name in ordered_tables:
        auto_pass_mappings = auto_pass_by_table.get(table_name, [])
        reviewable_mappings = reviewable_by_table.get(table_name, [])
        table_decisions = decisions_by_table.get(table_name, [])
        is_new_source = source_is_new_lookup.get(table_name, False)

        # Build decision lookup: source_field → "approve" | "semantic",
        # plus optional per-field target-column rename (WP-5 Node 2).
        decision_map: dict[str, str] = {}
        rename_map: dict[str, str] = {}
        data_type_map: dict[str, str] = {}  # source_field → user-chosen SQL type (new tables)
        for d in table_decisions:
            sf = d.get("source_field")
            if not sf:
                continue
            # New tables are approval-by-definition — defensively coerce any
            # accidental "semantic" decision back to "approve" so a stale
            # client payload can't leak fields into the semantic queue.
            raw_decision = d.get("decision", "approve")
            decision_map[sf] = "approve" if is_new_source else raw_decision
            tf = (d.get("target_field") or "").strip()
            if tf:
                rename_map[sf] = tf
            dt = (d.get("data_type") or "").strip()
            if dt:
                data_type_map[sf] = dt

        approved_mappings: list[FieldMapping] = []

        for m in reviewable_mappings:
            source_field = m.get("source_field")
            # New tables short-circuit: every field is auto-approved regardless
            # of what the decision_map says.
            decision = "approve" if is_new_source else decision_map.get(source_field, "approve")

            if decision == "approve":
                if is_new_source:
                    # When the user picks "+ New Table" for a source that had
                    # pre-existing T1 matches, those matches were scored
                    # against a DIFFERENT canonical table — preserving their
                    # target_field would create the new table with columns
                    # that don't belong here. Always overwrite with the
                    # snake_case of the source (or the user's explicit
                    # rename) and stamp T1_new_table provenance.
                    new_target = rename_map.get(source_field) or _snake_case(source_field or "")
                    m = {
                        **m,
                        "target_field": new_target,
                        "tier": "T1_new_table",
                        "confidence": 1.0,
                        "rationale": "Auto-approved column on a user-created new table",
                        "langsmith_run_id": None,
                    }
                elif source_field in rename_map:
                    # Apply a user column rename (changes the canonical column name that
                    # write_node will CREATE/ALTER for this field).
                    m = {**m, "target_field": rename_map[source_field]}
                approved_mappings.append(m)
                total_approved += 1
                _line = (
                    f"✓ APPROVED  {table_name}.{source_field} "
                    f"→ {m.get('target_field')} ({m.get('confidence', 0):.2f})"
                )
                node_log_lines.append(_line)
                logger.info(f"[Pre-Semantic Gate]   {_line}")
            else:  # "semantic"
                # Push back into unresolved so Node 3 picks it up
                if table_name not in unresolved_by_table:
                    unresolved_by_table[table_name] = []
                unresolved_by_table[table_name] = list(unresolved_by_table[table_name])
                unresolved_by_table[table_name].append(source_field)
                total_sent_to_semantic += 1
                _line = f"→ SEMANTIC  {table_name}.{source_field} (was {m.get('tier')})"
                node_log_lines.append(_line)
                logger.info(f"[Pre-Semantic Gate]   {_line}")

        # Manually-assigned unresolved ("left-out") fields: the gate lets the user
        # map a previously-unresolved source field to a leftover target column. These
        # arrive as approve decisions for fields NOT in reviewable_mappings — promote
        # them to T1 mappings and drop them from the unresolved list so they skip Node 3.
        reviewable_fields = {m.get("source_field") for m in reviewable_mappings}
        for sf, decision in decision_map.items():
            if sf in reviewable_fields or decision != "approve":
                continue
            # For new tables, fall back to a snake-case auto-target so an
            # accidentally-empty target_field on the wire still produces a
            # mapping rather than dropping the column.
            tf = rename_map.get(sf) or (_snake_case(sf) if is_new_source else None)
            if not tf:
                continue
            approved_mappings.append(FieldMapping(
                source_field=sf,
                target_field=tf,
                confidence=1.0,
                tier="T1_new_table" if is_new_source else "T1_manual",
                rationale=(
                    "Auto-approved column on a user-created new table"
                    if is_new_source
                    else "User-assigned target column at the pre-semantic gate"
                ),
                langsmith_run_id=None,
            ))
            if table_name in unresolved_by_table:
                unresolved_by_table[table_name] = [
                    f for f in unresolved_by_table[table_name] if f != sf
                ]
            total_approved += 1
            _line = (
                f"✓ NEW_TABLE {table_name}.{sf} → {tf}"
                if is_new_source
                else f"✓ ASSIGNED  {table_name}.{sf} → {tf} (user)"
            )
            node_log_lines.append(_line)
            logger.info(f"[Pre-Semantic Gate]   {_line}")

        # For new-table source tables, sweep up ANY unresolved field that
        # didn't get an explicit decision (defensive — the frontend should
        # always send all of them, but if anything slips through it must
        # still be auto-approved, never sent to semantic).
        if is_new_source and table_name in unresolved_by_table:
            already_approved = {a.get("source_field") for a in approved_mappings}
            remaining = [f for f in unresolved_by_table[table_name] if f not in already_approved]
            for sf in remaining:
                tf = rename_map.get(sf) or _snake_case(sf)
                approved_mappings.append(FieldMapping(
                    source_field=sf,
                    target_field=tf,
                    confidence=1.0,
                    tier="T1_new_table",
                    rationale="Auto-approved column on a user-created new table",
                    langsmith_run_id=None,
                ))
                total_approved += 1
                _line = f"✓ NEW_TABLE {table_name}.{sf} → {tf} (auto)"
                node_log_lines.append(_line)
                logger.info(f"[Pre-Semantic Gate]   {_line}")
            # Drop the entire entry so the semantic mapper never iterates it.
            unresolved_by_table.pop(table_name, None)

        # New table: stamp each approved column with the user-chosen SQL type so
        # write_node's CREATE TABLE uses it instead of a sample-inferred type.
        if is_new_source and data_type_map:
            for am in approved_mappings:
                _dt = data_type_map.get(am.get("source_field"))
                if _dt:
                    am["data_type"] = _dt

        # Final tier1 for this table = alias auto-pass + human-approved
        # (auto-pass should be empty for fully-new source tables, but the
        # merge is safe either way.)
        updated_tier1_by_table[table_name] = auto_pass_mappings + approved_mappings

    # ── Apply table-level overrides — rename / create new table (WP-5 Node 2) ──
    # These reuse the exact state keys write_node consumes (table_routing,
    # new_tables, extra_fields_config) and are merged with any existing values so
    # they survive the later field-mapping gate and flow through to the DB write.
    if table_overrides:
        table_routing: dict = dict(state.get("table_routing") or {})
        new_tables_list: list = list(state.get("new_tables") or [])
        extra_fields_config: list = list(state.get("extra_fields_config") or [])

        for source_table, override in table_overrides.items():
            if not isinstance(override, dict):
                continue
            target_table = (override.get("target_table") or "").strip()
            if not target_table:
                continue
            is_new = bool(override.get("is_new_table", False))
            table_routing[source_table] = target_table

            if is_new:
                if target_table not in new_tables_list:
                    new_tables_list.append(target_table)
                # A trigger entry tells write_node to CREATE this table; its columns
                # are filled from the (possibly renamed) mapped fields of the source.
                already = any(
                    e.get("source_table") == source_table
                    and e.get("target_table") == target_table
                    and e.get("is_new_table")
                    for e in extra_fields_config
                )
                if not already:
                    extra_fields_config.append({
                        "source_field": "",
                        "source_table": source_table,
                        "storage_strategy": "custom",
                        "target_table": target_table,
                        "custom_column_name": "",
                        "data_type": "",
                        "is_new_table": True,
                        "new_table_pk": "id",
                        "nullable": True,
                        "user_approved": True,
                    })
            _line = f"table override: '{source_table}' → '{target_table}' (new_table={is_new})"
            node_log_lines.append(_line)
            logger.info(f"[Pre-Semantic Gate]   {_line}")

        state["table_routing"] = table_routing
        state["new_tables"] = new_tables_list
        state["extra_fields_config"] = extra_fields_config

    # ── Update state ───────────────────────────────────────────────────
    state["tier1_mappings_by_table"] = updated_tier1_by_table
    state["tier1_approved_by_table"] = updated_tier1_by_table
    state["unresolved_by_table"] = unresolved_by_table

    # Recalculate tier1_mapped_count to reflect what actually survived
    state["tier1_mapped_count"] = sum(
        len(m) for m in updated_tier1_by_table.values()
    )

    logger.info(
        f"[Pre-Semantic Gate] ══ Summary ══ "
        f"approved={total_approved}, sent_to_semantic={total_sent_to_semantic}"
    )

    state["event_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "event": "gate_complete",
        "gate": "pre_semantic",
        "detail": (
            f"{total_approved} approved, {total_sent_to_semantic} sent to semantic matching"
        ),
    })

    migration_id = state.get("migration_id")
    if migration_id:
        from .schema_db_writer import migration_append_node_log_auto

        # Persist the slim subset of state that the frontend's semantic-snapshot
        # relabel needs (see buildNewColumnLookup in step-pause.tsx).
        #
        # Without this, a historical Node-3 snapshot that captured a field as
        # "unmappable" can never be relabeled to "new column" — buildNewColumnLookup
        # walks each node's output looking for new_tables / table_routing /
        # tier1_mappings_by_table / extra_fields_config, and finds nothing because
        # those slots only live on the LangGraph state, never on the node log.
        #
        # We write only the new-column / new-table mappings (T1_new_table,
        # T1_manual) to keep the row small, since that's all the relabel
        # consumes — the full tier1 set is already available via state.
        _slim_tier1_for_relabel: dict[str, list[dict]] = {}
        for _tbl, _maps in (state.get("tier1_mappings_by_table") or {}).items():
            _kept: list[dict] = []
            for _m in _maps:
                _tier = (_m.get("tier") or "") if isinstance(_m, dict) else ""
                if _tier in ("T1_new_table", "T1_manual"):
                    _kept.append({
                        "source_field": _m.get("source_field"),
                        "target_field": _m.get("target_field"),
                        "tier": _tier,
                    })
            if _kept:
                _slim_tier1_for_relabel[_tbl] = _kept

        _output_for_relabel: dict = {
            "approved": total_approved,
            "sent_to_semantic": total_sent_to_semantic,
            "updated_tier1_count": state.get("tier1_mapped_count", 0),
            "new_tables": list(state.get("new_tables") or []),
            "table_routing": dict(state.get("table_routing") or {}),
            "extra_fields_config": list(state.get("extra_fields_config") or []),
            "tier1_mappings_by_table": _slim_tier1_for_relabel,
        }

        await migration_append_node_log_auto(
            migration_id, 3, "Pre-Semantic Review", _gate_started_at, datetime.utcnow(),
            output=_output_for_relabel,
            logs=[
                "Gate: pre-semantic human review",
                f"{total_approved} approved · {total_sent_to_semantic} → semantic",
                *node_log_lines,
            ],
        )

    return state
