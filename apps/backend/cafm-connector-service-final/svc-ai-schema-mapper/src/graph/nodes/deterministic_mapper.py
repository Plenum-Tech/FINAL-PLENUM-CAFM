"""Node 2: Deterministic mapper — 4-tier field mapping strategy (MULTI-TABLE).

Supports BOTH:
1. Hardcoded canonical fields (legacy/fallback)
2. Customer-provided JSON mapper (from json_mapper in state)

Strategies (in order, per table, per column):
1. Exact field name match
1B. Common field name variations
2. CMMS alias lookup
3. Regex pattern matching
4. Haiku constrained call (fallback)

MULTI-TABLE: Each source table's columns are mapped together, grouped by table.

EL-M.2: No duplicate target fields within each table, all confidences in 0–1 range.
"""

import json
import logging
import re
from datetime import datetime
from uuid import uuid4

from anthropic import AsyncAnthropic

from ...matchers import (
    CMMS_ALIASES,
    PATTERNS,
    describe_dataset,
    get_cmms_alias,
    match_field_by_pattern,
    registry_lookup_learned_only,
)
from ..state import FieldMapping, MigrationState

from cafm_shared.logging import get_logger
logger = get_logger(__name__)


def _normalize_field_name(field_name: str) -> str:
    """
    Normalize field name for matching.
    Handles case insensitivity, whitespace, punctuation.

    Collapses EVERY run of non-alphanumeric characters to a single underscore,
    not just an explicit separator set. The previous regex ([\\s\\-_/.,;]+)
    left parentheses and other punctuation intact, so a source column like
    "Distance (km)" normalized to "distance_(km)" and failed to equal the
    real target column "distance_km" at Strategy 0a (direct target-table
    column match) — sending columns that DO exist on an existing table down
    the unresolved/semantic path instead. Broadening to [^a-z0-9]+ makes this
    consistent with the frontend (toSnakeCase / normalizeCol) and the semantic
    mapper (_norm_col), so units-in-parentheses columns map exactly:
      "Distance (km)"           -> "distance_km"
      "Total Trip Cost (AED)"   -> "total_trip_cost_aed"
      "Allowance / Per Diem (AED)" -> "allowance_per_diem_aed"
    Canonical fields and common variations are already snake_case, so their
    normalization is unchanged.
    """
    normalized = field_name.lower().strip()
    normalized = re.sub(r'[^a-z0-9]+', '_', normalized)
    normalized = normalized.strip('_')
    return normalized


CANONICAL_FIELDS = {
    # Assets
    "asset_code", "asset_name", "category", "location_code", "make", "model", "serial",
    "criticality", "install_date", "status",
    # Work Orders
    "wo_code", "wo_priority", "wo_status", "wo_type", "maintenance_type",
    "assigned_tech_id", "cause_code", "cost_parts_aed", "cost_vendor_aed", "fault_code",
    "labor_minutes", "resolution_code", "sla_breached", "sla_response_actual_mins",
    "sla_response_target_mins", "travel_minutes", "vendor_id", "responded_at",
    "created_at", "completed_at",
    # Scheduled Maintenance
    "sm_code", "trigger_type", "schedule_interval", "sm_priority",
    # Parts
    "part_code", "stock_on_hand", "minimum_allowed_stock", "supplier", "bom_group_name",
    # Users
    "user_full_name", "user_title", "user_name", "reports_to",
    # Inspections
    "inspector_name", "inspection_date", "inspection_location", "finding_type", "risk_level",
    # Sites
    "site_id", "site_name", "site_type",
}

