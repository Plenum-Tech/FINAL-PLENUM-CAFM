"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader, XCircle, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import type {
  MigrationStatusResponse,
  MigrationPreSemanticGatePayload,
  MigrationGateFieldMappingRequest,
  MigrationFlaggedFieldItem,
  MigrationFieldMappingGatePayload,
  MigrationHierarchyGatePayload,
  MigrationFinalGatePayload,
  NodeInfo,
} from "../../chat-api";
import { schemaMapperApi, useMigrationAdvance, useMigrationGateFinal } from "../../chat-api";
import type { DeepAgentProcessLogInput } from "../deep-agent/deep-agent-process-log";
import ResultsPanel from "./results-panel";
import StepPause from "./step-pause";
import { MigrationStepSnapshot } from "./step-pause";
import SemanticMappingStep from "./semantic-mapping-step";
import GatePreSemantic from "./gates/gate-pre-semantic";
import GateFieldMapping from "./gates/gate-field-mapping";
import GateHierarchy from "./gates/gate-hierarchy";
import GateFinal from "./gates/gate-final";
import {
  buildFieldMappingPayloadFromMigration,
  countFieldMappingReviewItems,
  fieldMappingSubmitBlockedReason,
  findSemanticMappingNode,
  isFieldMappingPayload as isFieldMappingGatePayload,
  needsSemanticReviewBeforeFieldMapping,
  resolveFieldMappingGateControls,
  isPreSemanticPayload,
  isPreSemanticGatePending,
  resolvePreSemanticGatePayload,
  isPrematurePreprocessPoll,
  isPreprocessPausePayload,
  isPipelinePastFieldMappingGate,
  isPreprocessStepPauseKey,
  isSemanticMappingPausePayload,
  isSemanticMappingStepKey,
  isStepPauseBlockingFieldMapping,
  normalizeMigrationGateType,
  requiresFieldMappingLatch,
  requiresSemanticMappingLatch,
} from "./migration-gate-state";
import {
  isSemanticDismissed,
  markSemanticDismissed,
  applyTier2FieldMappingContinue,
  clearFieldMappingDraft,
  clearSemanticDismissed,
} from "./migration-field-mapping-draft";
import { useFieldMappingDraft } from "./use-field-mapping-draft";

interface Props {
  migration: MigrationStatusResponse | null | undefined;
  migrationId: string;
  onRefresh: () => void;
  onReset: () => void;
  showCompletedHistory?: boolean;
  /** Collapse the completed-steps history by default — set when viewing an OLDER saved
   *  version so the live run shows all its steps while old versions stay tucked away. */
  collapseCompletedHistory?: boolean;
  onFieldFocus?: (terms: string[], nodeId?: number) => void;
  /** Orchestrator right rail — compact semantic / gate layout. */
  embeddedRail?: boolean;
  /** Auto-call /advance on non-HITL step_paused (mirrors run_migration in single-door). */
  drivePipelineSteps?: boolean;
  /** Emit per-node field-mapping entries into the right-side Process log. */
  onProcessLog?: (entry: DeepAgentProcessLogInput) => void;
  /**
   * Set when the user picked a saved version from the dropdown. Snapshots are
   * read from a version-scoped sessionStorage key and writes are suppressed,
   * so reviewing a saved version doesn't trample the live run's storage. When
   * undefined, the component operates on the live (migrationId-scoped) keys.
   */
  viewingVersionId?: string;
}

/** step_paused keys that run_migration advances without a human StepPause screen. */
const ORCHESTRATOR_AUTO_ADVANCE_STEPS = new Set([
  "step_1_ingest",
  "step_2_deterministic",
  "step_2_deterministic_mapping",
  "step_7_hierarchy",
  "step_7_hierarchy_detection",
  "step_9_output",
  "step_9_output_generation",
  "step_9_write",
]);

