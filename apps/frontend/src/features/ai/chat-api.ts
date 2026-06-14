"use client";

import { useMutation, useQuery, type UseMutationOptions, type UseQueryOptions } from "@tanstack/react-query";

import { env } from "@/config";
import { isUuid } from "./lib/coerce";
import { shouldKeepPollingForFieldMappingGate } from "./pipeline/migration/migration-gate-state";
import {
  schemaMappingPollIntervalMs,
  schemaMappingStatusNeedsPoll,
} from "./pipeline/schema/schema-gate-state";

// test

export class AiApiError extends Error {
  status: number;
  payload: unknown;

  constructor(input: { status: number; message: string; payload: unknown }) {
    super(input.message);
    this.status = input.status;
    this.payload = input.payload;
  }
}

export type AiRequestOptions<TBody> = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  basePath?: string;
};

export function getAiErrorMessage(err: unknown) {
  if (err instanceof AiApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

function isAbsoluteUrl(v: string) {
  return v.startsWith("http://") || v.startsWith("https://");
}

function resolveBase(basePath: string) {
  const clean = basePath.replace(/\/+$/, "");
  if (isAbsoluteUrl(clean)) return clean;
  if (clean.startsWith("/api/ai/")) return clean;
  // Same-origin paths served by nginx in single-app / Azure deployments.
  if (clean.startsWith("/backend/")) return clean;

  const schemaMapperBase = env.schemaMapperBaseUrl.trim();
  if (!schemaMapperBase) {
    throw new Error("Missing NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL. Set it in .env.local and restart the dev server.");
  }
  const api = clean.startsWith("/") ? clean : `/${clean}`;
  return `${schemaMapperBase.replace(/\/+$/, "")}${api}`;
}
/** Download URL for a migration's FULL target tables (existing rows + newly-migrated). */
export function migrationFullExportUrl(migrationId: string, format: "csv" | "json" | "sql"): string {
  return buildAiUrl(`/${encodeURIComponent(migrationId)}/full-export`, { format }, "/api/migration");
}

export function buildAiUrl(
  path?: string,
  query?: AiRequestOptions<unknown>["query"],
  basePath = "/api/ai/schema-mapper",
) {
  const base = resolveBase(basePath);
  const p = path?.trim() ? (path.startsWith("/") ? path : `/${path}`) : "";
  if (isAbsoluteUrl(base)) {
    const url = new URL(`${base}${p}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      qs.set(k, String(v));
    }
  }
  const suffix = qs.toString();
  return `${base}${p}${suffix ? `?${suffix}` : ""}`;
}

const SCHEMA_ARTIFACT_FILES = {
  json: "mapper_config.json",
  csv: "field_mappings.csv",
  sql: "schema_ddl_preview.sql",
} as const;

/** Turn API-relative or legacy blob URLs into a browser-downloadable URL. */
export function resolveSchemaArtifactDownloadUrl(
  sessionId: string,
  url?: string | null,
  artifact?: keyof typeof SCHEMA_ARTIFACT_FILES,
): string | undefined {
  let u = (url ?? "").trim();
  if (!u && artifact) {
    u = `/api/schema-mapping/${sessionId}/artifacts/${SCHEMA_ARTIFACT_FILES[artifact]}`;
  }
  if (!u || u.startsWith("blob://")) return undefined;

  if (u.startsWith("http://") || u.startsWith("https://")) {
    const blobMatch = u.match(
      /schema-mapping\/([^/]+)\/(mapper_config\.json|field_mappings\.csv|schema_ddl_preview\.sql)/,
    );
    if (blobMatch) {
      return buildAiUrl(
        `/artifacts/${blobMatch[2]}`,
        undefined,
        `/api/schema-mapping/${blobMatch[1]}`,
      );
    }
    return u;
  }

  if (u.startsWith("/api/schema-mapping/")) {
    const base = env.schemaMapperBaseUrl.replace(/\/+$/, "");
    return `${base}${u}`;
  }

  const path = u.startsWith("/") ? u : `/artifacts/${u}`;
  return buildAiUrl(path, undefined, `/api/schema-mapping/${sessionId}`);
}

export async function aiRequest<TResponse = unknown, TBody = unknown>(
  opts: AiRequestOptions<TBody>,
): Promise<TResponse> {
  const method = opts.method ?? "POST";
  const url = buildAiUrl(opts.path, opts.query, opts.basePath ?? "/api/ai/schema-mapper");

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "DELETE" && opts.body !== undefined) {
    const b = opts.body as unknown;
    if (typeof FormData !== "undefined" && b instanceof FormData) {
      body = b;
    } else {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      body = JSON.stringify(opts.body);
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: opts.signal,
  });

  const ct = res.headers.get("content-type") ?? "";
  const isJson = ct.includes("application/json") || ct.includes("+json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  const detail =
    typeof payload === "object" && payload !== null && "detail" in payload
      ? (payload as Record<string, unknown>).detail
      : undefined;
  let detailMessage: string | null = null;
  if (typeof detail === "string") {
    const t = detail.trim();
    detailMessage = t ? t : null;
  } else if (Array.isArray(detail)) {
    const parts: string[] = [];
    for (const it of detail) {
      if (typeof it === "string") {
        const t = it.trim();
        if (t) parts.push(t);
        continue;
      }
      if (it && typeof it === "object") {
        const rec = it as Record<string, unknown>;
        const msg = typeof rec.msg === "string" ? rec.msg.trim() : "";
        if (msg) parts.push(msg);
      }
    }
    detailMessage = parts.length ? parts.join("\n") : null;
  }

  if (!res.ok) {
    const msg = detailMessage ?? `AI request failed (${res.status})`;
    throw new AiApiError({ status: res.status, message: msg, payload });
  }

  return payload as TResponse;
}

export const SCHEMA_MAPPER_API_BASE_PATH = "/api";

// ── Node info (shared by both pipelines) ─────────────────────────────────────

export type NodeStatus = "pending" | "running" | "completed";

export type NodeInfo = {
  node_id: number;
  node_name: string;
  status: NodeStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  output: Record<string, unknown> | null;
  logs: string[];
};

export type StepState = "waiting" | "running" | "paused" | "complete" | "error";

// ── Pipeline status unions ────────────────────────────────────────────────────

export type MigrationStatus =
  | "running"
  | "step_paused"
  | "awaiting_review"
  | "complete"
  | "failed"
  | "ddl_failed"
  | "cancelled";

export type SchemaMappingStatus =
  | "running"
  | "step_paused"
  | "awaiting_review"
  | "complete"
  | "error"
  | "ddl_failed"
  | "cancelled";

// ── Migration gate payload types ──────────────────────────────────────────────

export type MigrationPreSemanticReviewItem = {
  source_table: string;
  source_field: string;
  target_field: string;
  confidence: number;
  tier: string;
  rationale?: string;
  sample_values?: string[];
};

export type MigrationPreSemanticGatePayload = {
  gate: string;
  migration_id?: string;
  total_reviewable: number;
  review_items_by_table: Record<string, MigrationPreSemanticReviewItem[]>;
  /** Full plenum_cafm table list — populates the "Canonical target table" dropdown. */
  existing_canonical_tables?: string[];
  /** Each candidate target table → its column names. Drives live column
   *  re-matching when the user picks a different target table. */
  canonical_columns_by_table?: Record<string, string[]>;
  /** Mapper's suggested CAFM target table per source table (source → target). */
  suggested_target_by_table?: Record<string, string>;
  instructions?: string;
};

export type MigrationFlaggedFieldItem = {
  source_field: string;
  source_table: string;
  target_field: string | null;
  confidence: number;
  tier: string;
  rationale?: string | null;
  suggestions?: string[];
  sample_values?: string[];
};

export type MigrationUnmappedFieldItem = {
  source_field: string;
  source_table: string;
  sample_values?: string[];
};

export type MigrationFieldMappingGatePayload = {
  flagged_by_table?: Record<string, MigrationFlaggedFieldItem[]>;
  unmapped_by_table?: Record<string, MigrationUnmappedFieldItem[]>;
  review_items_by_table?: Record<string, MigrationFlaggedFieldItem[]>;
  unmappable_items_by_table?: Record<string, MigrationUnmappedFieldItem[]>;
  existing_canonical_tables?: string[];
  confidence_alert?: { message: string };
};

export type MigrationHierarchyRelationship = {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  relationship_type?: string;
  confidence?: number;
  data_match_rate?: string;
  reasoning?: string;
  system_default?: boolean;
  mapping_note?: boolean;
  read_only?: boolean;
};

export type MigrationHierarchyGatePayload = {
  hierarchies_to_review?: MigrationHierarchyRelationship[];
  proposed_structure?: string;
  single_table_import?: boolean;
  system_default_hierarchy?: boolean;
  import_table_name?: string | null;
  import_table_plenum_role?: string;
  total_hierarchies?: number;
  total_cycles?: number;
  total_orphans?: number;
  hierarchy_tree?: unknown;
  review_items?: unknown[];
};

export type MigrationFinalGatePayload = {
  summary: {
    total_fields: number;
    t1_mapped: number;
    t2_auto_mapped: number;
    t2_human_reviewed: number;
    skipped: number;
    mapping_coverage_pct: number;
    hierarchy?: string;
    rows_to_write?: number;
    overall_confidence?: number;
    source_filename?: string;
    source_type?: string;
    total_entities?: number;
    entity_counts?: Record<string, number>;
  };
};

export type MigrationGatePayload =
  | MigrationPreSemanticGatePayload
  | MigrationFieldMappingGatePayload
  | MigrationHierarchyGatePayload
  | MigrationFinalGatePayload
  | Record<string, unknown>;

// ── Schema Mapper gate payload types ─────────────────────────────────────────

export type SchemaPreSemanticItem = {
  source_table: string;
  source_field: string;
  target_field: string;
  confidence: number;
  tier: string;
  rationale?: string;
  sample_values?: string[];
};

export type SchemaPreSemanticGatePayload = {
  gate: string;
  schema_mapping_id?: string;
  total_reviewable: number;
  items_by_table: Record<string, SchemaPreSemanticItem[]>;
  /** Fiix source table → CAFM target table. */
  target_table_by_source?: Record<string, string>;
  /** Fiix source table → suggested NEW CAFM table name (when no existing table matches). */
  new_table_by_source?: Record<string, string>;
  /** All Fiix source tables (for the Step-1 table-routing list, incl. fully-new ones). */
  all_source_tables?: string[];
  /** Every Fiix object's full column list (name + source type) — for new-table columns. */
  source_columns_by_table?: Record<string, Array<{ field_name: string; data_type?: string }>>;
  /** CAFM table → its columns (for the per-field target-column dropdown). */
  canonical_columns_by_table?: Record<string, string[]>;
  /** All CAFM table names. */
  existing_canonical_tables?: string[];
  instructions?: string;
};

export type SchemaFlaggedMappingItem = {
  source_field: string;
  suggested_target?: string;
  confidence?: number;
  tier?: string;
  rationale?: string;
  suggestions?: string[];
};

export type SchemaUnmappedFieldGateItem = {
  source_field: string;
  data_type_hint?: string;
  nullable?: boolean;
  description?: string;
  actions_available?: string[];
  suggested_canonical_table?: string;
  suggest_new_table?: boolean;
};

export type SchemaFieldMappingGatePayload = {
  schema_mapping_id?: string;
  total_flagged?: number;
  low_confidence_tier1?: Record<string, SchemaFlaggedMappingItem[]>;
  low_confidence_tier2?: Record<string, SchemaFlaggedMappingItem[]>;
  unmapped_fields?: Record<string, SchemaUnmappedFieldGateItem[]>;
  unstructured_candidates?: Record<string, unknown[]>;
  existing_canonical_tables?: string[];
};

export type SchemaDetectedFk = {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  relationship_type?: string;
  confidence?: number;
  reasoning?: string;
};

export type SchemaHierarchyGatePayload = {
  detected_fks: SchemaDetectedFk[];
  hierarchy_levels?: Record<string, number>;
  structure?: string;
};

export type SchemaGateArtifactsSummary = {
  canonical_fields_count?: number;
  total_source_fields?: number;
  tier1_auto_mapped?: number;
  tier2_auto_mapped?: number;
  tier2_flagged?: number;
  unmappable?: number;
  mapping_coverage_pct?: number;
  detected_fk_count?: number;
  max_hierarchy_depth?: number;
  junction_table_count?: number;
};

export type SchemaGateArtifactsPayload = {
  gate?: string;
  schema_mapping_id?: string;
  suggested_schema_name?: string;
  external_cmms_name?: string;
  output_json_url?: string;
  output_csv_url?: string;
  output_sql_url?: string;
  summary?: SchemaGateArtifactsSummary;
  instructions?: string;
  action_required?: string;
};

export type SchemaMappingGateArtifactsReviewRequest = {
  new_schema_name: string;
};

export type SchemaMappingGatePayload =
  | SchemaPreSemanticGatePayload
  | SchemaFieldMappingGatePayload
  | SchemaHierarchyGatePayload
  | SchemaGateArtifactsPayload
  | Record<string, unknown>;

// ── Schema mapping stats ──────────────────────────────────────────────────────

export type SchemaMappingStats = {
  total_tables: number | null;
  total_fields: number | null;
  tier1_mapped: number | null;
  tier2_auto_mapped: number | null;
  tier2_flagged: number | null;
  unmapped: number | null;
  detected_fk_count: number | null;
  hierarchy_depth: number | null;
  mapping_coverage_pct: number | null;
};

// ── Schema gate decision types ────────────────────────────────────────────────

export type SchemaPreSemanticDecision = {
  source_table: string;
  source_field: string;
  decision: "approve" | "semantic";
  target_field?: string;
};

export type SchemaFieldMappingDecision =
  | { action: "accept"; source_field: string; source_table: string }
  | { action: "reject"; source_field: string; source_table: string }
  | { action: "override"; source_field: string; source_table: string; target_field: string; rationale?: string }
  | {
      action: "custom";
      source_field: string;
      source_table: string;
      target_table: string;
      custom_column_name: string;
      data_type: string;
      nullable?: boolean;
      is_new_table?: boolean;
      new_table_name?: string;
      new_table_pk?: string;
    }
  | { action: "raw_metadata"; source_field: string; source_table: string }
  | { action: "skip"; source_field: string; source_table: string };

export type SchemaHierarchyDecision = {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  confirmed: boolean;
};

// ── List / audit / mapping record types ──────────────────────────────────────

export type MigrationDownloadFormat = "json" | "csv" | "sql" | "pdf";

export type MigrationDownloadResponse = {
  download_url: string;
  expires_in_minutes: number;
};

export type MigrationListItem = {
  migration_id: string;
  cmms_name: string;
  status: MigrationStatus;
  progress_pct: number;
  started_at: string;
  completed_at: string | null;
  t1_mapped_count: number;
  t2_auto_count: number;
  total_fields: number;
};

export type MigrationListResponse = {
  migrations: MigrationListItem[];
  total: number;
};

export type SchemaMappingListItem = {
  schema_mapping_id: string;
  external_cmms_name: string;
  status: SchemaMappingStatus;
  progress_pct: number;
  started_at: string;
  completed_at: string | null;
  stats: SchemaMappingStats;
};

export type SchemaMappingListResponse = {
  sessions: SchemaMappingListItem[];
  total: number;
};

export type MappingRecord = {
  source_field: string;
  source_table?: string;
  target_field: string | null;
  confidence: number;
  tier: string;
  rationale?: string;
  mapped_at?: string;
};

export type MappingListResponse = {
  total_mappings: number;
  tier_breakdown: Record<string, number>;
  mappings: MappingRecord[];
};

export type SchemaUnmappedFieldItem = {
  source_table: string;
  source_field: string;
  data_type_hint?: string;
  sample_values?: string[];
  nullable?: boolean;
};

export type SchemaUnmappedResponse = {
  schema_mapping_id: string;
  unmapped_count: number;
  unmapped_fields: SchemaUnmappedFieldItem[];
};

export type AuditEntry = {
  timestamp: string;
  event: string;
  node?: number;
  details?: Record<string, unknown>;
};

export type SchemaAuditEntry = {
  timestamp: string;
  event: string;
  node?: number;
  gate_type?: string;
  details?: Record<string, unknown>;
};

export type ExtraFieldConfig = {
  source_field: string;
  source_table: string;
  storage_strategy: "custom" | "raw_metadata" | "skip";
  target_table?: string;
  custom_column_name?: string;
  data_type?: string;
  nullable?: boolean;
  user_approved: boolean;
};

export type SchemaCustomMappingRequest = {
  source_field: string;
  source_table: string;
  target_field: string;
  rationale?: string;
};

export type SchemaCustomMappingResponse = {
  tier: string;
  confidence: number;
  status: string;
};

export type ListMigrationsParams = {
  organization_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

export type ListSchemaMappingsParams = {
  organization_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

export type TestingArtifactParams = {
  migrationId: string;
  filename: string;
};

export type FiixPlatform = "fiix";

export type FiixCredentials = {
  app_key: string;
  access_key: string;
  secret: string;
};

export type Node4HumanReviewRequest = {
  migration_id: string;
  tier1_mappings: unknown[];
  tier2_flagged_mappings: unknown[];
  tier2_unmappable: unknown[];
  flagged_approvals: unknown[];
  custom_mappings: unknown[];
  intentionally_unmapped: unknown[];
};

export type Node4FinalMapping = {
  source_field: string;
  target_field: string;
  confidence: number;
  approval_status: string;
  source: string;
};

export type Node4MappingStats = {
  auto_approved: number;
  human_approved: number;
  custom_added: number;
  intentionally_unmapped: number;
  overall_confidence: number;
};

export type Node4HumanReviewResponse = {
  migration_id: string;
  total_source_fields: number;
  final_mappings: Node4FinalMapping[];
  intentionally_unmapped: string[];
  tier2_flagged_mappings: unknown[];
  tier2_unmappable_count: number;
  mapping_stats: Node4MappingStats;
  el_m4_passed: boolean;
  error_message: string | null;
  duration_ms: number;
  execution_logs: string[];
};

export type Node5PreprocessRequest = {
  migration_id: string;
  cleaned_tables: Record<string, unknown[]>;
  final_mappings: Node4FinalMapping[];
  table_names: string[];
};

export type Node5PreprocessResponse = {
  migration_id: string;
  cleaned_tables: Record<string, unknown[]>;
  total_original_rows: number;
  total_rows_post_dedup: number;
  total_dedup_drop_count: number;
  overall_dedup_ratio: number;
  table_metrics: unknown[];
  data_quality_warnings: unknown[];
  detected_fk_columns: Record<string, unknown>;
  el_m5_passed: boolean;
  error_message: string | null;
  duration_ms: number;
  execution_logs: string[];
};

export type Node6ResolveHierarchyRequest = {
  migration_id: string;
  cleaned_tables: Record<string, unknown[]>;
  final_mappings: Node4FinalMapping[];
};

export type Node6ResolveHierarchyResponse = {
  migration_id: string;
  fk_candidates_count: number;
  confirmed_fks_count: number;
  hierarchy_cycles_count: number;
  implicit_hierarchies_count: number;
  self_referencing_trees_count: number;
  fk_candidates: unknown[];
  confirmed_hierarchies: unknown[];
  hierarchy_cycles: unknown[];
  implicit_hierarchies: Record<string, unknown>;
  containment_hierarchy: Record<string, unknown>;
  el_m6_passed: boolean;
  error_message: string | null;
  duration_ms: number;
  execution_logs: string[];
};

export type Node7VerifyHierarchyRequest = {
  migration_id: string;
  confirmed_hierarchies: unknown[];
  hierarchy_cycles: unknown[];
  customer_corrections: unknown[];
};

export type Node7VerifyHierarchyResponse = {
  migration_id: string;
  hierarchies_approved: number;
  cycles_resolved: number;
  hierarchy_confirmed: boolean;
  confirmed_hierarchies: unknown[];
  containment_hierarchy: Record<string, unknown>;
  el_m7_passed: boolean;
  error_message: string | null;
  duration_ms: number;
  execution_logs: string[];
};

export type Node8GenerateOutputRequest = {
  migration_id: string;
  final_mappings: Node4FinalMapping[];
  cleaned_tables: Record<string, unknown[]>;
  hierarchy_relationships: unknown[];
};

export type Node8GenerateOutputResponse = {
  migration_id: string;
  json_generated: boolean;
  csv_generated: boolean;
  sql_generated: boolean;
  report_generated: boolean;
  output_json_url: string | null;
  output_csv_url: string | null;
  output_sql_url: string | null;
  migration_report_url: string | null;
  intermediate_schema: Record<string, unknown>;
  intermediate_schema_valid: boolean;
  schema_validation_errors: unknown[];
  el_m8_passed: boolean;
  error_message: string | null;
  duration_ms: number;
  execution_logs: string[];
};

export type Node9WriteOutputRequest = {
  migration_id: string;
  intermediate_schema: Record<string, unknown>;
  customer_approval: boolean;
};

export type Node9WriteOutputResponse = {
  migration_id: string;
  handoff_complete: boolean;
  handoff_status: string | null;
  ingestion_service_url: string | null;
  ingestion_status: string | null;
  write_review_payload: Record<string, unknown>;
  el_m9_passed: boolean;
  error_message: string | null;
  duration_ms: number;
  execution_logs: string[];
};

export type MigrationStartUploadRequest = {
  file: File;
  cmms_name: string;
  organization_id: string;
};

export type MigrationStartUploadResponse = {
  migration_id: string;
  status: string;
  progress_pct: number;
  message: string;
};

export type MigrationGateFieldMappingDecision = {
  action: "accept" | "reject" | "override";
  source_field: string;
  target_field: string | null;
  rationale: string | null;
};

export type MigrationGateFieldMappingUnmappedDecision = {
  action: "custom" | "raw_metadata" | "skip";
  source_field: string;
  target_table: string | null;
  custom_column_name: string | null;
  data_type: string | null;
  nullable?: boolean | null;
  is_new_table?: boolean | null;
  new_table_name?: string | null;
  new_table_pk?: string | null;
};

export type MigrationGateFieldMappingRequest = {
  flagged: Record<string, MigrationGateFieldMappingDecision[]>;
  unmapped: Record<string, MigrationGateFieldMappingUnmappedDecision[]>;
};

export type MigrationFieldMappingDraftEnvelope = {
  body: MigrationGateFieldMappingRequest;
  meta?: {
    canonicalTableBySource?: Record<string, string>;
    savedAt?: number;
  };
};

export type MigrationGateHierarchyRequest = {
  confirmed_hierarchies?: unknown[];
  hierarchy_corrections?: Record<string, unknown>;
  plenum_default_hierarchy_accepted?: boolean;
};

export type MigrationGatePreSemanticRequest = {
  decisions: Record<
    string,
    Array<{ source_field: string; decision: "approve" | "semantic"; target_field?: string; data_type?: string }>
  >;
  /** WP-5: rename a source table's target / create a new table at the pre-semantic gate. */
  table_overrides?: Record<string, { target_table: string; is_new_table: boolean }>;
};

export type MigrationGateFinalRequest = {
  confirmed: boolean;
};

export type MigrationRetryDdlRequest = {
  extra_fields_config: unknown[];
};

export type MigrationStatusResponse = {
  migration_id: string;
  status: MigrationStatus;
  progress_pct: number;
  current_step: number;
  cmms_name: string;
  started_at: string | null;
  completed_at: string | null;
  t1_mapped_count: number;
  t2_auto_count: number;
  t2_human_count: number;
  unmapped_count: number;
  total_fields: number;
  output_json_url: string | null;
  output_csv_url: string | null;
  output_sql_url: string | null;
  migration_report_url: string | null;
  pending_gate_type: "pre_semantic" | "field_mapping" | "hierarchy" | "final_confirmation" | string | null;
  pending_gate_payload: MigrationGatePayload | null;
  /** Server-persisted Tier-2 / field-mapping UI draft. */
  field_mapping_draft?: MigrationFieldMappingDraftEnvelope | MigrationGateFieldMappingRequest | null;
  error_message: string | null;
  nodes: NodeInfo[];
};

export type SchemaMappingConnectorType = "fiix" | "upload";

export type SchemaMappingStartRequest = {
  connector_type: SchemaMappingConnectorType;
  external_cmms_name: string;
  organization_id: string;
  fiix_subdomain?: string;
  fiix_app_key?: string;
  fiix_access_key?: string;
  fiix_secret_key?: string;
  schema_content?: string;
  schema_source?: string;
  schema_format?: string;
};

export type SchemaMappingStartResponse = {
  schema_mapping_id: string;
  status: string;
  progress_pct?: number;
  message?: string;
};

export type SchemaComparisonSide = {
  label: string;
  table_count: number;
  column_count: number;
  canonical_field_count?: number;
};

export type SchemaComparisonPayload = {
  fiix: SchemaComparisonSide;
  plenum_cafm: SchemaComparisonSide;
  markdown?: string;
};

export type SchemaMappingStatusResponse = {
  schema_mapping_id: string;
  status: SchemaMappingStatus;
  current_node?: number;
  progress_pct?: number;
  external_cmms_name?: string;
  started_at?: string | null;
  completed_at?: string | null;
  schema_comparison?: SchemaComparisonPayload | null;
  stats?: SchemaMappingStats | null;
  pending_gate_type?: "pre_semantic" | "field_mapping" | "hierarchy" | "artifacts_review" | string | null;
  pending_gate_payload?: SchemaMappingGatePayload | null;
  output_json_url?: string | null;
  output_csv_url?: string | null;
  output_sql_url?: string | null;
  error_message?: string | null;
  nodes?: NodeInfo[];
};

// Covers both pre_semantic gate (SchemaPreSemanticDecision[]) and
// field_mapping gate (SchemaFieldMappingDecision[]) — same /gate/field-mapping endpoint
export type SchemaMappingGateFieldMappingRequest = {
  decisions: SchemaPreSemanticDecision[] | SchemaFieldMappingDecision[];
};

export type SchemaMappingGatePreSemanticRequest = {
  decisions: SchemaPreSemanticDecision[];
  /** Step-1 table routing: Fiix source table → chosen existing CAFM table. */
  table_overrides?: Record<string, string>;
  /** Step-1: Fiix source table → NEW CAFM table name to create. */
  new_tables?: Record<string, string>;
  /** Step-2: new-table columns to CREATE with explicit SQL types. */
  new_columns?: Record<
    string,
    Array<{ source_field: string; column_name: string; data_type: string }>
  >;
};

export type SchemaMappingGateHierarchyRequest = {
  approved_hierarchies: SchemaHierarchyDecision[];
  rejected_hierarchies: SchemaHierarchyDecision[];
};

export const schemaMapperApi = {
  testConnection: (platform: FiixPlatform) =>
    aiRequest<unknown>({
      method: "GET",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: `/platforms/${platform}/test-connection`,
    }),

  startSchemaMappingSession: (body: SchemaMappingStartRequest) =>
    aiRequest<SchemaMappingStartResponse, SchemaMappingStartRequest>({
      method: "POST",
      basePath: "/api/schema-mapping",
      body,
    }),

  getSchemaMappingStatus: (schemaMappingId: string) =>
    aiRequest<SchemaMappingStatusResponse>({
      method: "GET",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/status`,
    }),

  advanceSchemaMapping: (schemaMappingId: string) =>
    aiRequest<SchemaMappingStatusResponse>({
      method: "POST",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/advance`,
      body: {},
    }),

  gateSchemaMappingFieldMapping: (schemaMappingId: string, body: SchemaMappingGateFieldMappingRequest) =>
    aiRequest<SchemaMappingStatusResponse, SchemaMappingGateFieldMappingRequest>({
      method: "POST",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/gate/field-mapping`,
      body,
    }),

  gateSchemaMappingPreSemantic: (schemaMappingId: string, body: SchemaMappingGatePreSemanticRequest) =>
    aiRequest<SchemaMappingStatusResponse, SchemaMappingGatePreSemanticRequest>({
      method: "POST",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/gate/pre-semantic`,
      body,
    }),

  gateSchemaMappingHierarchy: (schemaMappingId: string, body: SchemaMappingGateHierarchyRequest) =>
    aiRequest<SchemaMappingStatusResponse, SchemaMappingGateHierarchyRequest>({
      method: "POST",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/gate/hierarchy`,
      body,
    }),

  gateSchemaMappingArtifactsReview: (schemaMappingId: string, body: SchemaMappingGateArtifactsReviewRequest) =>
    aiRequest<SchemaMappingStatusResponse, SchemaMappingGateArtifactsReviewRequest>({
      method: "POST",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/gate/artifacts-review`,
      body,
    }),

  startMigrationWithUpload: (body: MigrationStartUploadRequest) => {
    const form = new FormData();
    form.set("file", body.file);
    form.set("cmms_name", body.cmms_name);
    form.set("organization_id", body.organization_id);
    return aiRequest<MigrationStartUploadResponse, FormData>({
      method: "POST",
      basePath: "/api/migration",
      path: "/start-with-upload",
      body: form,
    });
  },

  getMigrationStatus: (migrationId: string) =>
    aiRequest<MigrationStatusResponse>({
      method: "GET",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/status`,
    }),

  gateFieldMapping: (migrationId: string, body: MigrationGateFieldMappingRequest) =>
    aiRequest<MigrationStatusResponse, MigrationGateFieldMappingRequest>({
      method: "POST",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/gate/field-mapping`,
      body,
    }),

  getFieldMappingDraft: (migrationId: string) =>
    aiRequest<{ migration_id: string; draft: MigrationFieldMappingDraftEnvelope | null }>({
      method: "GET",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/gate/field-mapping/draft`,
    }),

  putFieldMappingDraft: (migrationId: string, draft: MigrationFieldMappingDraftEnvelope) =>
    aiRequest<
      { migration_id: string; draft: MigrationFieldMappingDraftEnvelope | null },
      { draft: MigrationFieldMappingDraftEnvelope }
    >({
      method: "PUT",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/gate/field-mapping/draft`,
      body: { draft },
    }),

  canonicalFieldScores: (body: {
    source_field: string;
    field_description?: string | null;
    sample_values?: string[];
    canonical_fields: string[];
  }) =>
    aiRequest<{ scores: Record<string, number> }>({
      method: "POST",
      basePath: "/api/migration",
      path: "/canonical-field-scores",
      body,
    }),

  deleteFieldMappingDraft: (migrationId: string) =>
    aiRequest<{ migration_id: string; status: string }>({
      method: "DELETE",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/gate/field-mapping/draft`,
    }),

  gateHierarchy: (migrationId: string, body: MigrationGateHierarchyRequest) =>
    aiRequest<MigrationStatusResponse, MigrationGateHierarchyRequest>({
      method: "POST",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/gate/hierarchy`,
      body,
    }),

  gatePreSemantic: (migrationId: string, body: MigrationGatePreSemanticRequest) =>
    aiRequest<MigrationStatusResponse, MigrationGatePreSemanticRequest>({
      method: "POST",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/gate/pre-semantic`,
      body,
    }),

  gateFinal: (migrationId: string, body: MigrationGateFinalRequest) =>
    aiRequest<MigrationStatusResponse, MigrationGateFinalRequest>({
      method: "POST",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/gate/final`,
      body,
    }),

  advanceMigration: (migrationId: string) =>
    aiRequest<MigrationStatusResponse>({
      method: "POST",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/advance`,
      body: {},
    }),

  rerunMigrationFromNode: (migrationId: string, nodeNum: number) =>
    aiRequest<MigrationStatusResponse>({
      method: "POST",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/rerun-from/${nodeNum}`,
      body: {},
    }),

  retryMigrationDdl: (migrationId: string, body: MigrationRetryDdlRequest) =>
    aiRequest<MigrationStatusResponse, MigrationRetryDdlRequest>({
      method: "POST",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/retry-ddl`,
      body,
    }),

  getMigrationAudit: (migrationId: string) =>
    aiRequest<unknown>({
      method: "GET",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/audit`,
    }),

  testConnectionWithCredentials: (platform: FiixPlatform, body: FiixCredentials) =>
    aiRequest<unknown, FiixCredentials>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: `/platforms/${platform}/test-connection`,
      body,
    }),

  fetchSchema: (platform: FiixPlatform) =>
    aiRequest<unknown>({
      method: "GET",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: `/platforms/${platform}/fetch-schema`,
    }),

  testingUpload: (body: FormData) =>
    aiRequest<unknown, FormData>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/upload",
      body,
    }),

  testingIngestWithMapper: (body: FormData) =>
    aiRequest<unknown, FormData>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/ingest-with-mapper",
      body,
    }),

  testingIngestWithSemantic: (body: FormData) =>
    aiRequest<unknown, FormData>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/ingest-with-semantic",
      body,
    }),

  testingHumanReview: <TBody = unknown>(body: TBody) =>
    aiRequest<unknown, TBody>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/human-review",
      body,
    }),

  testingHumanReviewNode4: (body: Node4HumanReviewRequest) =>
    aiRequest<Node4HumanReviewResponse, Node4HumanReviewRequest>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/human-review",
      body,
    }),

  testingPreprocess: <TBody = unknown>(body: TBody) =>
    aiRequest<unknown, TBody>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/preprocess",
      body,
    }),

  testingPreprocessNode5: (body: Node5PreprocessRequest) =>
    aiRequest<Node5PreprocessResponse, Node5PreprocessRequest>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/preprocess",
      body,
    }),

  testingResolveHierarchy: <TBody = unknown>(body: TBody) =>
    aiRequest<unknown, TBody>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/resolve-hierarchy",
      body,
    }),

  testingResolveHierarchyNode6: (body: Node6ResolveHierarchyRequest) =>
    aiRequest<Node6ResolveHierarchyResponse, Node6ResolveHierarchyRequest>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/resolve-hierarchy",
      body,
    }),

  testingVerifyHierarchy: <TBody = unknown>(body: TBody) =>
    aiRequest<unknown, TBody>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/verify-hierarchy",
      body,
    }),

  testingVerifyHierarchyNode7: (body: Node7VerifyHierarchyRequest) =>
    aiRequest<Node7VerifyHierarchyResponse, Node7VerifyHierarchyRequest>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/verify-hierarchy",
      body,
    }),

  testingGenerateOutput: <TBody = unknown>(body: TBody) =>
    aiRequest<unknown, TBody>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/generate-output",
      body,
    }),

  testingGenerateOutputNode8: (body: Node8GenerateOutputRequest) =>
    aiRequest<Node8GenerateOutputResponse, Node8GenerateOutputRequest>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/generate-output",
      body,
    }),

  testingWriteOutput: <TBody = unknown>(body: TBody) =>
    aiRequest<unknown, TBody>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/write-output",
      body,
    }),

  testingWriteOutputNode9: (body: Node9WriteOutputRequest) =>
    aiRequest<Node9WriteOutputResponse, Node9WriteOutputRequest>({
      method: "POST",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: "/testing/write-output",
      body,
    }),

  testingArtifactsByMigrationId: (migrationId: string) =>
    aiRequest<unknown>({
      method: "GET",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: `/testing/artifacts/${encodeURIComponent(migrationId)}`,
    }),

  testingDownloadArtifact: (params: TestingArtifactParams) =>
    aiRequest<string>({
      method: "GET",
      basePath: SCHEMA_MAPPER_API_BASE_PATH,
      path: `/testing/artifacts/${encodeURIComponent(params.migrationId)}/${encodeURIComponent(params.filename)}`,
    }),

  // ── Migration: list / delete / read-only ────────────────────────────────────

  listMigrations: (params: ListMigrationsParams = {}) =>
    aiRequest<MigrationListResponse>({
      method: "GET",
      basePath: "/api/migration",
      query: {
        organization_id: params.organization_id,
        status: params.status,
        limit: params.limit,
        offset: params.offset,
      },
    }),

  deleteMigration: (migrationId: string) =>
    aiRequest<{ status: string; message: string }>({
      method: "DELETE",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}`,
    }),

  getMigrationMappings: (migrationId: string, tier?: string) =>
    aiRequest<MappingListResponse>({
      method: "GET",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/mappings`,
      query: { tier },
    }),

  getMigrationHierarchy: (migrationId: string) =>
    aiRequest<unknown>({
      method: "GET",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/hierarchy`,
    }),

  getMigrationDownload: (migrationId: string, format: MigrationDownloadFormat) =>
    aiRequest<MigrationDownloadResponse>({
      method: "GET",
      basePath: "/api/migration",
      path: `/${encodeURIComponent(migrationId)}/download/${encodeURIComponent(format)}`,
    }),

  // ── Schema Mapping: list / delete / read-only ────────────────────────────────

  listSchemaMappings: (params: ListSchemaMappingsParams = {}) =>
    aiRequest<SchemaMappingListResponse>({
      method: "GET",
      basePath: "/api/schema-mapping",
      query: {
        organization_id: params.organization_id,
        status: params.status,
        limit: params.limit,
        offset: params.offset,
      },
    }),

  deleteSchemaMapping: (schemaMappingId: string) =>
    aiRequest<{ status: string; message: string }>({
      method: "DELETE",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}`,
    }),

  getSchemaMappings: (schemaMappingId: string, tier?: string) =>
    aiRequest<MappingListResponse>({
      method: "GET",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/mappings`,
      query: { tier },
    }),

  getSchemaUnmapped: (schemaMappingId: string) =>
    aiRequest<SchemaUnmappedResponse>({
      method: "GET",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/unmapped`,
    }),

  getSchemaMappingAuditTrail: (schemaMappingId: string) =>
    aiRequest<MappingListResponse | SchemaAuditEntry[]>({
      method: "GET",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/audit-trail`,
    }),

  submitSchemaCustomMapping: (schemaMappingId: string, body: SchemaCustomMappingRequest) =>
    aiRequest<SchemaCustomMappingResponse, SchemaCustomMappingRequest>({
      method: "POST",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/custom-mapping`,
      body,
    }),

  retrySchemaMappingDdl: (schemaMappingId: string, body: { extra_fields_config: ExtraFieldConfig[] }) =>
    aiRequest<SchemaMappingStatusResponse, { extra_fields_config: ExtraFieldConfig[] }>({
      method: "POST",
      basePath: "/api/schema-mapping",
      path: `/${encodeURIComponent(schemaMappingId)}/retry-ddl`,
      body,
    }),
};

export function useSchemaMapperTestConnection(
  mutationOptions?: UseMutationOptions<unknown, unknown, { platform: FiixPlatform }>,
) {
  return useMutation<unknown, unknown, { platform: FiixPlatform }>({
    mutationFn: ({ platform }) => schemaMapperApi.testConnection(platform),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestConnectionWithCredentials(
  mutationOptions?: UseMutationOptions<unknown, unknown, { platform: FiixPlatform; body: FiixCredentials }>,
) {
  return useMutation<unknown, unknown, { platform: FiixPlatform; body: FiixCredentials }>({
    mutationFn: ({ platform, body }) => schemaMapperApi.testConnectionWithCredentials(platform, body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperFetchSchema(
  opts: { platform: FiixPlatform; enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<unknown, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<unknown, unknown>({
    queryKey: ["schema-mapper", "fetch-schema", opts.platform],
    enabled: opts.enabled ?? true,
    queryFn: ({ signal }) =>
      aiRequest<unknown>({
        method: "GET",
        basePath: SCHEMA_MAPPER_API_BASE_PATH,
        path: `/platforms/${opts.platform}/fetch-schema`,
        signal,
      }),
    ...(queryOptions ?? {}),
  });
}

export function useSchemaMapperTestingUpload(
  mutationOptions?: UseMutationOptions<unknown, unknown, FormData>,
) {
  return useMutation<unknown, unknown, FormData>({
    mutationFn: (body) => schemaMapperApi.testingUpload(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingIngestWithMapper(
  mutationOptions?: UseMutationOptions<unknown, unknown, FormData>,
) {
  return useMutation<unknown, unknown, FormData>({
    mutationFn: (body) => schemaMapperApi.testingIngestWithMapper(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingIngestWithSemantic(
  mutationOptions?: UseMutationOptions<unknown, unknown, FormData>,
) {
  return useMutation<unknown, unknown, FormData>({
    mutationFn: (body) => schemaMapperApi.testingIngestWithSemantic(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingHumanReview<TBody = unknown>(
  mutationOptions?: UseMutationOptions<unknown, unknown, TBody>,
) {
  return useMutation<unknown, unknown, TBody>({
    mutationFn: (body) => schemaMapperApi.testingHumanReview<TBody>(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingHumanReviewNode4(
  mutationOptions?: UseMutationOptions<Node4HumanReviewResponse, unknown, Node4HumanReviewRequest>,
) {
  return useMutation<Node4HumanReviewResponse, unknown, Node4HumanReviewRequest>({
    mutationFn: (body) => schemaMapperApi.testingHumanReviewNode4(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingPreprocess<TBody = unknown>(
  mutationOptions?: UseMutationOptions<unknown, unknown, TBody>,
) {
  return useMutation<unknown, unknown, TBody>({
    mutationFn: (body) => schemaMapperApi.testingPreprocess<TBody>(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingPreprocessNode5(
  mutationOptions?: UseMutationOptions<Node5PreprocessResponse, unknown, Node5PreprocessRequest>,
) {
  return useMutation<Node5PreprocessResponse, unknown, Node5PreprocessRequest>({
    mutationFn: (body) => schemaMapperApi.testingPreprocessNode5(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingResolveHierarchy<TBody = unknown>(
  mutationOptions?: UseMutationOptions<unknown, unknown, TBody>,
) {
  return useMutation<unknown, unknown, TBody>({
    mutationFn: (body) => schemaMapperApi.testingResolveHierarchy<TBody>(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingResolveHierarchyNode6(
  mutationOptions?: UseMutationOptions<Node6ResolveHierarchyResponse, unknown, Node6ResolveHierarchyRequest>,
) {
  return useMutation<Node6ResolveHierarchyResponse, unknown, Node6ResolveHierarchyRequest>({
    mutationFn: (body) => schemaMapperApi.testingResolveHierarchyNode6(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingVerifyHierarchy<TBody = unknown>(
  mutationOptions?: UseMutationOptions<unknown, unknown, TBody>,
) {
  return useMutation<unknown, unknown, TBody>({
    mutationFn: (body) => schemaMapperApi.testingVerifyHierarchy<TBody>(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingVerifyHierarchyNode7(
  mutationOptions?: UseMutationOptions<Node7VerifyHierarchyResponse, unknown, Node7VerifyHierarchyRequest>,
) {
  return useMutation<Node7VerifyHierarchyResponse, unknown, Node7VerifyHierarchyRequest>({
    mutationFn: (body) => schemaMapperApi.testingVerifyHierarchyNode7(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingGenerateOutput<TBody = unknown>(
  mutationOptions?: UseMutationOptions<unknown, unknown, TBody>,
) {
  return useMutation<unknown, unknown, TBody>({
    mutationFn: (body) => schemaMapperApi.testingGenerateOutput<TBody>(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingGenerateOutputNode8(
  mutationOptions?: UseMutationOptions<Node8GenerateOutputResponse, unknown, Node8GenerateOutputRequest>,
) {
  return useMutation<Node8GenerateOutputResponse, unknown, Node8GenerateOutputRequest>({
    mutationFn: (body) => schemaMapperApi.testingGenerateOutputNode8(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingWriteOutput<TBody = unknown>(
  mutationOptions?: UseMutationOptions<unknown, unknown, TBody>,
) {
  return useMutation<unknown, unknown, TBody>({
    mutationFn: (body) => schemaMapperApi.testingWriteOutput<TBody>(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingWriteOutputNode9(
  mutationOptions?: UseMutationOptions<Node9WriteOutputResponse, unknown, Node9WriteOutputRequest>,
) {
  return useMutation<Node9WriteOutputResponse, unknown, Node9WriteOutputRequest>({
    mutationFn: (body) => schemaMapperApi.testingWriteOutputNode9(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMapperTestingDownloadArtifact(
  opts: { migrationId: string; filename: string; enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<string, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<string, unknown>({
    queryKey: ["schema-mapper", "testing", "artifact", opts.migrationId, opts.filename],
    enabled: opts.enabled ?? true,
    queryFn: ({ signal }) =>
      aiRequest<string>({
        method: "GET",
        basePath: SCHEMA_MAPPER_API_BASE_PATH,
        path: `/testing/artifacts/${encodeURIComponent(opts.migrationId)}/${encodeURIComponent(opts.filename)}`,
        signal,
      }),
    ...(queryOptions ?? {}),
  });
}

export function useAiQuery<TResponse = unknown>(
  key: unknown[],
  opts: Omit<AiRequestOptions<never>, "method" | "body"> & { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<TResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<TResponse, unknown>({
    queryKey: key,
    enabled: opts.enabled ?? true,
    queryFn: ({ signal }) => aiRequest<TResponse>({ ...opts, method: "GET", signal }),
    ...(queryOptions ?? {}),
  });
}

export function useAiMutation<TResponse = unknown, TBody = unknown>(
  mutationOptions?: UseMutationOptions<TResponse, unknown, AiRequestOptions<TBody>>,
) {
  return useMutation<TResponse, unknown, AiRequestOptions<TBody>>({
    mutationFn: (opts) => aiRequest<TResponse, TBody>(opts),
    ...(mutationOptions ?? {}),
  });
}

export function useMigrationStartUpload(
  mutationOptions?: UseMutationOptions<MigrationStartUploadResponse, unknown, MigrationStartUploadRequest>,
) {
  return useMutation<MigrationStartUploadResponse, unknown, MigrationStartUploadRequest>({
    mutationFn: (body) => schemaMapperApi.startMigrationWithUpload(body),
    ...(mutationOptions ?? {}),
  });
}

function shouldPauseMigrationPollingForImplicitGate(data: MigrationStatusResponse | undefined) {
  if (!data) return false;
  const st = typeof data.status === "string" ? data.status.toLowerCase() : "";
  if (st !== "running") return false;
  if (data.pending_gate_type || data.pending_gate_payload) return false;
  // Keep polling through pre-semantic / semantic stages until awaiting_review gate is written.
  if (typeof data.current_step === "number" && data.current_step > 0 && data.current_step < 5) {
    return false;
  }

  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  if (!nodes.length) return false;

  const hasActiveGateNode = nodes.some((n) => {
    const name = String(n.node_name ?? "").toLowerCase();
    const nodeStatus = String(n.status ?? "").toLowerCase();
    const isGateName = name.includes("gate") || name.includes("review");
    const isNotCompleted =
      nodeStatus === "running" ||
      nodeStatus === "pending" ||
      (n.started_at != null && n.completed_at == null);
    return isGateName && isNotCompleted;
  });
  if (!hasActiveGateNode) return false;

  const hasReviewSignals = nodes.some((n) =>
    (n.logs ?? []).some((line) => {
      const s = String(line).toLowerCase();
      return (
        s.includes("no matches for") ||
        s.includes("unmappable") ||
        s.includes("unresolved") ||
        s.includes("human review") ||
        s.includes("table structure")
      );
    }),
  );

  const progressedToGateStage =
    (typeof data.current_step === "number" && data.current_step >= 5) ||
    nodes.some((n) => {
      const nodeStatus = String(n.status ?? "").toLowerCase();
      const isCompleted = nodeStatus === "complete" || nodeStatus === "completed" || nodeStatus === "done";
      return n.node_id >= 4 && isCompleted;
    }) ||
    nodes.some((n) => {
      const name = String(n.node_name ?? "").toLowerCase();
      const isGateName = name.includes("gate") || name.includes("review");
      return isGateName && (!!n.output || (n.logs?.length ?? 0) > 0);
    });

  if (!progressedToGateStage) return false;
  return hasActiveGateNode || hasReviewSignals;
}

export function useMigrationStatus(
  migrationId: string,
  opts?: {
    enabled?: boolean;
    refetchInterval?: number;
    forceUntil?: number;
    /** Orchestrator rail — never stop polling while status is running (until gate/step_paused). */
    keepPollingWhileRunning?: boolean;
  },
  queryOptions?: Omit<UseQueryOptions<MigrationStatusResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<MigrationStatusResponse, unknown>({
    queryKey: ["migration", "status", migrationId],
    enabled: opts?.enabled ?? true,
    queryFn: () => schemaMapperApi.getMigrationStatus(migrationId),
    refetchInterval: (q) => {
      const d = q.state.data as MigrationStatusResponse | undefined;
      const st = typeof d?.status === "string" ? d.status.toLowerCase() : "";
      const shouldForce = typeof opts?.forceUntil === "number" && Date.now() < opts.forceUntil;
      if (
        st === "complete" ||
        st === "error" ||
        st === "failed" ||
        st === "ddl_failed" ||
        st === "cancelled" ||
        st === "canceled"
      )
        return false;
      // Backend can emit step_5_preprocess (or running+preprocess payload) before field_mapping gate is ready.
      if (shouldKeepPollingForFieldMappingGate(d)) return opts?.refetchInterval ?? 2000;
      if (st === "step_paused" && !shouldKeepPollingForFieldMappingGate(d)) {
        if (shouldForce) return opts?.refetchInterval ?? 2000;
        return false;
      }
      if (st === "awaiting_review") {
        const pending = String(d?.pending_gate_type ?? "").toLowerCase();
        const readyForFieldMappingSubmit =
          pending === "field_mapping" ||
          (pending.includes("field") && pending.includes("map")) ||
          (pending.includes("human") && pending.includes("review"));
        if (!readyForFieldMappingSubmit) return opts?.refetchInterval ?? 2000;
        return false;
      }
      if ((st.includes("paused") || st.includes("review")) && !shouldKeepPollingForFieldMappingGate(d)) return false;
      if (
        !shouldForce &&
        !opts?.keepPollingWhileRunning &&
        shouldPauseMigrationPollingForImplicitGate(d)
      ) {
        return false;
      }
      return opts?.refetchInterval ?? 2000;
    },
    ...(queryOptions ?? {}),
  });
}

export function useSchemaMappingStart(
  mutationOptions?: UseMutationOptions<SchemaMappingStartResponse, unknown, SchemaMappingStartRequest>,
) {
  return useMutation<SchemaMappingStartResponse, unknown, SchemaMappingStartRequest>({
    mutationFn: (body) => schemaMapperApi.startSchemaMappingSession(body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMappingStatus(
  schemaMappingId: string,
  opts?: { enabled?: boolean; refetchInterval?: number; forceUntil?: number },
  queryOptions?: Omit<UseQueryOptions<SchemaMappingStatusResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  const baseInterval = opts?.refetchInterval ?? 3000;
  return useQuery<SchemaMappingStatusResponse, unknown>({
    queryKey: ["schema-mapping", "status", schemaMappingId],
    enabled: opts?.enabled ?? true,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: () => schemaMapperApi.getSchemaMappingStatus(schemaMappingId),
    refetchInterval: (q) => {
      const d = q.state.data as SchemaMappingStatusResponse | undefined;
      if (!schemaMappingStatusNeedsPoll(d, { forceUntil: opts?.forceUntil })) return false;
      return schemaMappingPollIntervalMs(d, baseInterval);
    },
    ...(queryOptions ?? {}),
  });
}

export function useSchemaMappingAdvance(
  mutationOptions?: UseMutationOptions<SchemaMappingStatusResponse, unknown, { schemaMappingId: string }>,
) {
  return useMutation<SchemaMappingStatusResponse, unknown, { schemaMappingId: string }>({
    mutationFn: ({ schemaMappingId }) => schemaMapperApi.advanceSchemaMapping(schemaMappingId),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMappingGateFieldMapping(
  mutationOptions?: UseMutationOptions<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGateFieldMappingRequest }
  >,
) {
  return useMutation<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGateFieldMappingRequest }
  >({
    mutationFn: ({ schemaMappingId, body }) => schemaMapperApi.gateSchemaMappingFieldMapping(schemaMappingId, body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMappingGatePreSemantic(
  mutationOptions?: UseMutationOptions<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGatePreSemanticRequest }
  >,
) {
  return useMutation<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGatePreSemanticRequest }
  >({
    mutationFn: async ({ schemaMappingId, body }) => {
      try {
        return await schemaMapperApi.gateSchemaMappingPreSemantic(schemaMappingId, body);
      } catch (e: unknown) {
        if (e instanceof AiApiError && (e.status === 404 || e.status === 405)) {
          return schemaMapperApi.gateSchemaMappingFieldMapping(schemaMappingId, body);
        }
        throw e;
      }
    },
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMappingGateHierarchy(
  mutationOptions?: UseMutationOptions<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGateHierarchyRequest }
  >,
) {
  return useMutation<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGateHierarchyRequest }
  >({
    mutationFn: ({ schemaMappingId, body }) => schemaMapperApi.gateSchemaMappingHierarchy(schemaMappingId, body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMappingGateArtifactsReview(
  mutationOptions?: UseMutationOptions<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGateArtifactsReviewRequest }
  >,
) {
  return useMutation<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: SchemaMappingGateArtifactsReviewRequest }
  >({
    mutationFn: ({ schemaMappingId, body }) => schemaMapperApi.gateSchemaMappingArtifactsReview(schemaMappingId, body),
    ...(mutationOptions ?? {}),
  });
}

export function useMigrationAdvance(
  mutationOptions?: UseMutationOptions<MigrationStatusResponse, unknown, { migrationId: string }>,
) {
  return useMutation<MigrationStatusResponse, unknown, { migrationId: string }>({
    mutationFn: ({ migrationId }) => schemaMapperApi.advanceMigration(migrationId),
    ...(mutationOptions ?? {}),
  });
}

export function useMigrationGatePreSemantic(
  mutationOptions?: UseMutationOptions<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGatePreSemanticRequest }
  >,
) {
  return useMutation<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGatePreSemanticRequest }
  >({
    mutationFn: ({ migrationId, body }) => schemaMapperApi.gatePreSemantic(migrationId, body),
    ...(mutationOptions ?? {}),
  });
}

export function useMigrationGateFieldMapping(
  mutationOptions?: UseMutationOptions<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGateFieldMappingRequest }
  >,
) {
  return useMutation<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGateFieldMappingRequest }
  >({
    mutationFn: ({ migrationId, body }) => schemaMapperApi.gateFieldMapping(migrationId, body),
    ...(mutationOptions ?? {}),
  });
}

export function useMigrationGateHierarchy(
  mutationOptions?: UseMutationOptions<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGateHierarchyRequest }
  >,
) {
  return useMutation<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGateHierarchyRequest }
  >({
    mutationFn: ({ migrationId, body }) => schemaMapperApi.gateHierarchy(migrationId, body),
    ...(mutationOptions ?? {}),
  });
}

export function useMigrationGateFinal(
  mutationOptions?: UseMutationOptions<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGateFinalRequest }
  >,
) {
  return useMutation<
    MigrationStatusResponse,
    unknown,
    { migrationId: string; body: MigrationGateFinalRequest }
  >({
    mutationFn: ({ migrationId, body }) => schemaMapperApi.gateFinal(migrationId, body),
    ...(mutationOptions ?? {}),
  });
}

// ── Migration: list / delete / read-only hooks ────────────────────────────────

export function useMigrations(
  params?: ListMigrationsParams,
  queryOptions?: Omit<UseQueryOptions<MigrationListResponse, unknown>, "queryKey" | "queryFn">,
) {
  return useQuery<MigrationListResponse, unknown>({
    queryKey: ["migrations", params],
    queryFn: () => schemaMapperApi.listMigrations(params),
    ...(queryOptions ?? {}),
  });
}

export function useDeleteMigration(
  mutationOptions?: UseMutationOptions<{ status: string; message: string }, unknown, { migrationId: string }>,
) {
  return useMutation<{ status: string; message: string }, unknown, { migrationId: string }>({
    mutationFn: ({ migrationId }) => schemaMapperApi.deleteMigration(migrationId),
    ...(mutationOptions ?? {}),
  });
}

export function useMigrationMappings(
  migrationId: string,
  opts?: { tier?: string; enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<MappingListResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<MappingListResponse, unknown>({
    queryKey: ["migration", "mappings", migrationId, opts?.tier],
    enabled: opts?.enabled ?? true,
    queryFn: () => schemaMapperApi.getMigrationMappings(migrationId, opts?.tier),
    ...(queryOptions ?? {}),
  });
}

export function useMigrationHierarchy(
  migrationId: string,
  opts?: { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<unknown, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<unknown, unknown>({
    queryKey: ["migration", "hierarchy", migrationId],
    enabled: opts?.enabled ?? true,
    queryFn: () => schemaMapperApi.getMigrationHierarchy(migrationId),
    ...(queryOptions ?? {}),
  });
}

export function useMigrationDownload(
  migrationId: string,
  format: MigrationDownloadFormat,
  opts?: { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<MigrationDownloadResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<MigrationDownloadResponse, unknown>({
    queryKey: ["migration", "download", migrationId, format],
    enabled: opts?.enabled ?? false,
    queryFn: () => schemaMapperApi.getMigrationDownload(migrationId, format),
    ...(queryOptions ?? {}),
  });
}

export function useMigrationRetryDdl(
  mutationOptions?: UseMutationOptions<MigrationStatusResponse, unknown, { migrationId: string; body: MigrationRetryDdlRequest }>,
) {
  return useMutation<MigrationStatusResponse, unknown, { migrationId: string; body: MigrationRetryDdlRequest }>({
    mutationFn: ({ migrationId, body }) => schemaMapperApi.retryMigrationDdl(migrationId, body),
    ...(mutationOptions ?? {}),
  });
}

// ── Schema Mapping: list / delete / read-only hooks ───────────────────────────

export function useSchemaMappingsList(
  params?: ListSchemaMappingsParams,
  queryOptions?: Omit<UseQueryOptions<SchemaMappingListResponse, unknown>, "queryKey" | "queryFn">,
) {
  return useQuery<SchemaMappingListResponse, unknown>({
    queryKey: ["schema-mappings", params],
    queryFn: () => schemaMapperApi.listSchemaMappings(params),
    ...(queryOptions ?? {}),
  });
}

export function useDeleteSchemaMapping(
  mutationOptions?: UseMutationOptions<{ status: string; message: string }, unknown, { schemaMappingId: string }>,
) {
  return useMutation<{ status: string; message: string }, unknown, { schemaMappingId: string }>({
    mutationFn: ({ schemaMappingId }) => schemaMapperApi.deleteSchemaMapping(schemaMappingId),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMappingMappings(
  schemaMappingId: string,
  opts?: { tier?: string; enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<MappingListResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<MappingListResponse, unknown>({
    queryKey: ["schema-mapping", "mappings", schemaMappingId, opts?.tier],
    enabled: opts?.enabled ?? true,
    queryFn: () => schemaMapperApi.getSchemaMappings(schemaMappingId, opts?.tier),
    ...(queryOptions ?? {}),
  });
}

export function useSchemaMappingUnmapped(
  schemaMappingId: string,
  opts?: { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<SchemaUnmappedResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<SchemaUnmappedResponse, unknown>({
    queryKey: ["schema-mapping", "unmapped", schemaMappingId],
    enabled: opts?.enabled ?? true,
    queryFn: () => schemaMapperApi.getSchemaUnmapped(schemaMappingId),
    ...(queryOptions ?? {}),
  });
}

export function useSchemaMappingAuditTrail(
  schemaMappingId: string,
  opts?: { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<MappingListResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<MappingListResponse, unknown>({
    queryKey: ["schema-mapping", "audit-trail", schemaMappingId],
    enabled: opts?.enabled ?? true,
    queryFn: async () => {
      const raw = await schemaMapperApi.getSchemaMappingAuditTrail(schemaMappingId);
      if (Array.isArray(raw)) {
        return { mappings: raw as unknown as MappingRecord[], total_mappings: raw.length, tier_breakdown: {} };
      }
      if (raw && typeof raw === "object" && "mappings" in raw) {
        return raw as MappingListResponse;
      }
      return { mappings: [], total_mappings: 0, tier_breakdown: {} };
    },
    ...(queryOptions ?? {}),
  });
}

export function useSchemaMappingCustomMapping(
  mutationOptions?: UseMutationOptions<
    SchemaCustomMappingResponse,
    unknown,
    { schemaMappingId: string; body: SchemaCustomMappingRequest }
  >,
) {
  return useMutation<SchemaCustomMappingResponse, unknown, { schemaMappingId: string; body: SchemaCustomMappingRequest }>({
    mutationFn: ({ schemaMappingId, body }) => schemaMapperApi.submitSchemaCustomMapping(schemaMappingId, body),
    ...(mutationOptions ?? {}),
  });
}

export function useSchemaMappingRetryDdl(
  mutationOptions?: UseMutationOptions<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: { extra_fields_config: ExtraFieldConfig[] } }
  >,
) {
  return useMutation<
    SchemaMappingStatusResponse,
    unknown,
    { schemaMappingId: string; body: { extra_fields_config: ExtraFieldConfig[] } }
  >({
    mutationFn: ({ schemaMappingId, body }) => schemaMapperApi.retrySchemaMappingDdl(schemaMappingId, body),
    ...(mutationOptions ?? {}),
  });
}

// ── Fiix Data Ingestion ───────────────────────────────────────────────────────

export type FiixIngestionStartRequest = {
  organization_id?: string;
  created_by?: string;
  schema_mapping_id?: string | null;
};

export type FiixIngestionStartResponse = {
  ingestion_id: string;
  status: string;
  schema_mapping_id?: string | null;
  message?: string;
};

export type FiixIngestionStatus =
  | "pending"
  | "fetching"
  | "preprocessing"
  | "writing"
  | "complete"
  | "failed";

export type FiixIngestionStatusResponse = {
  ingestion_id: string;
  organization_id?: string;
  created_by?: string;
  status: FiixIngestionStatus;
  current_step?: string | null;
  progress_pct?: number | null;
  // Node 1 — Fetch
  total_records_fetched?: number | null;
  fetch_stats?: Record<string, number> | null;
  fetch_errors?: string[] | null;
  // Node 2 — Preprocess
  total_records_preprocessed?: number | null;
  preprocess_stats?: Record<string, unknown> | null;
  // Node 3 — Write
  total_records_written?: number | null;
  write_results?: Record<string, { inserted: number; skipped: number; errors: number }> | null;
  write_errors?: string[] | null;
  // Meta
  error_message?: string | null;
  error_node?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
};

const fiixIngestionApi = {
  start: (body: FiixIngestionStartRequest) =>
    aiRequest<FiixIngestionStartResponse>({
      method: "POST",
      basePath: "/api/fiix-ingestion",
      path: "",
      query: {
        // Backend rejects non-UUID org ids (e.g. numeric "1"); resolve org from schema_mapping_id instead.
        ...(body.organization_id && isUuid(body.organization_id)
          ? { organization_id: body.organization_id }
          : {}),
        created_by: body.created_by ?? "system",
        ...(body.schema_mapping_id ? { schema_mapping_id: body.schema_mapping_id } : {}),
      },
    }),

  getStatus: (ingestionId: string) =>
    aiRequest<FiixIngestionStatusResponse>({
      method: "GET",
      basePath: "/api/fiix-ingestion",
      path: `/${encodeURIComponent(ingestionId)}`,
    }),
};

export function useFiixIngestionStart(
  mutationOptions?: UseMutationOptions<FiixIngestionStartResponse, unknown, FiixIngestionStartRequest>,
) {
  return useMutation<FiixIngestionStartResponse, unknown, FiixIngestionStartRequest>({
    mutationFn: (body) => fiixIngestionApi.start(body),
    ...(mutationOptions ?? {}),
  });
}

export function useFiixIngestionStatus(
  ingestionId: string,
  opts?: { enabled?: boolean; refetchInterval?: number },
) {
  const baseInterval = opts?.refetchInterval ?? 3000;
  return useQuery<FiixIngestionStatusResponse, unknown>({
    queryKey: ["fiix-ingestion", "status", ingestionId],
    enabled: opts?.enabled ?? true,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: () => fiixIngestionApi.getStatus(ingestionId),
    refetchInterval: (q) => {
      const st = (q.state.data as FiixIngestionStatusResponse | undefined)?.status ?? "";
      if (st === "complete" || st === "failed") return false;
      return baseInterval;
    },
  });
}