COMMON_VARIATIONS = {
    "asset_id": "asset_code", "asset_code": "asset_code", "asset_num": "asset_code",
    "asset_number": "asset_code", "equipment_id": "asset_code", "equipment_code": "asset_code",
    "asset_type": "category", "asset_category": "category", "equipment_type": "category",
    "category_id": "category", "asset_name": "asset_name", "equipment_name": "asset_name",
    "asset_desc": "asset_name", "description": "asset_name", "manufacturer": "make",
    "make": "make", "brand": "make", "model": "model", "model_num": "model",
    "serial": "serial", "serial_num": "serial", "serial_number": "serial", "sn": "serial",
    "install_date": "install_date", "installation_date": "install_date",
    "commissioned_date": "install_date", "criticality": "criticality",
    "criticality_level": "criticality", "location": "location_code", "location_code": "location_code",
    "location_id": "location_code", "zone": "location_code", "room": "location_code",
    "status": "status", "asset_status": "status", "wo_id": "wo_code", "wo_code": "wo_code",
    "work_order_id": "wo_code", "work_order_number": "wo_code", "wo_number": "wo_code",
    "order_number": "wo_code", "priority": "wo_priority", "wo_priority": "wo_priority",
    "priority_level": "wo_priority", "wo_status": "wo_status", "work_order_status": "wo_status",
    "wo_type": "wo_type", "work_order_type": "wo_type", "order_type": "wo_type",
    "maintenance_type": "maintenance_type", "job_type": "maintenance_type",
    "maintenance_type_id": "maintenance_type", "site_id": "site_id", "site_code": "site_id",
    "site_name": "site_name", "location_name": "site_name", "site_type": "site_type",
    "location_type": "site_type", "created_at": "created_at", "created_date": "created_at",
    "date_created": "created_at", "creation_date": "created_at", "completed_at": "completed_at",
    "completed_date": "completed_at", "date_completed": "completed_at",
    "completion_date": "completed_at", "responded_at": "responded_at",
    "response_date": "responded_at",
}


def _match_common_variation(source_field: str) -> tuple:
    """Strategy 1B: Match against common field name variations."""
    normalized_source = _normalize_field_name(source_field)
    if normalized_source in COMMON_VARIATIONS:
        target = COMMON_VARIATIONS[normalized_source]
        return (target, 0.95)
    return None


def _get_canonical_fields(json_mapper: dict) -> set:
    """Extract canonical field names from JSON mapper."""
    return set(json_mapper.get("canonical_fields", {}).keys())


def _match_json_alias(source_field: str, json_mapper: dict) -> tuple:
    """Match source field against vendor aliases in JSON mapper."""
    vendor_aliases = json_mapper.get("vendor_aliases", {})
    normalized_source = _normalize_field_name(source_field)
    for canonical, sources in vendor_aliases.items():
        for source_alias in sources:
            normalized_alias = _normalize_field_name(source_alias)
            if normalized_source == normalized_alias:
                confidence_overrides = json_mapper.get("confidence_overrides") or {}
                conf = confidence_overrides.get(canonical, 0.95)
                return (canonical, conf)
    return None


def _match_json_regex(source_field: str, json_mapper: dict) -> tuple:
    """Match source field against regex patterns in JSON mapper."""
    regex_patterns = json_mapper.get("regex_patterns") or {}
    normalized_source = _normalize_field_name(source_field)
    for canonical, pattern_config in regex_patterns.items():
        patterns = pattern_config.get("patterns", [])
        for pattern in patterns:
            if re.match(pattern, source_field, re.IGNORECASE) or re.match(pattern, normalized_source, re.IGNORECASE):
                conf = pattern_config.get("confidence", 0.80)
                if conf >= 0.85:
                    return (canonical, conf)
    return None


def _match_sheet_to_table(table_name: str, db_tables: list[str]) -> str | None:
    """Match a source sheet name to a real plenum_cafm table (singular/plural/space tolerant)."""
    t = table_name.lower().strip()
    variants = {t, t.replace(" ", "_"), t.rstrip("s"), t.replace(" ", "_").rstrip("s")}
    for tgt in db_tables:
        tl = tgt.lower()
        if tl in variants or tl.rstrip("s") in variants:
            return tgt
    return None