function shouldOrchestratorAutoAdvanceStep(
  stepKey: string,
  semanticMappingDismissed: boolean,
): boolean {
  if (ORCHESTRATOR_AUTO_ADVANCE_STEPS.has(stepKey)) return true;
  const normalized = STEP_KEY_ALIASES[stepKey] ?? stepKey;
  if (ORCHESTRATOR_AUTO_ADVANCE_STEPS.has(normalized)) return true;
  if (
    semanticMappingDismissed &&
    (stepKey.includes("semantic") || normalized === "step_4_semantic")
  ) {
    return true;
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function valuePreview(v: unknown) {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `${v.length} items`;
  if (isRecord(v)) return `${Object.keys(v).length} fields`;
  return String(v);
}

function payloadRichnessScore(input: unknown, depth = 0): number {
  if (input == null) return 0;
  if (depth > 4) return 1;
  if (Array.isArray(input)) {
    const items = input.slice(0, 50);
    return 1 + items.reduce((sum, item) => sum + payloadRichnessScore(item, depth + 1), 0);
  }
  if (isRecord(input)) {
    const keys = Object.keys(input);
    return keys.length + keys.slice(0, 50).reduce((sum, key) => sum + payloadRichnessScore(input[key], depth + 1), 0);
  }
  if (typeof input === "string") return input.length > 0 ? 1 : 0;
  return 1;
}

function GatePayloadViewer({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isPrimitive(value)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-slate-100 text-slate-700">
        {value === null ? "null" : String(value)}
      </span>
    );
  }

  if (Array.isArray(value)) {
    const shown = value.slice(0, 30);
    return (
      <details className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-50">
          {valuePreview(value)}
        </summary>
        <div className="px-3 py-2 space-y-2">
          {shown.length === 0 ? (
            <div className="text-xs text-slate-500">Empty</div>
          ) : (
            shown.map((it, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-[11px] font-mono text-slate-400 w-10 shrink-0 text-right">[{idx}]</span>
                <div className="min-w-0 flex-1">
                  <GatePayloadViewer value={it} depth={depth + 1} />
                </div>
              </div>
            ))
          )}
          {value.length > shown.length ? (
            <div className="text-[11px] text-slate-400">Showing first {shown.length} items</div>
          ) : null}
        </div>
      </details>
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, 50);
    return (
      <div className="space-y-2">
        {entries.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[140px_1fr] gap-3 items-start">
            <div className="text-xs font-semibold text-slate-600 truncate">{k.replace(/_/g, " ")}</div>
            <div className="min-w-0">
              {isPrimitive(v) ? (
                <GatePayloadViewer value={v} depth={depth + 1} />
              ) : (
                <details className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">
                    {valuePreview(v)}
                  </summary>
                  <div className="px-3 py-2">
                    <GatePayloadViewer value={v} depth={depth + 1} />
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-slate-100 text-slate-700">
      {String(value)}
    </span>
  );
}

const NODE_LABELS: Record<number, string> = {
  1: "File Ingestion in progress…",
  2: "Deterministic Mapping in progress…",
  3: "Pre-Semantic Review in progress…",
  4: "Semantic Mapping in progress…",
  5: "Field Mapping Review in progress…",
  6: "Data Preprocessing in progress…",
  7: "Hierarchy Detection in progress…",
  8: "Hierarchy Verification in progress…",
  9: "Output Generation in progress…",
};

const NODE_TITLES: Record<number, string> = {
  1: "File ingestion",
  2: "Deterministic mapping",
  3: "Pre-semantic review gate",
  4: "Semantic mapping",
  5: "Field mapping review",
  6: "Data preprocessing",
  7: "Hierarchy detection",
  8: "Hierarchy confirmation gate",
  9: "Data artifacts (SQL, CSV, JSON)",
};

const NODE_STEP_KEYS: Record<number, string> = {
  1: "step_1_ingest",
  2: "step_2_deterministic",
  3: "step_3_pre_semantic",
  4: "step_4_semantic",
  5: "step_5_field_mapping",
  6: "step_6_preprocess",
  7: "step_7_hierarchy",
  8: "step_8_hierarchy_gate",
  9: "step_9_output",
};

const STEP_KEY_ALIASES: Record<string, string> = {
  // Canonical backend variants per spec
  step_2_deterministic_mapping: "step_2_deterministic",
  // Backend pauses semantic at step_3_semantic_mapping (graph node 3; output often on node 4)
  step_3_semantic_mapping: "step_4_semantic",
  step_3_semantic: "step_4_semantic",
  step_4_semantic_mapping: "step_4_semantic",
  step_5_preprocess: "step_6_preprocess",
  step_5_preprocess_validate: "step_6_preprocess",
  step_6_data_preprocessing: "step_6_preprocess",
  step_7_hierarchy_detection: "step_7_hierarchy",
  step_9_output_generation: "step_9_output",
  // Legacy aliases (backward compat)
  step_4_field_mapping_review: "step_4_semantic",
  step_6_resolve_hierarchy: "step_6_preprocess",
  step_7_preprocess: "step_7_hierarchy",
  step_8_output: "step_9_output",
  step_8_output_generation: "step_9_output",
  step_9_output: "step_9_output",
  step_9_write: "step_9_output",
};

const STEP_KEY_TO_NODE = Object.entries(NODE_STEP_KEYS).reduce<Record<string, number>>((acc, [nodeId, stepKey]) => {
  acc[stepKey] = Number(nodeId);
  return acc;
}, {});

// PRODUCT_STEPS removed — was only used by UpcomingNodeSteps (now deleted).
// The pipeline tracker already shows the canonical step list.

// UpcomingNodeSteps removed — the static future-step list duplicated the
// pipeline tracker, took noticeable vertical space, and gave a false sense
// that those steps could be acted on individually. The workflow screen now
// focuses on current step + completed steps + pending action only.

type NodeSnapshot = {
  nodeId: number;
  stepKey: string;
  payload: Record<string, unknown>;
  nodeName?: string;
};

type PreSemanticSubmittedSnapshot = {
  id: string;
  payload: MigrationPreSemanticGatePayload;
  decisions: Record<
    string,
    Array<{ source_field: string; decision: "approve" | "semantic"; target_field?: string }>
  >;
};

const PRE_SEMANTIC_HISTORY_KEY = (migrationId: string) =>
  `plenum-migration-pre-semantic-history:${migrationId}`;

function loadPreSemanticHistory(migrationId: string): PreSemanticSubmittedSnapshot[] {
  if (!migrationId || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(PRE_SEMANTIC_HISTORY_KEY(migrationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PreSemanticSubmittedSnapshot[]) : [];
  } catch {
    return [];
  }
}

function savePreSemanticHistory(migrationId: string, snapshots: PreSemanticSubmittedSnapshot[]) {
  if (!migrationId || typeof window === "undefined") return;
  try {
    if (snapshots.length === 0) {
      sessionStorage.removeItem(PRE_SEMANTIC_HISTORY_KEY(migrationId));
    } else {
      sessionStorage.setItem(PRE_SEMANTIC_HISTORY_KEY(migrationId), JSON.stringify(snapshots));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Per-node payload snapshots persist across panel unmounts/remounts and across
 * backend response variants. The backend sometimes (a) doesn't echo old node
 * outputs once a newer step runs and (b) replaces a metric-rich payload with a
 * log-heavy one for the same node. Either case would zero out the rendered
 * metrics. Persisting + merging keeps the per-step data stable.
 */
const SNAPSHOT_BY_NODE_KEY = (migrationId: string) =>
  `plenum-migration-snapshot-by-node:${migrationId}`;

function loadSnapshotByNode(migrationId: string): Record<number, NodeSnapshot> {
  if (!migrationId || typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_BY_NODE_KEY(migrationId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<number, NodeSnapshot> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, NodeSnapshot>)) {
      const n = Number(k);
      if (Number.isFinite(n) && v && typeof v === "object") out[n] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveSnapshotByNode(migrationId: string, snapshots: Record<number, NodeSnapshot>) {
  if (!migrationId || typeof window === "undefined") return;
  try {
    if (Object.keys(snapshots).length === 0) {
      sessionStorage.removeItem(SNAPSHOT_BY_NODE_KEY(migrationId));
    } else {
      sessionStorage.setItem(SNAPSHOT_BY_NODE_KEY(migrationId), JSON.stringify(snapshots));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * A frozen copy of a run that was discarded by "Restart from Node 1".
 *
 * Restart reuses the SAME migration_id (it rewinds in place rather than
 * creating a new migration), so without archiving, the re-run overwrites the
 * live snapshot store and the discarded run's finished cards vanish. We snapshot
 * the run here BEFORE the wipe so it stays reviewable as a collapsed block.
 *
 * This is complementary to the version-archive mechanism (viewingVersionId):
 *   - version-archive  → explicit "Save as version", reopened via the dropdown
 *   - ArchivedRun      → automatic on every Restart-from-Node-1, shown inline
 */
/**
 * Read-only snapshot of a discarded run's "Migration complete" summary. The
 * ResultsPanel reads these straight off the live migration row (not from any
 * node output), so they are NOT recoverable from `snapshots` alone — we capture
 * them here at archive time so the archived run can show its final results.
 */
type ArchivedFinalResults = {
  cmmsName?: string;
  completedAt?: string | null;
  totalFields: number;
  t1Mapped: number;
  t2Auto: number;
  t2Human: number;
  unmapped: number;
};

type ArchivedRun = {
  id: string;
  archivedAt: number;
  snapshots: NodeSnapshot[];
  preSemantic: PreSemanticSubmittedSnapshot[];
  /** Present only when the discarded run had completed (or produced artifacts). */
  finalResults?: ArchivedFinalResults | null;
};

/** Capture the live migration's final-results summary, if it had one. */
function buildArchivedFinalResults(
  migration: MigrationStatusResponse | null | undefined,
): ArchivedFinalResults | null {
  if (!migration) return null;
  const st = (migration.status ?? "").toLowerCase();
  const hasArtifacts = !!(
    migration.output_json_url ||
    migration.output_csv_url ||
    migration.output_sql_url ||
    migration.migration_report_url
  );
  if (st !== "complete" && !hasArtifacts) return null;
  return {
    cmmsName: migration.cmms_name,
    completedAt: migration.completed_at ?? null,
    totalFields: migration.total_fields ?? 0,
    t1Mapped: migration.t1_mapped_count ?? 0,
    t2Auto: migration.t2_auto_count ?? 0,
    t2Human: migration.t2_human_count ?? 0,
    unmapped: migration.unmapped_count ?? 0,
  };
}

const ARCHIVED_RUNS_KEY = (migrationId: string) =>
  `plenum-migration-archived-runs:${migrationId}`;
/** Keep only the most recent N discarded runs to bound sessionStorage growth. */
const ARCHIVED_RUNS_CAP = 3;

function loadArchivedRuns(migrationId: string): ArchivedRun[] {
  if (!migrationId || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(ARCHIVED_RUNS_KEY(migrationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ArchivedRun =>
        !!r &&
        typeof r === "object" &&
        Array.isArray((r as ArchivedRun).snapshots) &&
        Array.isArray((r as ArchivedRun).preSemantic),
    );
  } catch {
    return [];
  }
}

function saveArchivedRuns(migrationId: string, runs: ArchivedRun[]) {
  if (!migrationId || typeof window === "undefined") return;
  try {
    if (runs.length === 0) {
      sessionStorage.removeItem(ARCHIVED_RUNS_KEY(migrationId));
    } else {
      sessionStorage.setItem(ARCHIVED_RUNS_KEY(migrationId), JSON.stringify(runs));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Merge a new payload over an old one, preserving keys that the new one drops. */
function mergeSnapshotPayloads(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!prev) return next;
  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    // Don't let the new payload null-out a previously populated field.
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0 && Array.isArray(merged[k]) && (merged[k] as unknown[]).length > 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0 && merged[k] && typeof merged[k] === "object") continue;
    merged[k] = v;
  }
  return merged;
}

type ResolvedGateType = "pre_semantic" | "field_mapping" | "hierarchy" | "final_confirmation";

type StickyGateState = {
  type: ResolvedGateType;
  payload: Record<string, unknown>;
};

function normalizeStepKeyForHistory(stepKey: string) {
  return STEP_KEY_ALIASES[stepKey] ?? stepKey;
}

function extractIngestPayloadFromLogs(logs: string[]) {
  let rows: number | null = null;
  let cols: number | null = null;
  const tables: string[] = [];

  for (const line of logs) {
    const sheetMatch = line.match(/Sheet\s+([^:]+):\s*(\d+)\s*rows\s*[x×]\s*(\d+)\s*columns/i);
    if (sheetMatch) {
      const table = sheetMatch[1]?.trim();
      const r = Number(sheetMatch[2]);
      const c = Number(sheetMatch[3]);
      if (table) tables.push(table);
      if (Number.isFinite(r)) rows = Math.max(rows ?? 0, r);
      if (Number.isFinite(c)) cols = Math.max(cols ?? 0, c);
      continue;
    }

    const completeMatch = line.match(/complete:\s*(\d+)\s*rows,\s*(\d+)\s*columns/i);
    if (completeMatch) {
      const r = Number(completeMatch[1]);
      const c = Number(completeMatch[2]);
      if (Number.isFinite(r)) rows = Math.max(rows ?? 0, r);
      if (Number.isFinite(c)) cols = Math.max(cols ?? 0, c);
    }
  }

  return {
    row_count: rows ?? 0,
    column_count: cols ?? 0,
    tables: Array.from(new Set(tables)),
  };
}

function isFieldMappingPayload(v: unknown): v is Record<string, unknown> {
  return isFieldMappingGatePayload(v);
}

function isHierarchyPayload(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v)) return false;
  return Array.isArray(v.hierarchies_to_review) || Array.isArray(v.review_items);
}

function isFinalPayload(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v)) return false;
  return isRecord(v.summary);
}

function inferGateTypeFromPayload(v: unknown): "pre_semantic" | "field_mapping" | "hierarchy" | "final_confirmation" | null {
  if (isPreSemanticPayload(v)) return "pre_semantic";
  if (isFieldMappingPayload(v)) return "field_mapping";
  if (isHierarchyPayload(v)) return "hierarchy";
  if (isFinalPayload(v)) return "final_confirmation";
  return null;
}

function parseJsonRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || (raw[0] !== "{" && raw[0] !== "[")) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapGatePayload(input: unknown): Record<string, unknown> | null {
  const candidates: unknown[] = [
    input,
    parseJsonRecord(input),
    isRecord(input) ? input.payload : null,
    isRecord(input) ? input.data : null,
    isRecord(input) ? input.gate_payload : null,
    isRecord(input) ? input.pending_gate_payload : null,
    isRecord(input) ? input.result : null,
    isRecord(input) ? input.response : null,
    isRecord(input) ? input.output : null,
    isRecord(input) ? input.body : null,
  ];

  for (const c of candidates) {
    if (!isRecord(c)) continue;
    if (inferGateTypeFromPayload(c)) return c;
  }
  for (const c of candidates) {
    if (isRecord(c)) return c;
  }
  return null;
}

function CenterNodeHistory({
  snapshots,
  allNodes,
  headerless = false,
}: {
  snapshots: NodeSnapshot[];
  /**
   * The full NodeInfo[] from the live migration status. Forwarded to each
   * snapshot renderer so cross-snapshot lookups work — e.g. Node3Semantic
   * relabels "unmappable" → "new column" when a later gate approved the
   * field, and Node8Output falls back to upstream nodes for the table count
   * when its own payload omits it. Without this, those fallbacks short-circuit
   * to null and the user sees "—" / stale labels.
   */
  allNodes?: NodeInfo[];
  /**
   * When true: skip the "Completed Steps" header AND the per-card DOM id.
   * Used inside an archived (discarded) run block, where the header text
   * ("…while the next node runs") would be misleading, and where the
   * `migration-node-N` ids would otherwise collide with the live history's
   * (duplicate ids break the pipeline tracker's scroll-to-node).
   */
  headerless?: boolean;
}) {
  if (!snapshots.length) return null;

  return (
    <div className="space-y-4 mb-6">
      {headerless ? null : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Completed Steps</div>
          <div className="mt-1 text-xs text-slate-600">
            Previous node outputs stay visible while the next node runs.
          </div>
        </div>
      )}

      {snapshots.map((snap) => {
        const stepKey = snap.stepKey;
        return (
          <div
            key={`hist_${snap.nodeId}_${stepKey}`}
            id={headerless ? undefined : `migration-node-${snap.nodeId}`}
            className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 scroll-mt-6"
          >
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-semibold text-slate-800">
                  {snap.nodeName ?? "Step complete"}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">Status: completed snapshot</div>
            </div>
            <MigrationStepSnapshot stepKey={stepKey} payload={snap.payload} allNodes={allNodes} />
          </div>
        );
      })}
    </div>
  );
}

function CenterPreSemanticHistory({
  snapshots,
}: {
  snapshots: PreSemanticSubmittedSnapshot[];
}) {
  if (!snapshots.length) return null;
  return (
    <div className="space-y-4 mb-6">
      {snapshots.map((snap, idx) => {
        // Render the SUBMITTED decisions (includes auto-approved new-table columns),
        // not just the reviewable items — so a new table shows ALL its columns with
        // their final (snake_case) target names.
        const decisionsByTable = snap.decisions ?? {};
        const targetLookup = new Map<string, string>();
        for (const [tbl, rows] of Object.entries(snap.payload?.review_items_by_table ?? {})) {
          for (const r of rows) targetLookup.set(`${tbl}.${r.source_field}`, r.target_field);
        }
        let approved = 0;
        let semantic = 0;
        let total = 0;
        for (const rows of Object.values(decisionsByTable)) {
          for (const r of rows) {
            total += 1;
            if (r.decision === "approve") approved += 1;
            else if (r.decision === "semantic") semantic += 1;
          }
        }
        return (
          <div key={snap.id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Schema Analysis — Semantic Review</div>
                <div className="text-xs text-slate-500">Submitted decision set #{idx + 1}</div>
              </div>
              <div className="text-xs text-slate-500 tabular-nums">
                {approved} approved · {semantic} semantic · {total} fields
              </div>
            </div>
            <div className="space-y-2">
              {Object.entries(decisionsByTable).map(([tbl, rows]) => (
                <div key={tbl} className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-700">{tbl}</div>
                  <div className="divide-y divide-slate-100">
                    {rows.map((r, i) => {
                      const target =
                        (r.target_field && r.target_field.trim()) ||
                        targetLookup.get(`${tbl}.${r.source_field}`) ||
                        r.source_field;
                      return (
                        <div key={`${tbl}_${r.source_field}_${i}`} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <span className="font-mono text-slate-700">{r.source_field}</span>
                            <span className="mx-2 text-slate-300">→</span>
                            <span className="font-mono text-indigo-700">{target}</span>
                          </div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
                              r.decision === "approve"
                                ? "bg-green-100 text-green-700"
                                : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {r.decision}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Read-only "Migration complete" summary for a discarded run (no live actions). */
function ArchivedFinalResults({ results }: { results: ArchivedFinalResults }) {
  const totalMapped = results.t1Mapped + results.t2Auto + results.t2Human;
  const coveragePct =
    results.totalFields > 0
      ? Math.min(100, Math.round((totalMapped / results.totalFields) * 100))
      : 0;
  const rows = [
    { label: "T1 auto-mapped", value: results.t1Mapped, color: "text-green-600" },
    { label: "T2 auto-mapped", value: results.t2Auto, color: "text-indigo-600" },
    { label: "Human reviewed", value: results.t2Human, color: "text-purple-600" },
    { label: "Unmapped", value: results.unmapped, color: "text-slate-500" },
  ];
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-sm font-semibold text-slate-800">Migration complete (archived)</span>
      </div>
      <div className="text-xs text-slate-500 mb-4">
        {results.cmmsName ? `${results.cmmsName} — ` : ""}read-only summary of the discarded run
        {results.completedAt ? ` · completed ${new Date(results.completedAt).toLocaleString()}` : ""}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {rows.map(({ label, value, color }) => (
          <div
            key={label}
            className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0"
          >
            <span className="text-sm text-slate-600">{label}</span>
            <span className={`font-mono font-bold ${color}`}>{value}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1.5">
          <span className="text-slate-600">Coverage</span>
          <span className="font-mono font-bold text-indigo-600">{coveragePct}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              coveragePct >= 80 ? "bg-green-500" : coveragePct >= 60 ? "bg-amber-500" : "bg-red-500"
            }`}
            style={{ width: `${coveragePct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * One discarded run, rendered as a collapsed block. Expands to the same frozen
 * step cards the live history uses (before-semantic nodes → pre-semantic
 * decisions → after-semantic nodes → final results), via the headerless
 * CenterNodeHistory so the cards don't duplicate the live history's DOM ids or
 * its (now-misleading) "while the next node runs" header.
 *
 * The `allNodes` passed to each card is reconstructed from THIS run's own
 * snapshots — never the live migration — so cross-node fallbacks (e.g.
 * Node8Output's upstream table-count lookup) resolve against the archived run's
 * data and an archived run never reads live migration state.
 */
function ArchivedRunBlock({ run }: { run: ArchivedRun }) {
  const [open, setOpen] = useState(false);
  const hasPreSem = run.preSemantic.length > 0;
  const before = run.snapshots
    .filter((s) => s.nodeId <= 2)
    .sort((a, b) => a.nodeId - b.nodeId);
  const after = run.snapshots
    .filter((s) => (hasPreSem ? s.nodeId > 3 : s.nodeId > 2))
    .sort((a, b) => a.nodeId - b.nodeId);
  const archivedNodes: NodeInfo[] = run.snapshots
    .slice()
    .sort((a, b) => a.nodeId - b.nodeId)
    .map((s) => ({
      node_id: s.nodeId,
      node_name: s.nodeName ?? "",
      status: "completed",
      started_at: null,
      completed_at: null,
      duration_ms: null,
      output: s.payload,
      logs: [],
    }));
  const when = new Date(run.archivedAt).toLocaleString();
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Previous run — discarded {when} · click to review
      </button>
      {open ? (
        <div className="space-y-4 px-3 pb-3">
          <CenterNodeHistory snapshots={before} allNodes={archivedNodes} headerless />
          <CenterPreSemanticHistory snapshots={run.preSemantic} />
          <CenterNodeHistory snapshots={after} allNodes={archivedNodes} headerless />
          {run.finalResults ? <ArchivedFinalResults results={run.finalResults} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Stack of discarded-run blocks, newest first, shown above the live history. */
function ArchivedRunsHistory({ runs }: { runs: ArchivedRun[] }) {
  if (!runs.length) return null;
  return (
    <div className="mb-6 space-y-3">
      {[...runs].reverse().map((run) => (
        <ArchivedRunBlock key={run.id} run={run} />
      ))}
    </div>
  );
}

/** Pull "source → target (conf)" lines out of a node snapshot payload for the Process log. */
function summarizeMappingPayload(payload: Record<string, unknown> | null | undefined): string[] {
  if (!payload || typeof payload !== "object") return [];
  const lines: string[] = [];
  const pushMap = (m: unknown, prefix = "") => {
    if (!m || typeof m !== "object") return;
    const r = m as Record<string, unknown>;
    const sf = typeof r.source_field === "string" ? r.source_field : "";
    if (!sf) return;
    const tf = typeof r.target_field === "string" && r.target_field ? r.target_field : "?";
    const conf = typeof r.confidence === "number" ? ` (${r.confidence.toFixed(2)})` : "";
    lines.push(`${prefix}${sf} → ${tf}${conf}`);
  };
  const ribt = payload.review_items_by_table;
  if (ribt && typeof ribt === "object") {
    for (const [tbl, items] of Object.entries(ribt as Record<string, unknown>)) {
      if (Array.isArray(items)) for (const it of items) pushMap(it, `${tbl}.`);
    }
  }
  for (const key of ["final_mappings", "mappings", "tier1_mappings"]) {
    const arr = payload[key];
    if (Array.isArray(arr)) for (const m of arr) pushMap(m);
  }
  return lines;
}

export default function MigrationContent({
  migration,
  migrationId,
  onRefresh,
  onReset,
  showCompletedHistory = true,
  collapseCompletedHistory = false,
  onFieldFocus,
  embeddedRail = false,
  drivePipelineSteps = false,
  onProcessLog,
  viewingVersionId,
}: Props) {
  // When viewing a saved version, snapshots come from the version-scoped key
  // archived by handleSaveVersion in the parent panel. Otherwise the live
  // (migrationId-scoped) key is used. The two-key strategy is what lets the
  // user reopen v1 after "Restart from Node 1" wiped the live key for v2 —
  // v1's archived snapshots remain intact under its own version id.
  const snapshotStorageKey = viewingVersionId
    ? `version:${viewingVersionId}`
    : migrationId;
  const isViewingArchivedVersion = !!viewingVersionId;
  const [snapshotByNode, setSnapshotByNode] = useState<Record<number, NodeSnapshot>>(() =>
    loadSnapshotByNode(snapshotStorageKey),
  );
  const [preSemanticSnapshots, setPreSemanticSnapshots] = useState<PreSemanticSubmittedSnapshot[]>(() =>
    loadPreSemanticHistory(snapshotStorageKey),
  );
  // Discarded runs (from "Restart from Node 1") — always keyed by the live
  // migrationId, not the version key, since restarting is a live-run action.
  const [archivedRuns, setArchivedRuns] = useState<ArchivedRun[]>(() =>
    loadArchivedRuns(migrationId),
  );
  const [stickyGate, setStickyGate] = useState<StickyGateState | null>(null);
  const [fieldMappingGateDismissed, setFieldMappingGateDismissed] = useState(false);
  const [semanticMappingDismissed, setSemanticMappingDismissed] = useState(() =>
    migrationId ? isSemanticDismissed(migrationId) : false,
  );
  const [autoAdvanceError, setAutoAdvanceError] = useState<string | null>(null);
  const [autoFinalizeError, setAutoFinalizeError] = useState<string | null>(null);
  const [rerunMsg, setRerunMsg] = useState<string | null>(null);
  // Gate-transition overlay state.
  // When a gate handler fires (Continue / Approve / Confirm / etc.) the
  // backend mutation often resolves faster than the next status poll,
  // creating a 2–5s window where the gate's button has stopped spinning
  // but the panel is still showing the old gate. This state bridges that
  // gap with an immediate "Transitioning to next step…" overlay so users
  // never see a blank-feeling moment. Cleared automatically when the
  // polled migration reflects a new gate / step (the comparison snapshot
  // is captured at the moment the gate was submitted).
  type GateTransitionMark = {
    label: string;
    startedAt: number;
    fromStep: number;
    fromGate: string;
    fromStatus: string;
  };
  const [gateTransition, setGateTransition] = useState<GateTransitionMark | null>(null);

  // Restart-from-Node-1 transition guard.
  // After the user clicks Restart from Node 1 the backend rewinds the migration
  // asynchronously. Until the next poll lands we'd otherwise keep rendering
  // the cached `ResultsPanel` (the "Migration complete" card with downloads)
  // because the migration response still says status==="complete". This flag
  // masks that panel and the on-disk snapshots until the polled status
  // genuinely drops back to a non-terminal state (or the rewind times out).
  const [restartingPipeline, setRestartingPipeline] = useState(false);
  // Track the migration "version key" we restarted from so we know when the
  // backend has produced a fresh terminal-state reset.
  const restartStartedAtRef = useRef<number>(0);
  // Completed-steps history is collapsed by default only when viewing an OLDER saved
  // version (so the live run shows all its steps). The user can toggle it any time.
  const [historyCollapsed, setHistoryCollapsed] = useState(collapseCompletedHistory);
  const lastAutoAdvanceKeyRef = useRef<string | null>(null);
  const lastAutoFinalizeKeyRef = useRef<string | null>(null);
  // Bring the active step/gate into view as the pipeline advances — but only the
  // minimum amount ("nearest"), so the completed/previous node cards stay visible
  // above instead of being pushed off-screen.
  const activeStepRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      // Bring the ACTIVE/new step to the top of the view; completed steps end up
      // above it, so the user scrolls UP to review them.
      activeStepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, [migration?.pending_gate_type, migration?.status, migration?.current_step]);

  // Click a pipeline step to scroll to / view it (completed snapshot or the live step).
  // Rewind the pipeline to a completed step and re-run forward (re-fires its gate to edit).
  const handleRerunStep = async (nodeNum?: number) => {
    if (nodeNum == null) return;
    setRerunMsg(`Re-running from node ${nodeNum}… the step's gate will re-open for edits.`);
    if (nodeNum === 1) {
      // Hard reset: hide the complete panel, wipe the in-memory snapshots so
      // the new run starts clean, and lock the restart guard until the next
      // poll confirms a non-terminal state. The 60s timeout is a safety net
      // for the rare case where the rewind never lands.
      setRestartingPipeline(true);
      restartStartedAtRef.current = Date.now();
      // Archive the run we're about to discard so its finished cards stay
      // reviewable as a collapsed "Previous run" block, instead of being
      // silently overwritten by the re-run (which reuses this migration_id).
      const archivedAt = restartStartedAtRef.current;
      const snapsToArchive = Object.values(snapshotByNode);
      const finalResults = buildArchivedFinalResults(migration);
      if (snapsToArchive.length > 0 || preSemanticSnapshots.length > 0 || finalResults) {
        setArchivedRuns((prev) => {
          const entry: ArchivedRun = {
            id: `run_${archivedAt}`,
            archivedAt,
            snapshots: snapsToArchive,
            preSemantic: preSemanticSnapshots,
            finalResults,
          };
          const next = [...prev, entry].slice(-ARCHIVED_RUNS_CAP);
          saveArchivedRuns(migrationId, next);
          return next;
        });
      }
      setSnapshotByNode({});
      setPreSemanticSnapshots([]);
      setStickyGate(null);
      setFieldMappingGateDismissed(false);
      // Restart begins a fresh LIVE run — expand the completed-steps history
      // so each new node's output card is visible the moment it lands.
      // Forcing collapsed here was wrong: collapsed is only the right default
      // when reviewing an older saved version, not when watching a live run
      // unfold from scratch. Users reported "not showing all node details"
      // because every new snapshot was hidden behind the collapse toggle.
      setHistoryCollapsed(false);
      // Also clear the per-migration sessionStorage flags that drive the
      // semantic / field-mapping gate skip logic. Without this, the new run
      // would silently skip the pre-semantic gate (because the prior run had
      // dismissed it) and the user would see the renderer fall through to a
      // blank state at Node 2.
      setSemanticMappingDismissed(false);
      clearSemanticDismissed(migrationId);
      clearFieldMappingDraft(migrationId);
    }
    try {
      await schemaMapperApi.rerunMigrationFromNode(migrationId, nodeNum);
      onRefresh();
      setTimeout(() => setRerunMsg(null), 5000);
    } catch (e) {
      setRerunMsg(e instanceof Error ? e.message : "Re-run failed.");
      if (nodeNum === 1) {
        // Roll back the guard if the backend rejected the restart so we don't
        // strand the user on a permanent "restarting" screen.
        setRestartingPipeline(false);
      }
    }
  };

  // Clear the restart guard once the backend confirms a fresh non-terminal
  // status (the rewind has taken effect). 60s safety timeout falls through.
  useEffect(() => {
    if (!restartingPipeline) return;
    const st = (migration?.status ?? "").toLowerCase();
    const terminal = st === "complete" || st === "failed" || st === "ddl_failed" || st === "cancelled";
    if (!terminal && st) {
      setRestartingPipeline(false);
      return;
    }
    const elapsed = Date.now() - restartStartedAtRef.current;
    if (elapsed > 60_000) {
      setRestartingPipeline(false);
    }
  }, [restartingPipeline, migration?.status, migration?.current_step]);

  useEffect(() => {
    // Rehydrate from sessionStorage instead of wiping — survives panel unmount /
    // tab switch (so e.g. "Data preprocessing" metrics stay populated when the
    // backend's later responses no longer echo the older node outputs).
    setSnapshotByNode(loadSnapshotByNode(snapshotStorageKey));
    setPreSemanticSnapshots(loadPreSemanticHistory(snapshotStorageKey));
    // Archived (discarded) runs are tied to the live migrationId regardless of
    // which version is being viewed.
    setArchivedRuns(loadArchivedRuns(migrationId));
    setStickyGate(null);
    setFieldMappingGateDismissed(false);
    setHistoryCollapsed(collapseCompletedHistory);
    setSemanticMappingDismissed(isSemanticDismissed(migrationId));
    setAutoFinalizeError(null);
  }, [snapshotStorageKey, migrationId, collapseCompletedHistory]);

  useEffect(() => {
    // Writes are suppressed when the user is reviewing a saved version — the
    // archived snapshots under `version:<id>` are immutable once the user
    // saved that version, and writing to the live key here would let an
    // archived view's stale state trample the in-flight run.
    if (isViewingArchivedVersion) return;
    savePreSemanticHistory(migrationId, preSemanticSnapshots);
  }, [migrationId, preSemanticSnapshots, isViewingArchivedVersion]);

  useEffect(() => {
    if (isViewingArchivedVersion) return;
    saveSnapshotByNode(migrationId, snapshotByNode);
  }, [migrationId, snapshotByNode, isViewingArchivedVersion]);

  useEffect(() => {
    // Archived runs persist by live migrationId. Safe to write while viewing a
    // version (it's a distinct key and the list only changes on restart).
    saveArchivedRuns(migrationId, archivedRuns);
  }, [migrationId, archivedRuns]);

  useEffect(() => {
    if (!migration || semanticMappingDismissed) return;
    if (isPipelinePastFieldMappingGate(migration)) {
      markSemanticDismissed(migrationId);
      setSemanticMappingDismissed(true);
    }
  }, [migration, migrationId, semanticMappingDismissed]);

  useEffect(() => {
    if (!migration) return;
    // While a Restart-from-Node-1 is in flight the backend may still echo the
    // pre-restart terminal state for a poll or two. Capturing it here would
    // re-populate the snapshots we just wiped (and resurrect the discarded
    // run's node cards in the new run's live history). Skip until the rewind
    // lands and `restartingPipeline` clears — then this effect re-runs.
    if (restartingPipeline) return;

    setSnapshotByNode((prev) => {
      const next: Record<number, NodeSnapshot> = { ...prev };
      let changed = false;
      const upsertSnapshot = (incoming: NodeSnapshot) => {
        const prevSnap = next[incoming.nodeId];
        if (!prevSnap) {
          next[incoming.nodeId] = incoming;
          changed = true;
          return;
        }
        // Merge payloads — when the backend re-emits a node with a sparser
        // payload (e.g. only logs/metadata), keep the previously-populated
        // metric fields rather than replacing them with nulls/zeros.
        const mergedPayload = mergeSnapshotPayloads(prevSnap.payload, incoming.payload);
        const isSame =
          prevSnap.stepKey === incoming.stepKey &&
          prevSnap.nodeName === incoming.nodeName &&
          JSON.stringify(prevSnap.payload) === JSON.stringify(mergedPayload);
        if (isSame) return;
        // Only commit if the merged result is at least as rich as what we had.
        const prevScore = payloadRichnessScore(prevSnap.payload);
        const mergedScore = payloadRichnessScore(mergedPayload);
        if (mergedScore >= prevScore) {
          next[incoming.nodeId] = {
            ...incoming,
            payload: mergedPayload,
            nodeName: incoming.nodeName ?? prevSnap.nodeName,
          };
          changed = true;
        }
      };

      for (const n of migration.nodes ?? []) {
        const stepKey = NODE_STEP_KEYS[n.node_id];
        if (!stepKey) continue;

        let payload: Record<string, unknown> | null = null;
        if (n.output && isRecord(n.output)) {
          payload = n.output;
        } else if (n.node_id === 1 && Array.isArray(n.logs) && n.logs.length) {
          payload = extractIngestPayloadFromLogs(n.logs);
        }

        if (!payload) continue;

        const incoming: NodeSnapshot = {
          nodeId: n.node_id,
          stepKey,
          payload,
          nodeName: NODE_TITLES[n.node_id] ?? n.node_name,
        };
        upsertSnapshot(incoming);
      }

      if (
        migration.status === "step_paused" &&
        typeof migration.pending_gate_type === "string" &&
        isRecord(migration.pending_gate_payload) &&
        !isStepPauseBlockingFieldMapping(migration, semanticMappingDismissed)
      ) {
        const normalizedStepKey = normalizeStepKeyForHistory(migration.pending_gate_type);
        const nodeId = STEP_KEY_TO_NODE[normalizedStepKey];
        if (typeof nodeId === "number") {
          const incoming: NodeSnapshot = {
            nodeId,
            stepKey: normalizedStepKey,
            payload: migration.pending_gate_payload,
            nodeName:
              NODE_TITLES[nodeId] ??
              (migration.nodes ?? []).find((n) => n.node_id === nodeId)?.node_name,
          };
          upsertSnapshot(incoming);
        }
      }

      return changed ? next : prev;
    });
  }, [migration, fieldMappingGateDismissed, semanticMappingDismissed, restartingPipeline]);

  // Stream per-node field-mapping decisions into the right-side Process log, tagged to
  // the migration flow — "<table>.<source> → <target> (conf)" for each mapped field.
  const loggedNodeKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!onProcessLog || !migration) return;
    const nodes = Array.isArray(migration.nodes) ? migration.nodes : [];
    for (const n of nodes) {
      const rawLogs = Array.isArray(n.logs)
        ? n.logs.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        : [];
      // Prefer the node's own raw log lines; fall back to a mapping summary from its snapshot.
      const lines = rawLogs.length ? rawLogs : summarizeMappingPayload(snapshotByNode[n.node_id]?.payload);
      if (!lines.length) continue;
      const label = NODE_TITLES[n.node_id] ?? n.node_name ?? `Node ${n.node_id}`;
      const key = `${migrationId}:${n.node_id}:${lines.length}`;
      if (loggedNodeKeysRef.current.has(key)) continue;
      loggedNodeKeysRef.current.add(key);
      onProcessLog({
        phase: "completed",
        tool: "migration_node",
        toolLabel: label,
        status: "success",
        title: label,
        detail: `${lines.length} log line${lines.length === 1 ? "" : "s"}`,
        output: lines.join("\n"),
        spaceTag: "migration",
      });
    }
  }, [migration, snapshotByNode, migrationId, onProcessLog]);

  const historySnapshots = useMemo(
    () =>
      Object.values(snapshotByNode)
        .sort((a, b) => a.nodeId - b.nodeId),
    [snapshotByNode],
  );
  const pendingGateTypeRaw = typeof migration?.pending_gate_type === "string" ? migration.pending_gate_type : null;
  const statusRaw = migration?.status ?? null;
  const normalizedPausedStepKey =
    pendingGateTypeRaw ? normalizeStepKeyForHistory(pendingGateTypeRaw) : null;
  const shouldAutoAdvanceNode2 =
    statusRaw === "step_paused" &&
    normalizedPausedStepKey === "step_2_deterministic";
  const shouldAutoAdvanceHierarchyDetection =
    statusRaw === "step_paused" &&
    normalizedPausedStepKey === "step_7_hierarchy";

  const shouldOrchestratorAutoAdvanceStepPause =
    drivePipelineSteps &&
    statusRaw === "step_paused" &&
    !!pendingGateTypeRaw &&
    !isStepPauseBlockingFieldMapping(migration, semanticMappingDismissed) &&
    shouldOrchestratorAutoAdvanceStep(pendingGateTypeRaw, semanticMappingDismissed) &&
    !shouldAutoAdvanceNode2 &&
    !shouldAutoAdvanceHierarchyDetection;

  const { mutate: advanceAfterFieldReview, isPending: _isAdvancingAfterFieldReview } = useMigrationAdvance({
    onSuccess: () => {
      setFieldMappingGateDismissed(true);
      setStickyGate(null);
      setAutoAdvanceError(null);
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to continue pipeline";
      setAutoAdvanceError(msg);
    },
  });

  const { mutate: autoAdvanceMigration, isPending: isAutoAdvancingNode2 } = useMigrationAdvance({
    onSuccess: () => {
      setAutoAdvanceError(null);
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to continue after deterministic mapping";
      setAutoAdvanceError(msg);
    },
  });

  useEffect(() => {
    if (!shouldAutoAdvanceNode2 && !shouldAutoAdvanceHierarchyDetection && !shouldOrchestratorAutoAdvanceStepPause) {
      return;
    }
    const dedupeKey = `${migrationId}:${pendingGateTypeRaw ?? ""}:${statusRaw ?? ""}`;
    if (lastAutoAdvanceKeyRef.current === dedupeKey) return;
    lastAutoAdvanceKeyRef.current = dedupeKey;
    setAutoAdvanceError(null);
    autoAdvanceMigration({ migrationId });
  }, [
    shouldAutoAdvanceNode2,
    shouldAutoAdvanceHierarchyDetection,
    shouldOrchestratorAutoAdvanceStepPause,
    migrationId,
    pendingGateTypeRaw,
    statusRaw,
    autoAdvanceMigration,
  ]);

  const status = migration?.status ?? null;
  const pending_gate_type = migration?.pending_gate_type ?? null;
  const pending_gate_payload = migration?.pending_gate_payload ?? null;
  const hasOutputArtifacts = !!(
    migration?.output_json_url ||
    migration?.output_csv_url ||
    migration?.output_sql_url ||
    migration?.migration_report_url
  );
  const isGate3RejectFalseFailure =
    status === "failed" &&
    typeof migration?.error_message === "string" &&
    migration.error_message.toLowerCase().includes("customer rejected handoff at gate 3") &&
    hasOutputArtifacts;
  const isEffectivelyComplete = status === "complete" || isGate3RejectFalseFailure;
  const normalizedGateType = normalizeMigrationGateType(typeof pending_gate_type === "string" ? pending_gate_type : null);
  const shouldAutoFinalizeWriteGate =
    status === "awaiting_review" &&
    (typeof pending_gate_type === "string" && pending_gate_type.toLowerCase() === "write");

  const { mutate: autoFinalizeMigration, isPending: isAutoFinalizing } = useMigrationGateFinal({
    onSuccess: () => {
      setAutoFinalizeError(null);
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to auto-confirm final handoff";
      setAutoFinalizeError(msg);
    },
  });

  useEffect(() => {
    if (!shouldAutoFinalizeWriteGate) return;
    const dedupeKey = `${migrationId}:${String(pending_gate_type ?? "")}:${String(status ?? "")}`;
    if (lastAutoFinalizeKeyRef.current === dedupeKey) return;
    lastAutoFinalizeKeyRef.current = dedupeKey;
    setAutoFinalizeError(null);
    autoFinalizeMigration({ migrationId, body: { confirmed: true } });
  }, [shouldAutoFinalizeWriteGate, migrationId, pending_gate_type, status, autoFinalizeMigration]);
  const syntheticFieldMappingPayload = migration
    ? (buildFieldMappingPayloadFromMigration(migration) as MigrationFieldMappingGatePayload | null)
    : null;
  const _fieldMappingReviewItemCount = countFieldMappingReviewItems(syntheticFieldMappingPayload);
  const shouldPreferSyntheticFieldMappingGate =
    !fieldMappingGateDismissed &&
    !!syntheticFieldMappingPayload &&
    status === "running" &&
    !pending_gate_type &&
    !pending_gate_payload &&
    (migration?.current_step ?? 0) >= 4;
  const syntheticFieldMappingGate =
    status === "running" &&
    (migration?.current_step ?? 0) <= 5 &&
    !pending_gate_type &&
    !pending_gate_payload &&
    !!syntheticFieldMappingPayload;

  const semanticMappingLatchActive = requiresSemanticMappingLatch(migration, semanticMappingDismissed);
  const fieldMappingLatchActive = requiresFieldMappingLatch(
    migration,
    fieldMappingGateDismissed,
    semanticMappingDismissed,
  );
  const prematurePreprocessPoll = isPrematurePreprocessPoll(
    migration,
    fieldMappingGateDismissed,
    semanticMappingDismissed,
  );
  const semanticMappingPausePayload = (() => {
    if (!migration) return null;
    if (
      status === "step_paused" &&
      isSemanticMappingStepKey(typeof pending_gate_type === "string" ? pending_gate_type : null) &&
      isRecord(pending_gate_payload)
    ) {
      return pending_gate_payload as Record<string, unknown>;
    }
    const semanticNode = findSemanticMappingNode(migration);
    if (semanticNode?.output && isRecord(semanticNode.output)) return semanticNode.output;
    const snap4 = snapshotByNode[semanticNode?.node_id ?? 4]?.payload;
    if (snap4 && isSemanticMappingPausePayload(snap4)) return snap4;
    if (snap4) return snap4;
    return { label: "Semantic Mapping", tier2_auto_mapped: 0, tier2_flagged: 0, unmappable: 0 };
  })();
  const fieldMappingControls = useMemo(
    () => resolveFieldMappingGateControls(migration, fieldMappingGateDismissed, semanticMappingDismissed),
    [migration, fieldMappingGateDismissed, semanticMappingDismissed],
  );
  const fieldMappingSubmitReady = fieldMappingControls.submitReady;
  const fieldMappingSubmitBlocked = fieldMappingSubmitBlockedReason(migration, semanticMappingDismissed);
  const fieldMappingDeferUntilGate = fieldMappingControls.deferProceed;
  const directPendingPayload = unwrapGatePayload(pending_gate_payload);
  const directPendingIsPreprocess =
    prematurePreprocessPoll ||
    (isPreprocessStepPauseKey(typeof pending_gate_type === "string" ? pending_gate_type : null) &&
      isPreprocessPausePayload(pending_gate_payload));
  const draftFetchRemote =
    !directPendingIsPreprocess &&
    !(statusRaw === "step_paused" && isPreprocessStepPauseKey(pendingGateTypeRaw));
  const fieldMappingDraftEnvelope = useFieldMappingDraft(migrationId, migration, {
    fetchRemote: draftFetchRemote,
  });

  const effectiveGatePayload = (() => {
    if (!migration) return null;

    const preSemanticPayload = resolvePreSemanticGatePayload(migration);
    if (preSemanticPayload && isPreSemanticGatePending(migration)) {
      return preSemanticPayload;
    }

    if (fieldMappingLatchActive) {
      if (shouldPreferSyntheticFieldMappingGate && syntheticFieldMappingPayload) {
        return syntheticFieldMappingPayload;
      }
      if (directPendingPayload && isFieldMappingGatePayload(directPendingPayload)) {
        return directPendingPayload;
      }
      const node5 = (migration.nodes ?? []).find((n) => n.node_id === 5);
      const node5Payload = unwrapGatePayload(node5?.output);
      if (node5Payload && isFieldMappingGatePayload(node5Payload)) return node5Payload;
      if (stickyGate?.type === "field_mapping") return stickyGate.payload;
      if (syntheticFieldMappingPayload) return syntheticFieldMappingPayload;
      const snap5 = snapshotByNode[5]?.payload;
      if (snap5 && isFieldMappingGatePayload(snap5)) return snap5;
    }

    if (shouldPreferSyntheticFieldMappingGate && syntheticFieldMappingPayload) return syntheticFieldMappingPayload;
    if (directPendingPayload && !directPendingIsPreprocess) return directPendingPayload;
    if (syntheticFieldMappingPayload) return syntheticFieldMappingPayload;
    if (!normalizedGateType || typeof pending_gate_type !== "string") return null;

    const normalizedStepKey = normalizeStepKeyForHistory(pending_gate_type);
    const expectedNodeId = STEP_KEY_TO_NODE[normalizedStepKey];
    if (typeof expectedNodeId === "number") {
      const expectedNode = (migration.nodes ?? []).find((n) => n.node_id === expectedNodeId);
      const expectedOutput = unwrapGatePayload(expectedNode?.output);
      if (expectedOutput && !(fieldMappingLatchActive && isPreprocessPausePayload(expectedOutput))) {
        return expectedOutput;
      }
      const expectedSnapshot = snapshotByNode[expectedNodeId];
      const expectedSnapshotPayload = unwrapGatePayload(expectedSnapshot?.payload);
      if (
        expectedSnapshotPayload &&
        !(fieldMappingLatchActive && isPreprocessPausePayload(expectedSnapshotPayload))
      ) {
        return expectedSnapshotPayload;
      }
    }

    for (const n of [...(migration.nodes ?? [])].reverse()) {
      const payload = unwrapGatePayload(n.output);
      if (!payload) continue;
      if (fieldMappingLatchActive && isPreprocessPausePayload(payload)) continue;
      if (inferGateTypeFromPayload(payload) === "field_mapping" || !fieldMappingLatchActive) return payload;
    }
    return null;
  })();
  const inferredGateType = inferGateTypeFromPayload(effectiveGatePayload);
  const resolvedGateType = isPreSemanticGatePending(migration)
    ? "pre_semantic"
    : fieldMappingLatchActive
      ? "field_mapping"
      : normalizedGateType ??
        inferredGateType ??
        (shouldPreferSyntheticFieldMappingGate || syntheticFieldMappingGate ? "field_mapping" : null);
  const liveGateType = resolvedGateType as ResolvedGateType | null;
  const liveGatePayload = effectiveGatePayload ?? null;
  const displayGateType = liveGateType ?? stickyGate?.type ?? null;
  const displayGatePayload = liveGateType ? liveGatePayload : (stickyGate?.payload ?? null);

  useEffect(() => {
    if (liveGateType && liveGatePayload) {
      setStickyGate((prev) => {
        if (
          fieldMappingLatchActive &&
          prev?.type === "field_mapping" &&
          liveGateType !== "field_mapping"
        ) {
          return prev;
        }
        if (!prev) return { type: liveGateType, payload: liveGatePayload };
        if (prev.type !== liveGateType) return { type: liveGateType, payload: liveGatePayload };
        if (JSON.stringify(prev.payload) !== JSON.stringify(liveGatePayload)) {
          return { type: liveGateType, payload: liveGatePayload };
        }
        return prev;
      });
      return;
    }
    if (isEffectivelyComplete || status === "failed" || status === "ddl_failed") {
      setStickyGate(null);
    }
  }, [liveGateType, liveGatePayload, status, isEffectivelyComplete, fieldMappingLatchActive]);

  if (!migration) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader size={20} className="animate-spin" />
          <span className="text-sm">Loading migration status…</span>
        </div>
      </div>
    );
  }

  const activeStepKey =
    status === "step_paused" && typeof pending_gate_type === "string"
      ? normalizeStepKeyForHistory(pending_gate_type)
      : null;
  const activeNodeId = activeStepKey ? STEP_KEY_TO_NODE[activeStepKey] : undefined;
  const visibleHistorySnapshots =
    typeof activeNodeId === "number"
      ? historySnapshots.filter((snap) => snap.nodeId !== activeNodeId)
      : historySnapshots;
  const orderedHistorySnapshots =
    typeof activeNodeId === "number"
      ? visibleHistorySnapshots.filter((snap) => snap.nodeId < activeNodeId)
      : visibleHistorySnapshots;
  const hasPreSemanticSnapshot = preSemanticSnapshots.length > 0;
  const historyBeforeSemanticGate = orderedHistorySnapshots.filter((snap) => snap.nodeId <= 2);
  const historyAfterSemanticGate = orderedHistorySnapshots.filter((snap) =>
    hasPreSemanticSnapshot ? snap.nodeId > 3 : snap.nodeId > 2,
  );
  const isPreSemanticGateActive = displayGateType === "pre_semantic";
  const historyBlock = showCompletedHistory ? (
    <>
      <CenterNodeHistory
        snapshots={
          isPreSemanticGateActive
            ? historyBeforeSemanticGate.filter((s) => s.nodeId < 2)
            : historyBeforeSemanticGate
        }
        allNodes={migration.nodes}
      />
      <CenterPreSemanticHistory snapshots={preSemanticSnapshots} />
      <CenterNodeHistory snapshots={historyAfterSemanticGate} allNodes={migration.nodes} />
    </>
  ) : null;

  const hasVisibleHistory =
    showCompletedHistory &&
    (historyBeforeSemanticGate.length > 0 ||
      preSemanticSnapshots.length > 0 ||
      historyAfterSemanticGate.length > 0);

  const wrapPipelineStep = (panel: React.ReactNode, className?: string) => (
    <div className={className ?? (embeddedRail ? "w-full min-w-0" : "w-full min-w-0")}>
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => void handleRerunStep(1)}
          title="Discard all progress and re-run the whole pipeline from Node 1 (file ingestion)"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
        >
          <RotateCcw size={12} /> Restart from Node 1
        </button>
      </div>
      {rerunMsg ? (
        <div className="mb-3 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] text-indigo-800">
          {rerunMsg}
        </div>
      ) : null}
      {showCompletedHistory && archivedRuns.length > 0 ? (
        <ArchivedRunsHistory runs={archivedRuns} />
      ) : null}
      {hasVisibleHistory ? (
        <div className="mb-8 pb-8 border-b border-slate-200 space-y-4">
          <button
            type="button"
            onClick={() => setHistoryCollapsed((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 transition-colors"
          >
            {historyCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            {historyCollapsed
              ? "Previous run — click to review"
              : "Completed steps — scroll up to review"}
          </button>
          {!historyCollapsed ? historyBlock : null}
        </div>
      ) : null}
      <div id="migration-active-step" ref={activeStepRef} className="scroll-mt-6 relative">
        {/* Optimistic transition overlay (UX audit fix). Bridges the gap
            between a gate decision being submitted and the polled state
            reflecting the new step — without this users see ~2-5s of
            apparent inactivity after the button stops spinning. */}
        {gateTransition ? (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-white/85 backdrop-blur-sm border border-indigo-100 px-6 py-10 text-center animate-in fade-in duration-200"
          >
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
              <Loader size={24} className="text-indigo-500 animate-spin" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                {gateTransition.label}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Saving your decisions and waiting for the next step to open…
              </p>
            </div>
          </div>
        ) : null}
        <div aria-hidden={gateTransition ? true : undefined}>{panel}</div>
      </div>
    </div>
  );

  const node2OutputPayload = snapshotByNode[2]?.payload ?? null;

  // Stamp a transition mark immediately after a gate decision is submitted.
  // The label is shown verbatim in the overlay so the user sees something
  // workflow-specific (not a generic spinner).
  const beginGateTransition = (label: string) => {
    setGateTransition({
      label,
      startedAt: Date.now(),
      fromStep: migration.current_step ?? 0,
      fromGate: String(migration.pending_gate_type ?? ""),
      fromStatus: String(migration.status ?? ""),
    });
  };

  // Auto-clear the transition overlay when the polled migration genuinely
  // moves to a new state. A 25s safety timeout falls through so the user
  // is never stranded if the backend silently swallows the advance.
  useEffect(() => {
    if (!gateTransition) return;
    const stepChanged = (migration.current_step ?? 0) !== gateTransition.fromStep;
    const gateChanged = String(migration.pending_gate_type ?? "") !== gateTransition.fromGate;
    const statusChanged = String(migration.status ?? "") !== gateTransition.fromStatus;
    const moved = stepChanged || gateChanged || statusChanged;
    if (moved) {
      setGateTransition(null);
      return;
    }
    if (Date.now() - gateTransition.startedAt > 25_000) {
      setGateTransition(null);
    }
  }, [
    gateTransition,
    migration.current_step,
    migration.pending_gate_type,
    migration.status,
  ]);

  const handlePreSemanticSubmitted = (snapshot?: {
    gate: "pre_semantic";
    payload: MigrationPreSemanticGatePayload;
    decisions: Record<string, Array<{ source_field: string; decision: "approve" | "semantic" }>>;
  }) => {
    if (snapshot) {
      setPreSemanticSnapshots((prev) => {
        const key = JSON.stringify(snapshot.decisions);
        if (prev.some((p) => JSON.stringify(p.decisions) === key)) return prev;
        return [
          ...prev,
          {
            id: `pre_semantic_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            payload: snapshot.payload,
            decisions: snapshot.decisions,
          },
        ];
      });
    }
    setStickyGate(null);
    setAutoAdvanceError(null);
    beginGateTransition("Applying pre-semantic decisions… preparing semantic mapping");
    onRefresh();
  };

  const handleFieldMappingSubmitted = () => {
    setFieldMappingGateDismissed(true);
    setStickyGate(null);
    setAutoAdvanceError(null);
    beginGateTransition("Applying field-mapping decisions… preparing the next step");
    onRefresh();
  };

  const handleFieldMappingDeferredProceed = () => {
    setAutoAdvanceError(null);
    advanceAfterFieldReview({ migrationId });
  };

  const handleApplyTier2Continue = async (body: MigrationGateFieldMappingRequest) => {
    setAutoAdvanceError(null);
    const payloadShape = fieldMappingControls.payload ?? buildFieldMappingPayloadFromMigration(migration);
    const flaggedByTable =
      (payloadShape?.flagged_by_table as Record<string, MigrationFlaggedFieldItem[]>) ?? {};
    const unmappedRaw = payloadShape?.unmapped_by_table ?? {};
    const unmappedByTable = isRecord(unmappedRaw) ? unmappedRaw : {};
    const meta = fieldMappingDraftEnvelope?.meta;

    const result = await applyTier2FieldMappingContinue(
      migrationId,
      body,
      flaggedByTable,
      unmappedByTable,
      meta,
    );

    if (result.ok) {
      setSemanticMappingDismissed(true);
      handleFieldMappingSubmitted();
      return;
    }

    setAutoAdvanceError(result.error);
    onRefresh();
  };

  const handleSemanticMappingContinued = (opts?: { fieldMappingSubmitted?: boolean }) => {
    markSemanticDismissed(migrationId);
    setSemanticMappingDismissed(true);
    if (opts?.fieldMappingSubmitted) {
      clearFieldMappingDraft(migrationId);
      setFieldMappingGateDismissed(true);
    }
    setStickyGate(null);
    setAutoAdvanceError(null);
    beginGateTransition(
      opts?.fieldMappingSubmitted
        ? "Applying field-mapping decisions… preparing data preprocessing"
        : "Continuing semantic mapping… preparing the next step",
    );
    onRefresh();
  };

  const handleHierarchySubmitted = () => {
    setStickyGate(null);
    setAutoAdvanceError(null);
    beginGateTransition("Confirming hierarchy… preparing data artefacts");
    onRefresh();
  };

  const handleFinalSubmitted = () => {
    setStickyGate(null);
    setAutoAdvanceError(null);
    beginGateTransition("Finalising migration… writing to plenum_cafm");
    onRefresh();
  };

  // ── Error ──────────────────────────────────────────────────────────────────
  if ((status === "failed" || status === "ddl_failed") && !isGate3RejectFalseFailure) {
    return wrapPipelineStep(
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <XCircle size={20} className="text-red-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-slate-900 mb-1">
                Migration {status === "ddl_failed" ? "DDL error" : "failed"}
              </h2>
              {migration.error_message && (
                <pre className="text-sm text-red-700 bg-red-50 rounded-lg p-4 mt-2 overflow-auto whitespace-pre-wrap">
                  {migration.error_message}
                </pre>
              )}
              <button
                onClick={onReset}
                className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
              >
                <RotateCcw size={14} />
                New migration
              </button>
            </div>
          </div>
        </div>,
      "max-w-2xl",
    );
  }

  // ── Restart in flight ──────────────────────────────────────────────────────
  // Explicit transient panel shown after Restart-from-Node-1 until the polled
  // status drops back to a non-terminal value. Otherwise the user would see
  // either the old complete card or — when later branches don't match the
  // resetting state — a flash of blank canvas while the new run spins up.
  if (restartingPipeline) {
    return wrapPipelineStep(
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-8 flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
          <RotateCcw size={28} className="text-amber-600 animate-spin" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Restarting the migration pipeline…</h2>
          <p className="text-sm text-slate-500 mt-1">
            Rewinding to Node 1 (File ingestion). The first step will open once the backend has reset state.
          </p>
        </div>
      </div>,
    );
  }

  // ── Complete ───────────────────────────────────────────────────────────────
  if (isEffectivelyComplete) {
    // Keep every completed node step (1→7) visible above the success summary, instead
    // of replacing the whole pipeline with just the results card.
    return wrapPipelineStep(<ResultsPanel migration={migration} onReset={onReset} />);
  }

  const preSemanticGatePayload = resolvePreSemanticGatePayload(migration);
  if (preSemanticGatePayload && isPreSemanticGatePending(migration)) {
    return wrapPipelineStep(
      <GatePreSemantic
        migrationId={migrationId}
        payload={preSemanticGatePayload as MigrationPreSemanticGatePayload}
        onSubmitted={handlePreSemanticSubmitted}
        onFieldFocus={(terms) => onFieldFocus?.(terms, 2)}
        node2Output={node2OutputPayload ?? undefined}
      />,
    );
  }

  // Semantic Mapping (Tier 2) — must complete before Field Structure when flagged items exist.
  const semanticReviewPayloadForStep = buildFieldMappingPayloadFromMigration(migration);
  const semanticFlaggedCountForStep = countFieldMappingReviewItems(semanticReviewPayloadForStep);
  const needsSemanticStep =
    !isPipelinePastFieldMappingGate(migration) &&
    needsSemanticReviewBeforeFieldMapping(migration, semanticMappingDismissed) &&
    !!semanticReviewPayloadForStep &&
    semanticFlaggedCountForStep > 0;

  if (needsSemanticStep) {
    const semanticStepKey =
      status === "step_paused" &&
      typeof pending_gate_type === "string" &&
      isSemanticMappingStepKey(pending_gate_type)
        ? normalizeStepKeyForHistory(pending_gate_type)
        : "step_4_semantic";
    const lastPreSemantic =
      preSemanticSnapshots.length > 0 ? preSemanticSnapshots[preSemanticSnapshots.length - 1] : undefined;
    const pausePayload =
      semanticMappingPausePayload && Object.keys(semanticMappingPausePayload).length
        ? semanticMappingPausePayload
        : (semanticReviewPayloadForStep as Record<string, unknown>);

    return wrapPipelineStep(
      <SemanticMappingStep
        migrationId={migrationId}
        stepKey={semanticStepKey}
        pausePayload={pausePayload}
        reviewPayload={semanticReviewPayloadForStep}
        onSubmitted={handleSemanticMappingContinued}
        onFieldFocus={(terms) => onFieldFocus?.(terms, 4)}
        t1Snapshot={lastPreSemantic}
        allNodes={migration.nodes}
        embeddedRail={embeddedRail}
      />,
    );
  }

  // Semantic step pause with no flagged items — simple continue.
  if (semanticMappingLatchActive && semanticMappingPausePayload) {
    return wrapPipelineStep(
      <StepPause
        migrationId={migrationId}
        stepKey={
          status === "step_paused" &&
          typeof pending_gate_type === "string" &&
          isSemanticMappingStepKey(pending_gate_type)
            ? normalizeStepKeyForHistory(pending_gate_type)
            : "step_4_semantic"
        }
        payload={(semanticMappingPausePayload ?? {}) as Record<string, unknown>}
        onAdvanced={() => handleSemanticMappingContinued()}
        allNodes={migration.nodes}
      />,
    );
  }

  // Step pause (e.g. step_5_preprocess) — must finish before Field Structure Review.
  if (
    isStepPauseBlockingFieldMapping(migration, semanticMappingDismissed) &&
    typeof pending_gate_type === "string" &&
    pending_gate_payload
  ) {
    return wrapPipelineStep(
      <StepPause
        migrationId={migrationId}
        stepKey={pending_gate_type}
        payload={(pending_gate_payload ?? {}) as Record<string, unknown>}
        onAdvanced={
          isSemanticMappingStepKey(pending_gate_type)
            ? handleSemanticMappingContinued
            : onRefresh
        }
        allNodes={migration.nodes}
      />,
    );
  }

  // Field Structure Review (GATE 1) — after semantic Continue or awaiting_review.
  if (fieldMappingControls.show && fieldMappingControls.payload) {
    const fmPayload = (
      displayGatePayload && displayGateType === "field_mapping"
        ? displayGatePayload
        : fieldMappingControls.payload
    ) as MigrationFieldMappingGatePayload;
    return wrapPipelineStep(
      <>
        <GateFieldMapping
          key={`${migrationId}:${fieldMappingDraftEnvelope?.meta?.savedAt ?? "pending-draft"}`}
          migrationId={migrationId}
          payload={fmPayload}
          fieldMappingDraft={fieldMappingDraftEnvelope}
          onSubmitted={handleFieldMappingSubmitted}
          onReloadStatus={onRefresh}
          pipelineStatus={status}
          submitReady={fieldMappingControls.submitReady}
          submitBlockedReason={fieldMappingSubmitBlocked}
          deferUntilAwaitingReview={fieldMappingControls.deferProceed}
          onDeferredProceed={handleFieldMappingDeferredProceed}
          onApplyTier2Continue={handleApplyTier2Continue}
          embeddedRail={embeddedRail}
          t1Snapshot={
            preSemanticSnapshots.length > 0 ? preSemanticSnapshots[preSemanticSnapshots.length - 1] : undefined
          }
        />
        {autoAdvanceError ? (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {autoAdvanceError}
            <button
              type="button"
              onClick={() => void handleApplyTier2Continue(
                fieldMappingDraftEnvelope?.body ??
                  ({ flagged: {}, unmapped: {} } as MigrationGateFieldMappingRequest),
              )}
              className="ml-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
            >
              Retry Apply Tier-2
            </button>
          </div>
        ) : null}
      </>,
    );
  }

  // Node 2 flow should not require an extra "Next node" pause screen before semantic gate.
  // If pre-semantic review payload is ready, render the gate directly as a single step.
  if (displayGatePayload && displayGateType === "pre_semantic") {
    return wrapPipelineStep(
        <GatePreSemantic
          migrationId={migrationId}
          payload={effectiveGatePayload as MigrationPreSemanticGatePayload}
          onSubmitted={handlePreSemanticSubmitted}
          onFieldFocus={(terms) => onFieldFocus?.(terms, 2)}
          node2Output={node2OutputPayload ?? undefined}
        />
    );
  }

  // Auto-advance transition states (hide separate pause screen).
  if (shouldAutoAdvanceNode2 || shouldAutoAdvanceHierarchyDetection) {
    const transitionTitle = shouldAutoAdvanceHierarchyDetection
      ? "Loading hierarchy verification…"
      : "Loading mapping results…";
    const transitionSubtitle = shouldAutoAdvanceHierarchyDetection
      ? "Hierarchy detection complete — preparing verification gate…"
      : "Deterministic mapping complete — preparing review…";
    const retryLabel = shouldAutoAdvanceHierarchyDetection
      ? "Retry continue to verification"
      : "Retry continue";
    return wrapPipelineStep(
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3">
            <Loader size={18} className="animate-spin text-indigo-500" />
            <div>
              <div className="text-sm font-semibold text-slate-800">{transitionTitle}</div>
              <div className="text-xs text-slate-500 mt-0.5">{transitionSubtitle}</div>
            </div>
          </div>
          {autoAdvanceError ? (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {autoAdvanceError}
              <button
                type="button"
                onClick={() => autoAdvanceMigration({ migrationId })}
                disabled={isAutoAdvancingNode2}
                className="ml-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {retryLabel}
              </button>
            </div>
          ) : null}
        </div>
    );
  }

  if (shouldAutoFinalizeWriteGate) {
    return wrapPipelineStep(
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3">
            <Loader size={18} className="animate-spin text-indigo-500" />
            <div>
              <div className="text-sm font-semibold text-slate-800">Finalizing migration handoff…</div>
              <div className="text-xs text-slate-500 mt-0.5">Auto-confirming final write gate to keep pipeline moving.</div>
            </div>
          </div>
          {autoFinalizeError ? (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {autoFinalizeError}
              <button
                type="button"
                onClick={() => autoFinalizeMigration({ migrationId, body: { confirmed: true } })}
                disabled={isAutoFinalizing}
                className="ml-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Retry final handoff
              </button>
            </div>
          ) : null}
        </div>
    );
  }

  // ── Step pause (node finished, user reviews output) ────────────────────────
  // Step keys always start with "step_" (e.g. step_4_semantic). Gate keys are
  // pre_semantic / field_mapping / hierarchy / final_confirmation.
  // Do NOT use displayGateType here — it may be incorrectly inferred from
  // the step_paused payload structure.
  const showHitlGate =
    !!displayGatePayload &&
    !!displayGateType &&
    (status === "awaiting_review" || (fieldMappingLatchActive && displayGateType === "field_mapping"));

  if (fieldMappingLatchActive && displayGateType === "field_mapping" && displayGatePayload) {
    return wrapPipelineStep(
      <>
        <GateFieldMapping
          key={`${migrationId}:${fieldMappingDraftEnvelope?.meta?.savedAt ?? "pending-draft"}`}
          migrationId={migrationId}
          payload={displayGatePayload as MigrationFieldMappingGatePayload}
          fieldMappingDraft={fieldMappingDraftEnvelope}
          onSubmitted={handleFieldMappingSubmitted}
          onReloadStatus={onRefresh}
          pipelineStatus={status}
          submitReady={fieldMappingSubmitReady}
          submitBlockedReason={fieldMappingSubmitBlocked}
          deferUntilAwaitingReview={fieldMappingDeferUntilGate}
          onDeferredProceed={handleFieldMappingDeferredProceed}
          onApplyTier2Continue={handleApplyTier2Continue}
          embeddedRail={embeddedRail}
          t1Snapshot={preSemanticSnapshots.length > 0 ? preSemanticSnapshots[preSemanticSnapshots.length - 1] : undefined}
        />
        {autoAdvanceError ? (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {autoAdvanceError}
            <button
              type="button"
              onClick={() => void handleApplyTier2Continue(
                fieldMappingDraftEnvelope?.body ??
                  ({ flagged: {}, unmapped: {} } as MigrationGateFieldMappingRequest),
              )}
              className="ml-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
            >
              Retry Apply Tier-2
            </button>
          </div>
        ) : null}
      </>,
    );
  }

  if (showHitlGate) {
    if (displayGateType === "pre_semantic") {
      return wrapPipelineStep(
        <GatePreSemantic
          migrationId={migrationId}
          payload={displayGatePayload as MigrationPreSemanticGatePayload}
          onSubmitted={handlePreSemanticSubmitted}
          onFieldFocus={(terms) => onFieldFocus?.(terms, 2)}
          node2Output={node2OutputPayload ?? undefined}
        />,
      );
    }
    if (displayGateType === "field_mapping") {
      return wrapPipelineStep(
        <GateFieldMapping
          key={`${migrationId}:${fieldMappingDraftEnvelope?.meta?.savedAt ?? "pending-draft"}`}
          migrationId={migrationId}
          payload={displayGatePayload as MigrationFieldMappingGatePayload}
          fieldMappingDraft={fieldMappingDraftEnvelope}
          onSubmitted={handleFieldMappingSubmitted}
          onReloadStatus={onRefresh}
          pipelineStatus={status}
          submitReady={fieldMappingSubmitReady}
          submitBlockedReason={fieldMappingSubmitBlocked}
          deferUntilAwaitingReview={fieldMappingDeferUntilGate}
          onDeferredProceed={handleFieldMappingDeferredProceed}
          onApplyTier2Continue={handleApplyTier2Continue}
          embeddedRail={embeddedRail}
          t1Snapshot={preSemanticSnapshots.length > 0 ? preSemanticSnapshots[preSemanticSnapshots.length - 1] : undefined}
        />,
      );
    }
    if (displayGateType === "hierarchy") {
      // detectionSnapshot used to be passed here so the gate could render the
      // step-7 snapshot inline, but that produced a duplicate of the
      // "Hierarchy detection" card already shown in the Completed Steps block
      // above the gate. The gate now focuses on the confirm/reject UI.
      return wrapPipelineStep(
        <GateHierarchy
          migrationId={migrationId}
          payload={displayGatePayload as MigrationHierarchyGatePayload}
          onSubmitted={handleHierarchySubmitted}
          pipelineStatus={status}
        />,
      );
    }
    if (displayGateType === "final_confirmation") {
      return wrapPipelineStep(
        <GateFinal
          migrationId={migrationId}
          payload={displayGatePayload as MigrationFinalGatePayload}
          onSubmitted={handleFinalSubmitted}
          onReset={onReset}
          migrationName={migration.cmms_name}
          pipelineStatus={status}
        />,
      );
    }
  }

  if (status === "awaiting_review" && pending_gate_type) {
    return wrapPipelineStep(
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <h2 className="text-base font-bold text-slate-800 mb-2">
            Awaiting review:{" "}
            <code className="font-mono text-indigo-600">{pending_gate_type}</code>
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <GatePayloadViewer value={pending_gate_payload} />
          </div>
        </div>
    );
  }

  const displayCurrentStep = (() => {
    if (migration.current_step > 0) return migration.current_step;
    const runningNode = (migration.nodes ?? []).find((n) =>
      String(n.status ?? "").toLowerCase().includes("running"),
    );
    if (runningNode) return runningNode.node_id;
    const lastWithLogs = [...(migration.nodes ?? [])].reverse().find((n) => (n.logs?.length ?? 0) > 0);
    if (lastWithLogs) return lastWithLogs.node_id;
    return migration.current_step;
  })();

  if (prematurePreprocessPoll) {
    return wrapPipelineStep(
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3">
            <Loader size={18} className="animate-spin text-indigo-500" />
            <div>
              <div className="text-sm font-semibold text-slate-800">Preparing field mapping review…</div>
              <div className="text-xs text-slate-500 mt-0.5">
                The pipeline reported preprocess early — waiting for the field mapping gate before you can continue.
              </div>
            </div>
          </div>
        </div>
    );
  }

  const pendingSemanticDraft = fieldMappingDraftEnvelope?.body ?? null;
  // The Tier-2 "Applying decisions…" banner is supposed to flash for the
  // brief window between the pre-semantic gate and the field-mapping gate.
  // We also exit early when the pipeline has already produced terminal
  // artefacts or moved past the field-mapping gate — otherwise the banner
  // sticks around even though the work is done (the bug user reported).
  //   - hasOutputArtifacts / isEffectivelyComplete are computed near the
  //     top of the renderer (around line 893–904)
  //   - past Node 6 (preprocess) the field-mapping gate has already opened
  //     or been auto-submitted, so there's nothing more to "apply"
  const pipelinePastFieldMapping = (migration.current_step ?? 0) >= 6;
  if (
    status === "running" &&
    semanticMappingDismissed &&
    pendingSemanticDraft &&
    !fieldMappingGateDismissed &&
    !isEffectivelyComplete &&
    !hasOutputArtifacts &&
    !pipelinePastFieldMapping
  ) {
    return wrapPipelineStep(
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="flex items-center gap-3">
          <Loader size={18} className="animate-spin text-indigo-500" />
          <div>
            <div className="text-sm font-semibold text-slate-800">Applying Tier-2 mapping decisions…</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Your table and column choices are saved. The pipeline will open Field Mapping review shortly and submit
              them automatically.
            </div>
          </div>
        </div>
      </div>,
    );
  }

  if (
    status === "step_paused" &&
    typeof pending_gate_type === "string" &&
    pending_gate_payload &&
    !shouldAutoAdvanceNode2 &&
    !shouldAutoAdvanceHierarchyDetection &&
    !shouldOrchestratorAutoAdvanceStepPause &&
    !isStepPauseBlockingFieldMapping(migration, semanticMappingDismissed)
  ) {
    return wrapPipelineStep(
      <StepPause
        migrationId={migrationId}
        stepKey={normalizeStepKeyForHistory(pending_gate_type)}
        payload={(pending_gate_payload ?? {}) as Record<string, unknown>}
        onAdvanced={onRefresh}
        allNodes={migration.nodes}
      />,
    );
  }

  // ── Running ────────────────────────────────────────────────────────────────
  const runningHint = (() => {
    if (isPreSemanticGatePending(migration)) {
      return "Preparing Pre-Semantic Review — the Tier-1 review form will open when the gate is ready.";
    }
    if (displayCurrentStep === 3 || (migration.current_step ?? 0) <= 3) {
      return "Preparing Pre-Semantic Review — the Tier-1 review form will open when the gate is ready.";
    }
    if ((migration.current_step ?? 0) >= 7) {
      return "Preparing Hierarchy Review — detected relationships will appear when the gate is ready.";
    }
    return NODE_LABELS[displayCurrentStep] ?? `Processing… · ${Math.round(migration.progress_pct)}% complete`;
  })();

  return wrapPipelineStep(
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-8 flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
          <Loader size={28} className="text-indigo-500 animate-spin" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Migration running…</h2>
          <p className="text-sm text-slate-500 mt-1">{runningHint}</p>
        </div>
        <div className="w-full max-w-sm h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${migration.progress_pct}%` }}
          />
        </div>
        <p className="text-xs text-slate-400">Auto-refreshing every 2 seconds…</p>
      </div>
  );
}
