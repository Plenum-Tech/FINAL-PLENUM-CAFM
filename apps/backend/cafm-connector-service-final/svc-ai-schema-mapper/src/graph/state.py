"""LangGraph state machine state definitions for svc-AI-Schema-Mapper.

TypedDict structures for MigrationState and supporting domain objects.
"""

from typing import TypedDict, Optional, Any
from datetime import datetime


class ExtraFieldConfig(TypedDict, total=False):
    """DDL intent for an unmapped field — built by Node 4, executed by Node 9.

    storage_strategy:
      "custom"       — add a new column to a plenum_cafm table (requires DDL)
      "raw_metadata" — store in existing raw_metadata JSONB column (no DDL)
      "skip"         — discard the field entirely
    """
    source_field: str
    source_table: str            # which source table this came from
    storage_strategy: str        # "custom" | "raw_metadata" | "skip"

    # ── DDL fields (only when storage_strategy == "custom") ──────────
    target_table: str            # plenum_cafm table to add the column to
    custom_column_name: str      # exact column name to create
    data_type: str               # SQL type: VARCHAR(255), INTEGER, BOOLEAN, etc.
    is_new_table: bool           # True if target_table doesn't exist yet
    new_table_pk: str            # PK column name for new tables (default "id")
    nullable: bool               # whether the new column allows NULLs (default True)

    user_approved: bool


class FieldMapping(TypedDict, total=False):
    """Per-field mapping decision."""
    source_field: str
    target_field: str
    confidence: float  # 0.0-1.0
    tier: str  # T1_exact, T1_alias, T1_regex, T1_llm, T2_semantic, T2_human, T2_multi_merge, unmapped
    rationale: str
    sample_values: list[str]
    data_type: str  # user-chosen SQL type for a new-table column (else inferred at write)
    transformation: Optional[str]  # e.g., "concat_space", "coalesce", None
    source_fields: Optional[list[str]]  # for multi-merge strategies
    merge_strategy: Optional[str]  # concat_space, concat_comma, coalesce, concat_dash
    reviewer_id: Optional[str]  # user who approved/rejected
    review_timestamp: Optional[datetime]
    langsmith_run_id: Optional[str]  # LangSmith trace ID for this field's mapping (Strategy 4 or Node 3)


class HierarchyRelationship(TypedDict, total=False):
    """Detected FK or containment relationship."""
    source_table: str
    source_column: str
    target_table: str
    target_column: str
    relationship_type: str  # CONTAINMENT, REFERENCE, OWNERSHIP, PART_OF, SELF_REF
    confidence: float
    data_match_rate: float
    reasoning: str
    customer_confirmed: bool
    confirmed_at: Optional[datetime]
    system_default: bool  # Plenum template edge (not in import file)
    mapping_note: bool  # Import table → Plenum tier mapping row