async def deterministic_mapper_node(state: MigrationState) -> MigrationState:
    """
    Node 2: Deterministic field mapping — MULTI-TABLE (each table processed independently).

    For multi-table uploads (e.g., work_orders.csv, assets.csv), columns are
    mapped per source table. Results grouped by table for human review.
    """

    _node_started_at = datetime.utcnow()
    migration_id = state.get("migration_id")
    cmms_name = state.get("cmms_name", "Unknown")
    parsed_tables = state.get("parsed_tables", {})
    column_descriptions = state.get("column_descriptions", {})
    json_mapper = state.get("json_mapper")

    if not parsed_tables:
        logger.error(f"[Node 2] No parsed tables found")
        state["error_message"] = "No parsed data from Node 1"
        state["error_node"] = 2
        return state

    # Determine canonical fields
    if json_mapper:
        canonical_fields_raw = _get_canonical_fields(json_mapper)
        canonical_fields = {_normalize_field_name(f) for f in canonical_fields_raw}
        canonical_fields_map = {_normalize_field_name(f): f for f in canonical_fields_raw}
        logger.info(f"[Node 2] Using customer JSON mapper: {json_mapper.get('source_system')}")
        logger.info(f"[Node 2] Loaded {len(canonical_fields_raw)} canonical fields")
    else:
        canonical_fields_raw = list(CANONICAL_FIELDS)
        canonical_fields = CANONICAL_FIELDS
        canonical_fields_map = {f: f for f in CANONICAL_FIELDS}
        logger.info(f"[Node 2] Using default hardcoded canonical fields")

    logger.info(f"[Node 2] Starting deterministic mapping (MULTI-TABLE): migration_id={migration_id}")

    try:
        # Real plenum_cafm tables + their columns — lets us match source columns directly
        # against the routed target table's ACTUAL columns (not just the canonical list),
        # so table-specific columns (city, country, floors, gfa_sqm, …) map exactly.
        from ...db import get_plenum_cafm_columns_by_table
        _columns_by_table = await get_plenum_cafm_columns_by_table()
        _db_tables = sorted(_columns_by_table.keys())

        # Node 1's table matcher (deterministic name match + Haiku fallback) — the best
        # signal for a sheet whose name is NOT a CAFM table (e.g. sites_2 → sites). Used
        # to pick the target table whose REAL columns we match against, so table-specific
        # columns (city, country, floors, …) map exactly instead of falling to semantic.
        _ingest_table_matches = {
            str(k): str(v)
            for k, v in (state.get("cafm_table_matches") or {}).items()
            if v and str(v) in _columns_by_table
        }

        # MULTI-TABLE: Process each source table independently
        tier1_mappings_by_table = {}
        unresolved_by_table = {}
        all_confidences = []

        for table_name in sorted(parsed_tables.keys()):
            table_records = parsed_tables[table_name]
            if not table_records:
                logger.info(f"[Node 2] Skipping empty table: {table_name}")
                tier1_mappings_by_table[table_name] = []
                unresolved_by_table[table_name] = []
                continue

            logger.info(f"[Node 2] ► Processing source table: {table_name}")

            # Get columns for THIS table only
            table_columns = sorted(table_records[0].keys())
            logger.info(f"[Node 2]   Columns: {len(table_columns)} [{', '.join(table_columns[:5])}...]")

            # Determine this sheet's target CAFM table early so its columns can be matched
            # directly against the table's REAL columns (e.g. sites → plenum_cafm.sites).
            # Prefer Node 1's name+LLM match (handles sites_2 → sites) and fall back to a
            # pure name match.
            _early_target = (
                _ingest_table_matches.get(table_name)
                or _match_sheet_to_table(table_name, _db_tables)
            )
            _target_cols_norm = (
                {_normalize_field_name(c): c for c in _columns_by_table.get(_early_target, set())}
                if _early_target else {}
            )

            tier1_for_table = []
            unresolved_for_table = []
            table_confidences = []

            # Apply strategies to each column in this table
            for source_field in table_columns:
                # Strategy 0a: Direct target-table column match (HIGHEST preference). If this
                # sheet routes to a real CAFM table and the column name matches one of THAT
                # table's columns, map it straight there — covers table-specific columns
                # (city, country, floors, gfa_sqm, site_type, …) not in the canonical list.
                _norm_sf = _normalize_field_name(source_field)
                if _norm_sf in _target_cols_norm:
                    _actual = _target_cols_norm[_norm_sf]
                    mapping = FieldMapping(
                        source_field=source_field, target_field=_actual, confidence=0.98,
                        tier="T1_table_exact",
                        rationale=f"Exact column match on target table '{_early_target}'",
                        langsmith_run_id=None,
                    )
                    tier1_for_table.append(mapping)
                    table_confidences.append(0.98)
                    logger.info(f"[Node 2]   S0a (table-col): {source_field} → {_actual} (0.98)")
                    continue

                # Strategy 0: Identity key (FIRST preference). The table's OWN identity
                # column — "id" or "<table>_id" (asset_id in 'assets', site_id in 'sites',
                # work_order_id in 'work_orders') — is the business key, so map it straight
                # to the canonical primary key 'id'. write_node then promotes it to the real
                # PK that other tables' FKs reference. Foreign keys to OTHER tables (e.g.
                # site_id inside 'assets') do NOT match here and fall through to normal
                # matching below.
                _sf = source_field.lower().strip()
                _tbl = table_name.lower().strip()
                _sing = (
                    _tbl[:-3] + "y" if _tbl.endswith("ies")
                    else _tbl[:-1] if (_tbl.endswith("s") and not _tbl.endswith("ss"))
                    else _tbl
                )
                if _sf in {"id", f"{_tbl}_id", f"{_sing}_id"}:
                    mapping = FieldMapping(
                        source_field=source_field, target_field="id", confidence=0.99,
                        tier="T1_identity",
                        rationale=f"Identity/business key for '{table_name}' → primary key 'id'",
                        langsmith_run_id=None,
                    )
                    tier1_for_table.append(mapping)
                    table_confidences.append(0.99)
                    logger.info(f"[Node 2]   S0 (identity): {source_field} → id (0.99)")
                    continue

                # Strategy 1: Exact match
                normalized_source = _normalize_field_name(source_field)
                if normalized_source in canonical_fields:
                    target = canonical_fields_map[normalized_source]
                    mapping = FieldMapping(
                        source_field=source_field, target_field=target, confidence=0.99,
                        tier="T1_exact", rationale="Exact canonical field name match (normalized)",
                        langsmith_run_id=None,
                    )
                    tier1_for_table.append(mapping)
                    table_confidences.append(0.99)
                    logger.info(f"[Node 2]   S1 (exact): {source_field} → {target} (0.99)")
                    continue

                # Strategy 1B: Common variations
                variation_result = _match_common_variation(source_field)
                if variation_result:
                    target, conf = variation_result
                    target_normalized = _normalize_field_name(target) if json_mapper else target
                    if target_normalized in canonical_fields:
                        target_canonical = canonical_fields_map[target_normalized]
                        mapping = FieldMapping(
                            source_field=source_field, target_field=target_canonical, confidence=conf,
                            tier="T1_variation", rationale="Common field name variation",
                            langsmith_run_id=None,
                        )
                        tier1_for_table.append(mapping)
                        table_confidences.append(conf)
                        logger.info(f"[Node 2]   S1B (var): {source_field} → {target_canonical} ({conf})")
                        continue

                # Strategy 2: Alias lookup
                if json_mapper:
                    alias_result = _match_json_alias(source_field, json_mapper)
                else:
                    alias_result = get_cmms_alias(source_field, cmms_name)

                if alias_result:
                    target, conf = alias_result
                    target_check = _normalize_field_name(target) if json_mapper else target
                    if target_check in canonical_fields:
                        mapping = FieldMapping(
                            source_field=source_field, target_field=target, confidence=conf,
                            tier="T1_alias", rationale=f"Matched via CMMS alias table ({cmms_name})",
                            langsmith_run_id=None,
                        )
                        tier1_for_table.append(mapping)
                        table_confidences.append(conf)
                        logger.info(f"[Node 2]   S2 (alias): {source_field} → {target} ({conf:.2f})")
                        continue

                # Strategy 3: Regex matching
                if json_mapper:
                    pattern_result = _match_json_regex(source_field, json_mapper)
                else:
                    pattern_result = match_field_by_pattern(source_field)

                if pattern_result:
                    target, conf = pattern_result
                    target_check = _normalize_field_name(target) if json_mapper else target
                    if target_check in canonical_fields and conf >= 0.85:
                        mapping = FieldMapping(
                            source_field=source_field, target_field=target, confidence=conf,
                            tier="T1_regex", rationale="Matched via naming pattern regex",
                            langsmith_run_id=None,
                        )
                        tier1_for_table.append(mapping)
                        table_confidences.append(conf)
                        logger.info(f"[Node 2]   S3 (regex): {source_field} → {target} ({conf:.2f})")
                        continue

                # Strategy R: Registry lookup (learned semantic matches)
                # Checks aliases that were previously approved via semantics/human
                # review and promoted to deterministic. Runs before LLM to avoid
                # paying embedding + inference costs for already-seen aliases.
                registry_hit = registry_lookup_learned_only(source_field)
                if registry_hit:
                    target, conf, _tier = registry_hit
                    target_check = _normalize_field_name(target) if json_mapper else target
                    if target_check in canonical_fields:
                        mapping = FieldMapping(
                            source_field=source_field, target_field=target, confidence=conf,
                            tier="T1_registry",
                            rationale="Registry hit — previously approved semantic match (deterministic)",
                            langsmith_run_id=None,
                        )
                        tier1_for_table.append(mapping)
                        table_confidences.append(conf)
                        logger.info(
                            f"[Node 2]   SR (registry): {source_field} → {target} ({conf:.2f}) "
                            f"[saved LLM call]"
                        )
                        continue

                # Unresolved — will go to Tier 2
                unresolved_for_table.append(source_field)
                logger.debug(f"[Node 2]   Unresolved: {source_field}")

            # Strategy 4: Haiku on unresolved fields for THIS table
            if unresolved_for_table:
                logger.info(f"[Node 2]   S4 (Haiku): {len(unresolved_for_table)} unresolved fields for {table_name}")
                strategy4_mappings = await _strategy4_haiku_mapping(
                    unresolved_for_table, column_descriptions, state, canonical_fields_raw,
                )
                tier1_for_table.extend(strategy4_mappings)
                strategy4_targets = {m["source_field"] for m in strategy4_mappings}
                unresolved_for_table = [f for f in unresolved_for_table if f not in strategy4_targets]
                for mapping in strategy4_mappings:
                    table_confidences.append(mapping.get("confidence", 0.80))

            # EL-M.2: Dedup target fields within this table
            target_to_mappings = {}
            for mapping in tier1_for_table:
                target = mapping.get("target_field")
                if target not in target_to_mappings:
                    target_to_mappings[target] = []
                target_to_mappings[target].append(mapping)

            deduplicated = []
            for target, mappings in target_to_mappings.items():
                if len(mappings) > 1:
                    mappings_sorted = sorted(mappings, key=lambda m: m.get("confidence", 0), reverse=True)
                    deduplicated.append(mappings_sorted[0])
                    for m in mappings_sorted[1:]:
                        source = m.get("source_field")
                        unresolved_for_table.append(source)
                        logger.info(f"[Node 2]   EL-M.2: Dedup {source} → {target}, moved to Tier 2")
                else:
                    deduplicated.append(mappings[0])

            tier1_mappings_by_table[table_name] = deduplicated
            unresolved_by_table[table_name] = unresolved_for_table
            all_confidences.extend(table_confidences)

            logger.info(f"[Node 2] ✓ Table {table_name}: {len(deduplicated)} mapped, {len(unresolved_for_table)} unresolved")

        # ── Overall statistics
        total_mapped = sum(len(m) for m in tier1_mappings_by_table.values())
        total_unresolved = sum(len(u) for u in unresolved_by_table.values())
        overall_confidence = (sum(all_confidences) / len(all_confidences)) if all_confidences else 0.0

        logger.info(f"[Node 2] ═══════════════════════════════════════════")
        logger.info(f"[Node 2] Total: {total_mapped} mapped, {total_unresolved} unresolved")
        logger.info(f"[Node 2] Overall confidence: {overall_confidence:.2f}")
        logger.info(f"[Node 2] EL-M.2 PASSED: All confidences valid, duplicates resolved per table")

        # ── Build initial table_routing ────────────────────────────────────
        # Maps each source sheet name → target entity type for IntermediateSchema routing.
        # Priority: (1) source table name pattern, (2) dominant mapped canonical fields.
        _TABLE_NAME_PATTERNS = [
            ("asset", "assets"), ("equipment", "assets"), ("equip", "assets"),
            ("work_order", "work_orders"), ("workorder", "work_orders"), ("wo", "work_orders"),
            ("scheduled_pm", "maintenance_plans"), ("maintenance", "maintenance_plans"), ("pm", "maintenance_plans"),
            ("part", "spare_parts"), ("inventory", "spare_parts"),
            ("user", "technicians"), ("technician", "technicians"), ("personnel", "technicians"),
            ("inspection", "findings"), ("finding", "findings"),
            ("site", "locations"), ("location", "locations"),
        ]
        _ENTITY_FIELD_SIGNALS: dict[str, set[str]] = {
            "assets":            {"asset_code", "asset_name", "category", "make", "model", "serial"},
            "work_orders":       {"wo_code", "wo_priority", "wo_status", "wo_type", "maintenance_type"},
            "maintenance_plans": {"sm_code", "trigger_type", "schedule_interval", "sm_priority"},
            "spare_parts":       {"part_code", "stock_on_hand", "minimum_allowed_stock", "supplier"},
            "technicians":       {"user_full_name", "user_title", "user_name", "reports_to"},
            "findings":          {"inspector_name", "inspection_date", "finding_type", "risk_level"},
            "locations":         {"site_id", "site_name", "site_type"},
        }

        # (_ingest_table_matches computed above — Node 1 name+LLM table match — also
        #  seeds table_routing below so the Step-1 gate defaults to that guess.)
        table_routing: dict[str, str] = {}
        for table_name, mappings in tier1_mappings_by_table.items():
            table_lower = table_name.lower().strip()
            matched_entity: str | None = None

            # (-1) Node 1 table match (name + LLM) — highest priority when it points
            # at a real CAFM table.
            _ingest_hit = _ingest_table_matches.get(table_name)
            if _ingest_hit and _ingest_hit in _db_tables:
                matched_entity = _ingest_hit

            # (0) Direct name match (GENERIC): the sheet name IS a real CAFM table name
            # (singular/plural/space-or-underscore tolerant). Check the ACTUAL plenum_cafm
            # tables FIRST (so "sites" → sites when that table exists), then the built-in
            # entity list. e.g. "assets" → assets, "work orders" → work_orders.
            sheet_variants = {
                table_lower,
                table_lower.replace(" ", "_"),
                table_lower.rstrip("s"),
                table_lower.replace(" ", "_").rstrip("s"),
            }
            if not matched_entity:
                for targets in (_db_tables, list(_ENTITY_FIELD_SIGNALS.keys())):
                    for tgt in targets:
                        t = tgt.lower()
                        if t in sheet_variants or t.rstrip("s") in sheet_variants:
                            matched_entity = tgt
                            break
                    if matched_entity:
                        break

            # (1) Name-pattern match
            if not matched_entity:
                for pattern, entity_type in _TABLE_NAME_PATTERNS:
                    if pattern in table_lower:
                        matched_entity = entity_type
                        break

            # (2) Field-content inference
            if not matched_entity:
                target_fields = {m.get("target_field", "") for m in mappings}
                best_entity, best_score = None, 0
                for entity_type, signals in _ENTITY_FIELD_SIGNALS.items():
                    score = len(target_fields & signals)
                    if score > best_score:
                        best_score = score
                        best_entity = entity_type
                if best_entity and best_score >= 1:
                    matched_entity = best_entity

            # (3) Unknown — keep source table name (will be treated as new/custom entity)
            table_routing[table_name] = matched_entity if matched_entity else table_lower
            logger.info(f"[Node 2]   table_routing: '{table_name}' → '{table_routing[table_name]}'")

        # ── Store results in state
        state["tier1_mappings_by_table"] = tier1_mappings_by_table
        state["unresolved_by_table"] = unresolved_by_table
        state["table_routing"] = table_routing
        # Flatten tier1 mappings for API response
        state["tier1_mappings"] = [m.dict() if hasattr(m, 'dict') else m for table_mappings in tier1_mappings_by_table.values() for m in table_mappings]
        state["tier1_mapped_count"] = total_mapped
        state["overall_confidence"] = overall_confidence
        state["el_m2_passed"] = True
        state["current_step"] = 2
        state["event_log"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "event": "node_complete",
            "node": 2,
            "detail": f"{total_mapped} mapped, {total_unresolved} unresolved (by table)"
        })

        logger.info(f"[Node 2] Complete (MULTI-TABLE)")

        migration_id = state.get("migration_id")
        if migration_id:
            from .db_writer import update_node_progress, write_step_pause
            await update_node_progress(
                migration_id, "2_deterministic_mapping",
                t1_mapped_count=total_mapped,
            )
            # Build per-table field list for UI display
            mappings_by_table = {}
            for tbl, mappings in state.get("tier1_mappings_by_table", {}).items():
                mappings_by_table[tbl] = [
                    {
                        "source_field": m.get("source_field"),
                        "target_field": m.get("target_field"),
                        "confidence": m.get("confidence"),
                        "tier": m.get("tier"),
                        "rationale": m.get("rationale"),
                    }
                    for m in mappings
                ]
            unresolved_by_table = {
                tbl: list(fields)
                for tbl, fields in state.get("unresolved_by_table", {}).items()
                if fields
            }
            await write_step_pause(
                migration_id,
                "step_2_deterministic_mapping",
                {
                    "node": 2,
                    "label": "Deterministic Mapping (Tier 1)",
                    "t1_mapped": total_mapped,
                    "unresolved": total_unresolved,
                    "mappings_by_table": mappings_by_table,
                    "unresolved_by_table": unresolved_by_table,
                },
            )
            from .schema_db_writer import migration_append_node_log_auto
            await migration_append_node_log_auto(
                migration_id, 2, "Deterministic Mapping", _node_started_at, datetime.utcnow(),
                output={"total_columns": total_mapped + total_unresolved,
                        "tier1_mapped": total_mapped,
                        "unresolved": total_unresolved,
                        # Per-table unmatched field names so the pre-semantic gate can show the
                        # unmatched count + list beneath each table's matched fields.
                        "unresolved_by_table": unresolved_by_table,
                        "coverage_pct": round(total_mapped / (total_mapped + total_unresolved) * 100, 1) if (total_mapped + total_unresolved) else 0,
                        "overall_confidence": round(overall_confidence, 3),
                        # Persisted so the full-table export can discover the target tables.
                        "table_routing": table_routing,
                        # Total CAFM tables the sheets were matched against (Step 1 display).
                        "cafm_table_count": len(_db_tables)},
                logs=[f"Ran 4-tier deterministic matching (exact → alias → regex → Haiku)",
                      f"{total_mapped} fields matched at Tier 1",
                      f"{total_unresolved} fields unresolved → passed to semantic mapping",
                      f"Overall confidence: {overall_confidence:.2f}"],
            )

        return state

    except Exception as e:
        logger.exception(f"[Node 2] Unhandled exception: {e}")
        state["error_message"] = str(e)
        state["error_node"] = 2
        state["error_timestamp"] = datetime.utcnow()
        state["status"] = "failed"
        return state


async def _strategy4_haiku_mapping(
    unresolved_fields: list[str],
    column_descriptions: dict[str, str],
    state: MigrationState,
    canonical_fields: set[str] = None,
) -> list[FieldMapping]:
    """Strategy 4: Haiku maps unresolved fields (confidence >= 0.85 only).

    Args:
        unresolved_fields: Fields that didn't match in Strategies 1-3
        column_descriptions: Semantic descriptions of each field
        state: Migration state
        canonical_fields: Valid canonical fields for this CMMS (from customer mapper).
                         If None, falls back to default CANONICAL_FIELDS.
    """

    from ...app import get_anthropic_client

    client = get_anthropic_client()
    field_info = []
    for field in unresolved_fields:
        desc = column_descriptions.get(field, "Unknown field type")
        field_info.append(f"- {field}: {desc}")

    # Use customer's canonical fields if provided, otherwise fall back to defaults
    if canonical_fields:
        canonical_list = ", ".join(sorted(canonical_fields))
    else:
        canonical_list = ", ".join(sorted(CANONICAL_FIELDS))

    prompt = f"""Map these CMMS field names to canonical CAFM field names.
Be STRICT: only map if confidence >= 0.85. Otherwise, return "UNMAPPED".

Unresolved fields:
{chr(10).join(field_info)}

Canonical fields available:
{canonical_list}

Return JSON only:
{{
  "field_name": {{"target": "canonical_field", "confidence": 0.95, "rationale": "reason"}},
  "another_field": "UNMAPPED"
}}"""

    try:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = response.content[0].text.strip()

        # Extract JSON from markdown code blocks if present
        json_text = response_text
        if "```json" in response_text:
            start = response_text.find("```json") + 7
            end = response_text.find("```", start)
            if end > start:
                json_text = response_text[start:end].strip()
        elif "```" in response_text:
            start = response_text.find("```") + 3
            end = response_text.find("```", start)
            if end > start:
                json_text = response_text[start:end].strip()

        try:
            result = json.loads(json_text)
        except json.JSONDecodeError as e:
            logger.warning(f"[Node 2] Strategy 4: JSON parse failed: {e}")
            logger.debug(f"[Node 2] Raw response: {response_text[:200]}")
            return []

        mappings = []
        langsmith_run_id = str(uuid4())

        for source_field, mapping_data in result.items():
            if mapping_data == "UNMAPPED":
                logger.debug(f"[Node 2] S4: {source_field} → UNMAPPED")
                continue

            if isinstance(mapping_data, dict):
                target = mapping_data.get("target")
                confidence = mapping_data.get("confidence", 0.0)
                rationale = mapping_data.get("rationale", "Haiku mapping")

                # Use provided canonical_fields if available, otherwise fall back to CANONICAL_FIELDS
                valid_targets = canonical_fields if canonical_fields else CANONICAL_FIELDS

                if target in valid_targets and confidence >= 0.85:
                    mapping = FieldMapping(
                        source_field=source_field, target_field=target, confidence=confidence,
                        tier="T1_llm", rationale=rationale, langsmith_run_id=langsmith_run_id,
                    )
                    mappings.append(mapping)
                    logger.info(f"[Node 2] S4 (Haiku): {source_field} → {target} ({confidence:.2f})")
                else:
                    logger.debug(f"[Node 2] S4: {source_field} conf {confidence} < 0.85 → Tier 2")

        return mappings

    except Exception as e:
        logger.warning(f"[Node 2] Strategy 4 (Haiku) failed: {e}")
        return []