class MigrationState(TypedDict, total=False):
    """
    Full state for a single migration run through the 9-node pipeline.

    CRITICAL: source_blob_url stores URL only, NOT file bytes. Node 1 downloads,
    parses, then clears source_file_bytes before checkpoint write.
    """

    # ── Session & Metadata ────────────────────────────────────────────────
    migration_id: str
    organization_id: str
    cmms_name: str  # "Maximo", "Fiix", "SAP PM", "Archibus", "Custom"
    source_system: str  # source CMMS identifier from customer
    uploaded_by: str  # user ID
    upload_timestamp: datetime

    # ── Node 1: Ingest ────────────────────────────────────────────────────
    source_blob_url: str  # Azure Blob URL (NOT file bytes)
    source_file_bytes: Optional[bytes]  # Transient; cleared before checkpoint
    source_encoding: str  # e.g., "utf-8", "iso-8859-1"
    source_delimiter: str  # "," or "\t" or ";"
    detected_file_format: str  # "csv" or "xlsx"

    parsed_tables: dict[str, Any]  # dict[table_name] = pandas.DataFrame.to_dict() — 5-row sample
    full_tables: dict[str, Any]    # dict[table_name] = full file records — set by Node 1, used by Node 5+
    row_count: int
    column_count: int
    table_health: dict[str, Any]  # TableHealth metrics per table
    cafm_table_matches: dict[str, Optional[str]]  # Node 1: source sheet → plenum_cafm table (or None)
    dataset_summary: str  # Human-readable description of dataset
    column_descriptions: dict[str, str]  # dict[column_name] = "semantic description"

    # ── Node 2: Deterministic Mapping ────────────────────────────────────
    tier1_mappings_by_table: dict[str, list[FieldMapping]]  # dict[table_name] = [FieldMapping]
    tier1_mapped_count: int
    unresolved_by_table: dict[str, list[str]]  # dict[table_name] = [unresolved field names]

    # ── Pre-Semantic Gate (between Node 2 and Node 3) ────────────────────
    pre_semantic_review_payload: Optional[dict[str, Any]]  # Interrupt payload for the pre-semantic gate
    tier1_approved_by_table: dict[str, list[FieldMapping]]  # T1 fields approved at pre-semantic gate (alias auto-included)

    # ── Node 3: Semantic Mapping ─────────────────────────────────────────
    tier2_auto_by_table: dict[str, list[FieldMapping]]  # confidence >= 0.85, grouped by table
    tier2_flagged_by_table: dict[str, list[FieldMapping]]  # 0.65 <= confidence < 0.85, grouped by table
    tier2_unmappable_by_table: dict[str, list[str]]  # source fields < 0.65 confidence, grouped by table
    overall_confidence: float  # weighted average of all mapped fields

    # ── Node 4: Human Review ──────────────────────────────────────────────
    human_review_payload: Optional[dict[str, Any]]  # Interrupt payload for GATE 1 (grouped by table)
    tier2_human_decisions_by_table: dict[str, list[FieldMapping]]  # dict[table_name] = decisions
    tier2_human_count: int
    extra_fields_config: list[ExtraFieldConfig]  # DDL intent for unmapped fields — built by Node 4, executed by Node 9

    # ── Table Routing (multi-table support) ───────────────────────────────
    # Maps each source sheet name to its target entity type in the IntermediateSchema.
    # Built by Node 2 via name/field inference; updated by Node 4 for is_new_table=True entries.
    # Example: {"Assets": "assets", "Work Orders": "work_orders", "Custom": "custom_table"}
    table_routing: dict[str, str]
    # Names of brand-new plenum_cafm tables to be created by Node 9 DDL.
    # Populated by Node 4 when extra_fields_config contains is_new_table=True entries.
    new_tables: list[str]

    # ── Node 5: Preprocess ────────────────────────────────────────────────
    cleaned_tables: dict[str, Any]  # dict[table_name] = [records] — Deduplicated, null-handled, coerced
    row_count_post_dedup_by_table: dict[str, int]  # dict[table_name] = post-dedup row count
    dedup_drop_count_by_table: dict[str, int]  # dict[table_name] = rows dropped
    data_quality_warnings: list[str]

    # ── Node 6-7: Hierarchy Detection & Verification ──────────────────────
    fk_candidates: list[HierarchyRelationship]  # Initial FK scan (source_table → target_table)
    confirmed_hierarchies: list[HierarchyRelationship]  # After validation + human confirmation
    containment_hierarchy_by_table: dict[str, Any]  # dict[table_name] = nested tree structure
    hierarchy_cycles: list[list[str]]  # Any detected cycles (list of cycle paths)
    hierarchy_review_payload: Optional[dict[str, Any]]  # Interrupt payload for GATE 2
    implicit_hierarchies: dict[str, Any]  # SAP-style code hierarchies per table

    # ── Node 8: Output Generation ─────────────────────────────────────────
    output_json_url: str  # Azure Blob URL
    output_csv_url: str  # Azure Blob URL
    output_sql_url: str  # Azure Blob URL
    output_sql_script: str  # Generated SQL statements (used by Node 9 direct DB apply)
    migration_report_url: str  # PDF report
    mapping_flow_url: str  # Optional flow diagram

    # IntermediateSchema Pydantic object (serialized as dict for checkpoint)
    intermediate_schema: Optional[dict[str, Any]]

    # ── Node 9: Write to Platform ─────────────────────────────────────────
    write_review_payload: Optional[dict[str, Any]]  # Interrupt payload for GATE 3
    handoff_status: str  # "pending", "sent", "acknowledged", "failed"
    svc_ingestion_response: Optional[dict[str, Any]]  # Response from svc-ingestion API

    # ── Error & Status Tracking ──────────────────────────────────────────
    current_step: int  # 1-9, which node last ran
    status: str  # "running", "awaiting_review", "complete", "failed", "cancelled"
    error_message: Optional[str]
    error_node: Optional[int]
    error_timestamp: Optional[datetime]

    # ── LangSmith Integration ────────────────────────────────────────────
    langsmith_run_id: Optional[str]  # Master run ID for this migration (set in worker.py config)
    node_langsmith_run_ids: dict[int, str]  # Per-node trace tracking

    # ── Evaluation Layer Results ─────────────────────────────────────────
    el_m1_passed: bool
    el_m2_passed: bool
    el_m3_passed: bool
    el_3_0_force_gate1: bool  # True if overall_confidence < 0.80
    el_m4_passed: bool
    el_m5_passed: bool
    el_m6_passed: bool
    el_m7_passed: bool
    el_m8_passed: bool
    el_m9_passed: bool

    # ── Audit Trail ──────────────────────────────────────────────────────
    event_log: list[dict[str, Any]]  # [{timestamp, event, detail}, ...]
    checkpoint_count: int
