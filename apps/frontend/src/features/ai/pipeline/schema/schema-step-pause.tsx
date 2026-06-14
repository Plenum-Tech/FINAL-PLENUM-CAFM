"use client";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Zap,
  Hash,
  Sparkles,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  GitBranch,
  Layers,
} from "lucide-react";
import { useSchemaMappingAdvance } from "../../chat-api";
import type { SchemaReviewFocus } from "./review-focus";
import { sortTableNames } from "./schema-table-sort";
import SchemaTablesTree, { parseSchemaTablesFromPayload } from "./schema-tables-tree";

interface Props {
  sessionId: string;
  stepKey: string;
  payload: Record<string, unknown>;
  onAdvanced: () => void;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
  /** Completed-step history: same UI as pause, without Continue. */
  readOnly?: boolean;
  completedLabel?: string;
  embeddedRail?: boolean;
  onFieldFocus?: (terms: string[]) => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function readRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string");
}

function readRecordArray(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const it of v) {
    const r = readRecord(it);
    if (r) out.push(r);
  }
  return out;
}

/** semantic_results may be an array or a per-table object from the backend. */
function readSemanticResults(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return readRecordArray(v);
  const byTable = readRecord(v);
  if (!byTable) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const [table, items] of Object.entries(byTable)) {
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const r = readRecord(it);
      if (!r) continue;
      out.push({
        ...r,
        table: readString(r.table) ?? readString(r.source_table) ?? table,
        source_table: readString(r.source_table) ?? table,
      });
    }
  }
  return out;
}

function pct(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

const NODE_LABELS: Record<string, string> = {
  step_0_canonical:          "Canonical Schema",
  step_1_ingest:             "Schema Ingestion",
  step_2_deterministic:      "Deterministic Mapping",
  step_2_5_preprocess:       "Preprocessing",
  step_3_semantic:           "Semantic Mapping",
  step_4_semantic:           "Semantic Mapping",
  step_4_semantic_mapping:   "Semantic Mapping",
  step_4_human_review:       "Review Prep",
  step_5_hierarchy:          "Hierarchy Detection",
  step_6_hierarchy:          "Hierarchy Detection",
  step_6_hierarchy_detection:"Hierarchy Detection",
  step_6_verify_hierarchy:   "Hierarchy Verification",
  step_7_output:             "Output Generation",
  step_8_output:             "Output Generation",
  step_8_output_generation:  "Output Generation",
  step_8_write:              "Write to Database",
  step_9_finalize:           "Finalize",
};

function Metric({ label, value, accent }: { label: string; value: unknown; accent: string }) {
  const colors: Record<string, string> = {
    indigo: "text-indigo-600 bg-indigo-50",
    green:  "text-green-600 bg-green-50",
    amber:  "text-amber-600 bg-amber-50",
    red:    "text-red-600 bg-red-50",
  };
  return (
    <div className={`rounded-lg px-4 py-3 ${colors[accent] ?? colors.indigo}`}>
      <div className="text-2xl font-bold font-mono">{String(value ?? "—")}</div>
      <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
    </div>
  );
}

function DataTable({
  rows,
  columns,
}: {
  rows: Array<Record<string, unknown>>;
  columns: Array<{ key: string; label: string; render?: (v: unknown, row: Record<string, unknown>) => React.ReactNode }>;
}) {
  const shown = rows.slice(0, 50);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="text-left px-3 py-2 text-slate-600 font-semibold whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map((r, idx) => (
            <tr key={idx} className="hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 text-slate-700 align-top">
                  {c.render ? c.render(r[c.key], r) : String(r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? (
        <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-200 bg-slate-50">
          Showing first {shown.length} rows
        </div>
      ) : null}
    </div>
  );
}

function Step0Canonical({ payload }: { payload: Record<string, unknown> }) {
  const tablesCount = readNumber(payload.canonical_table_count) ?? 0;
  const colsCount = readNumber(payload.canonical_column_count) ?? 0;
  const tables = parseSchemaTablesFromPayload(payload);

  return (
    <div className="space-y-4 w-full">
      <p className="text-xs text-slate-500">
        Target platform database — not Fiix. These counts are what schema mapping maps into.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Metric label="plenum_cafm tables" value={tablesCount} accent="indigo" />
        <Metric label="plenum_cafm columns" value={colsCount} accent="indigo" />
      </div>
      <SchemaTablesTree title="plenum_cafm schema (target)" tables={tables} schemaLabel="plenum_cafm" />
    </div>
  );
}

function Step1Ingest({ payload }: { payload: Record<string, unknown> }) {
  const tableCount = readNumber(payload.table_count) ?? 0;
  const totalColumns = readNumber(payload.total_columns) ?? 0;
  const name = readString(payload.external_cmms_name) ?? "—";
  const tables = parseSchemaTablesFromPayload(payload);

  return (
    <div className="space-y-4 w-full">
      <p className="text-xs text-slate-500">
        Live external CMMS schema from {name !== "—" ? name : "Fiix"} — source fields to map into plenum_cafm.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric label={`${name !== "—" ? name : "Fiix"} tables`} value={tableCount} accent="amber" />
        <Metric label={`${name !== "—" ? name : "Fiix"} columns`} value={totalColumns} accent="amber" />
        <Metric label="CMMS" value={name} accent="amber" />
      </div>
      <SchemaTablesTree
        title={`${name !== "—" ? name : "Fiix"} schema (source)`}
        tables={tables}
        schemaLabel={name !== "—" ? name : "Fiix"}
      />
    </div>
  );
}

function Step2Deterministic({
  payload,
  reviewFocus,
  onReviewFocusChange,
}: {
  payload: Record<string, unknown>;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
}) {
  const mapped = readNumber(payload.tier1_mapped) ?? readNumber(payload.t1_mapped) ?? 0;
  const unresolved = readNumber(payload.unresolved) ?? 0;
  const mappingsByTable = readRecord(payload.mappings_by_table) ?? {};
  const unresolvedByTable = readRecord(payload.unresolved_by_table) ?? {};
  const tables = sortTableNames([
    ...Object.keys(mappingsByTable),
    ...Object.keys(unresolvedByTable),
  ]);
  const [expandedTable, setExpandedTable] = useState<string | null>(tables[0] ?? null);

  const allMappings = Object.values(mappingsByTable).flatMap((v) => readRecordArray(v));
  const tierCounts = allMappings.reduce<Record<string, number>>((acc, r) => {
    const tier = readString(r.tier) ?? "unknown";
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});

  const TIER_META: Record<string, { label: string; pill: string; icon: React.ReactNode }> = {
    T1_exact:     { label: "Exact",     pill: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle size={10} /> },
    T1_alias:     { label: "Alias",     pill: "bg-blue-100 text-blue-800 border-blue-200",         icon: <Zap size={10} /> },
    T1_regex:     { label: "Regex",     pill: "bg-purple-100 text-purple-800 border-purple-200",   icon: <Hash size={10} /> },
    T1_registry:  { label: "Registry",  pill: "bg-teal-100 text-teal-800 border-teal-200",         icon: <Sparkles size={10} /> },
    T1_llm:       { label: "LLM",       pill: "bg-indigo-100 text-indigo-800 border-indigo-200",   icon: <Sparkles size={10} /> },
  };

  const tierPills = Object.entries(tierCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">T1 matched</div>
          <div className="mt-1 text-3xl font-bold font-mono text-emerald-700">{mapped}</div>
          <div className="mt-1 text-xs text-slate-500">Deterministic rules (exact, alias, regex, registry, LLM)</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">To semantic</div>
          <div className="mt-1 text-3xl font-bold font-mono text-amber-700">{unresolved}</div>
          <div className="mt-1 text-xs text-slate-500">Unresolved fields will be sent to semantic matching</div>
        </div>
      </div>

      {tierPills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tierPills.map(([tier, count]) => {
            const meta = TIER_META[tier] ?? { label: tier, pill: "bg-slate-100 text-slate-700 border-slate-200", icon: null };
            return (
              <span
                key={tier}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${meta.pill}`}
              >
                {meta.icon}
                {meta.label}: <span className="font-mono font-bold">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="h-7 w-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <Search size={14} className="text-indigo-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-indigo-900">Mapping preview</div>
            <div className="mt-0.5 text-xs text-indigo-700">
              {mapped} fields matched in Tier-1. {unresolved} unresolved fields will continue to the next node.
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {tables.map((tbl) => {
          const isOpen = expandedTable === tbl;
          const mappedRows = readRecordArray(mappingsByTable[tbl]);
          const unresolvedFields = readStringArray(unresolvedByTable[tbl]);
          const previewRows = mappedRows.slice(0, 3).map((r) => ({
            source_field: readString(r.source_field) ?? "—",
            target_field: readString(r.target_field) ?? "—",
            tier: readString(r.tier) ?? "unknown",
            confidence: readNumber(r.confidence),
          }));

          return (
            <div key={tbl} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                onClick={() => setExpandedTable(isOpen ? null : tbl)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-slate-800 truncate">{tbl}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    {mappedRows.length} mapped
                  </span>
                  {unresolvedFields.length ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      {unresolvedFields.length} unresolved
                    </span>
                  ) : null}
                </div>
                {isOpen ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
              </button>

              {isOpen ? (
                <div className="border-t border-slate-100 px-4 py-4 space-y-4">
                  {previewRows.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Top matches</div>
                      <div className="space-y-2">
                        {previewRows.map((r, i) => {
                          const meta = TIER_META[r.tier] ?? { label: r.tier, pill: "bg-white text-slate-700 border-slate-200", icon: null };
                          const pct = r.confidence == null ? null : Math.round(r.confidence * 100);
                          const isFocused =
                            reviewFocus?.scope === "deterministic" &&
                            reviewFocus.sourceTable === tbl &&
                            reviewFocus.sourceField === r.source_field;
                          return (
                            <button
                              key={`${r.source_field}:${i}`}
                              type="button"
                              className={`flex items-center gap-2 flex-wrap rounded-lg px-2 py-1 text-left transition-colors ${
                                isFocused ? "bg-indigo-100/80" : "hover:bg-white"
                              }`}
                              onClick={() =>
                                onReviewFocusChange({
                                  scope: "deterministic",
                                  sourceTable: tbl,
                                  sourceField: r.source_field,
                                  targetField: r.target_field,
                                  nodeHint: 2,
                                })
                              }
                            >
                              <span className="font-mono text-xs bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded">
                                {r.source_field}
                              </span>
                              <ArrowRight size={12} className="text-slate-300" />
                              <span className="font-mono text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded">
                                {r.target_field}
                              </span>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.pill}`}>
                                {meta.icon}
                                {meta.label}
                              </span>
                              <span className="text-[11px] font-mono font-semibold text-slate-600">
                                {pct == null ? "—" : `${pct}%`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {mappedRows.length ? (
                    <DataTable
                      rows={mappedRows}
                      columns={[
                        { key: "tier", label: "Tier", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                        { key: "confidence", label: "Confidence", render: (v) => {
                          const n = typeof v === "number" ? v : Number(v);
                          return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
                        }},
                        { key: "source_field", label: "Source field", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                        { key: "target_field", label: "Target field", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                      ]}
                    />
                  ) : (
                    <div className="text-sm text-slate-500">No mapped fields.</div>
                  )}

                  {unresolvedFields.length ? (
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Unresolved fields</div>
                      <DataTable
                        rows={unresolvedFields.map((f) => ({ source_field: f, next_step: "semantic" }))}
                        columns={[
                          {
                            key: "source_field",
                            label: "Source field",
                            render: (v) => {
                              const field = String(v ?? "—");
                              const isFocused =
                                reviewFocus?.scope === "deterministic" &&
                                reviewFocus.sourceTable === tbl &&
                                reviewFocus.sourceField === field;
                              return (
                                <button
                                  type="button"
                                  className={`font-mono text-left rounded px-1 -mx-1 transition-colors ${
                                    isFocused ? "bg-indigo-100 text-indigo-800" : "hover:bg-slate-100"
                                  }`}
                                  onClick={() =>
                                    onReviewFocusChange({
                                      scope: "deterministic",
                                      sourceTable: tbl,
                                      sourceField: field,
                                      nodeHint: 2,
                                    })
                                  }
                                >
                                  {field}
                                </button>
                              );
                            },
                          },
                          {
                            key: "next_step",
                            label: "Next step",
                            render: () => (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">
                                Semantic mapping
                              </span>
                            ),
                          },
                        ]}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Step25Preprocess({ payload }: { payload: Record<string, unknown> }) {
  const totalOriginal =
    readNumber(payload.total_original_rows) ??
    readNumber(payload.total_rows_original) ??
    readNumber(payload.original_rows) ??
    null;
  const totalPost =
    readNumber(payload.total_rows_post_dedup) ??
    readNumber(payload.total_rows_cleaned) ??
    readNumber(payload.cleaned_rows) ??
    null;
  const dropped =
    readNumber(payload.total_dedup_drop_count) ??
    readNumber(payload.dedup_drop_count) ??
    readNumber(payload.dropped_rows) ??
    null;
  const ratioRaw =
    readNumber(payload.overall_dedup_ratio) ??
    readNumber(payload.dedup_ratio) ??
    readNumber(payload.overall_ratio) ??
    null;

  const duration = readNumber(payload.duration_ms) ?? null;
  const warnings = readStringArray(payload.data_quality_warnings ?? payload.validation_warnings ?? null);

  const tableMetrics = readRecordArray(payload.table_metrics ?? payload.tables ?? null);

  const detectedFkColumns = readRecord(payload.detected_fk_columns ?? payload.fk_columns ?? payload.detected_foreign_keys ?? null);
  const fkByTable = detectedFkColumns
    ? Object.entries(detectedFkColumns).map(([table, cols]) => ({
      table,
      cols: Array.isArray(cols) ? cols.filter((c) => typeof c === "string") : [],
    }))
    : [];

  const logs = readStringArray(payload.execution_logs ?? payload.logs ?? null);

  const ratioPct =
    ratioRaw == null ? null : Math.max(0, Math.min(1, ratioRaw)) * 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Metric label="Original rows" value={totalOriginal ?? "—"} accent="indigo" />
        <Metric label="Rows after cleanup" value={totalPost ?? "—"} accent="green" />
        <Metric label="Dropped" value={dropped ?? "—"} accent="amber" />
        <Metric label="Dedup ratio" value={ratioPct == null ? "—" : `${ratioPct.toFixed(1)}%`} accent="indigo" />
      </div>

      {tableMetrics.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">Table metrics</div>
            <div className="mt-0.5 text-xs text-slate-500">Preprocessing and validation summary per table.</div>
          </div>
          <div className="p-4">
            <DataTable
              rows={tableMetrics}
              columns={[
                { key: "table_name", label: "Table", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "original_row_count", label: "Original" },
                { key: "post_dedup_row_count", label: "After" },
                { key: "dedup_drop_count", label: "Dropped" },
                { key: "dedup_ratio", label: "Ratio", render: (v) => pct(v) },
                { key: "date_coercions", label: "Date fixes" },
                { key: "null_fills_applied", label: "Null fills" },
                {
                  key: "validation_warnings",
                  label: "Warnings",
                  render: (v) => (Array.isArray(v) ? String(v.length) : "0"),
                },
              ]}
            />
          </div>
        </div>
      )}

      {fkByTable.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="h-7 w-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <GitBranch size={14} className="text-indigo-600" />
            </div>
            <div className="min-w-0 w-full">
              <div className="text-sm font-semibold text-indigo-900">Potential FK columns detected</div>
              <div className="mt-2 space-y-2">
                {fkByTable.slice(0, 10).map((t) => (
                  <div key={t.table} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-indigo-800">{t.table}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(t.cols ?? []).slice(0, 12).map((c) => (
                        <span
                          key={`${t.table}:${c}`}
                          className="text-[11px] bg-white text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-full font-mono"
                        >
                          {c}
                        </span>
                      ))}
                      {(t.cols ?? []).length > 12 && (
                        <span className="text-[11px] text-indigo-700">+{(t.cols ?? []).length - 12} more</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="h-7 w-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={14} className="text-amber-600" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-amber-900">Warnings</div>
              <div className="mt-1 space-y-1">
                {warnings.slice(0, 6).map((w, i) => (
                  <div key={`${i}-${w}`} className="text-xs text-amber-800 font-mono break-words">{w}</div>
                ))}
                {warnings.length > 6 && <div className="text-[11px] text-amber-700">+{warnings.length - 6} more</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {(duration != null || logs.length > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">Execution summary</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {duration == null ? "Key log lines for this step." : `Duration: ${duration.toFixed(1)}ms`}
            </div>
          </div>
          <div className="p-4 space-y-1">
            {logs.slice(0, 10).map((l, i) => (
              <div key={`${i}-${l}`} className="text-xs text-slate-700 font-mono break-words">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Step3Semantic({
  payload,
  reviewFocus,
  onReviewFocusChange,
}: {
  payload: Record<string, unknown>;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
}) {
  const results = readSemanticResults(payload.semantic_results ?? payload.results ?? payload.rows);
  const countsFromPayload = {
    auto: readNumber(payload.t2_auto) ?? readNumber(payload.auto_accepted) ?? null,
    flagged: readNumber(payload.flagged) ?? readNumber(payload.low_confidence) ?? null,
    unmappable: readNumber(payload.unmappable) ?? readNumber(payload.unmappable_count) ?? null,
  };

  const normalized = results.map((r) => {
    const table = readString(r.table) ?? readString(r.source_table) ?? "(unknown)";
    const sourceField = readString(r.source_field) ?? readString(r.field) ?? "—";
    const targetField = readString(r.target_field) ?? readString(r.mapped_to) ?? null;
    const confidence = readNumber(r.confidence) ?? (typeof r.confidence === "string" ? Number(r.confidence) : null);
    const tier = readString(r.tier) ?? readString(r.method) ?? "T2_semantic";
    const status = readString(r.status) ?? readString(r.decision) ?? "auto";
    return { table, sourceField, targetField, confidence, tier, status };
  });

  const auto = normalized.filter((r) => r.status === "auto" || r.status === "accept" || r.status === "accepted");
  const flagged = normalized.filter((r) => r.status === "flagged" || r.status === "review");
  const unmappable = normalized.filter((r) => r.status === "unmappable" || r.status === "reject" || r.status === "rejected");

  const [filter, setFilter] = useState<"all" | "auto" | "flagged" | "unmappable">("all");
  const visible =
    filter === "all" ? normalized
    : filter === "auto" ? auto
    : filter === "flagged" ? flagged
    : unmappable;

  const byTable = visible.reduce<Record<string, typeof visible>>((acc, r) => {
    acc[r.table] = acc[r.table] ?? [];
    acc[r.table].push(r);
    return acc;
  }, {});
  const tables = sortTableNames(Object.keys(byTable));
  const [open, setOpen] = useState<string | null>(tables[0] ?? null);

  const autoCount = countsFromPayload.auto ?? auto.length;
  const flaggedCount = countsFromPayload.flagged ?? flagged.length;
  const unmappableCount = countsFromPayload.unmappable ?? unmappable.length;

  function statusPill(st: string) {
    const s = st.toLowerCase();
    if (s.includes("flag")) return "bg-amber-100 text-amber-800 border-amber-200";
    if (s.includes("unmapp") || s.includes("reject")) return "bg-red-100 text-red-800 border-red-200";
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Auto accepted</div>
          <div className="mt-1 text-3xl font-bold font-mono text-emerald-700">{autoCount}</div>
          <div className="mt-1 text-xs text-slate-500">High-confidence semantic matches</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Flagged</div>
          <div className="mt-1 text-3xl font-bold font-mono text-amber-700">{flaggedCount}</div>
          <div className="mt-1 text-xs text-slate-500">Needs review in the next gate</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-red-700 uppercase tracking-wider">Unmappable</div>
          <div className="mt-1 text-3xl font-bold font-mono text-red-700">{unmappableCount}</div>
          <div className="mt-1 text-xs text-slate-500">No safe canonical match found</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <GitBranch size={14} className="text-slate-500" />
          <div className="text-sm font-semibold text-slate-800">Semantic results</div>
          <div className="ml-auto flex items-center gap-2">
            {([
              { id: "all", label: `All (${normalized.length})` },
              { id: "auto", label: `Auto (${auto.length})` },
              { id: "flagged", label: `Flagged (${flagged.length})` },
              { id: "unmappable", label: `Unmappable (${unmappable.length})` },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  filter === t.id
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 space-y-2">
          {tables.length === 0 ? (
            <div className="text-sm text-slate-500">No semantic results found.</div>
          ) : (
            tables.slice(0, 30).map((tbl) => {
              const isOpen = open === tbl;
              const rows = byTable[tbl] ?? [];
              const autoN = rows.filter((r) => r.status === "auto" || r.status === "accept" || r.status === "accepted").length;
              const flaggedN = rows.filter((r) => r.status === "flagged" || r.status === "review").length;
              const unmapN = rows.filter((r) => r.status === "unmappable" || r.status === "reject" || r.status === "rejected").length;
              return (
                <div key={tbl} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                    onClick={() => setOpen(isOpen ? null : tbl)}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{tbl}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {autoN > 0 && (
                          <span className="text-[11px] bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full font-mono">
                            auto {autoN}
                          </span>
                        )}
                        {flaggedN > 0 && (
                          <span className="text-[11px] bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full font-mono">
                            flagged {flaggedN}
                          </span>
                        )}
                        {unmapN > 0 && (
                          <span className="text-[11px] bg-red-100 text-red-800 border border-red-200 px-2 py-0.5 rounded-full font-mono">
                            unmappable {unmapN}
                          </span>
                        )}
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 px-4 py-4">
                      <div className="rounded-xl border border-slate-200 bg-white overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr className="text-left text-slate-600">
                              <th className="px-3 py-2 font-semibold whitespace-nowrap">source_field</th>
                              <th className="px-3 py-2 font-semibold whitespace-nowrap">target_field</th>
                              <th className="px-3 py-2 font-semibold whitespace-nowrap">confidence</th>
                              <th className="px-3 py-2 font-semibold whitespace-nowrap">tier</th>
                              <th className="px-3 py-2 font-semibold whitespace-nowrap">status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rows.slice(0, 60).map((r, i) => (
                              <tr
                                key={`${r.sourceField}:${i}`}
                                className={`cursor-pointer hover:bg-slate-50 ${
                                  reviewFocus?.scope === "semantic" &&
                                  reviewFocus.sourceTable === tbl &&
                                  reviewFocus.sourceField === r.sourceField
                                    ? "bg-indigo-50"
                                    : ""
                                }`}
                                onClick={() =>
                                  onReviewFocusChange({
                                    scope: "semantic",
                                    sourceTable: tbl,
                                    sourceField: r.sourceField,
                                    targetField: r.targetField,
                                    nodeHint: 3,
                                  })
                                }
                              >
                                <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">{r.sourceField}</td>
                                <td className="px-3 py-2 font-mono text-indigo-700 whitespace-nowrap">{r.targetField ?? "—"}</td>
                                <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">{pct(r.confidence ?? null)}</td>
                                <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{r.tier}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${statusPill(r.status)}`}>
                                    {r.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rows.length > 60 && (
                          <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-200 bg-slate-50">
                            Showing first 60 rows
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Step4HumanReview({ payload }: { payload: Record<string, unknown> }) {
  const flaggedRaw = payload.flagged_mappings ?? payload.low_confidence_tier2 ?? payload.low_confidence ?? null;
  const unmappedRaw = payload.unmapped_fields ?? payload.unmapped ?? null;
  const unstructuredRaw = payload.unstructured_candidates ?? payload.unstructured ?? null;

  const flaggedByTableRecord = readRecord(flaggedRaw);
  const unmappedByTableRecord = readRecord(unmappedRaw);
  const unstructuredByTableRecord = readRecord(unstructuredRaw);

  const flaggedItems =
    Array.isArray(flaggedRaw) ? readRecordArray(flaggedRaw)
    : flaggedByTableRecord ? Object.values(flaggedByTableRecord).flatMap((v) => readRecordArray(v))
    : [];
  const unmappedItems =
    Array.isArray(unmappedRaw) ? readRecordArray(unmappedRaw)
    : unmappedByTableRecord ? Object.values(unmappedByTableRecord).flatMap((v) => readRecordArray(v))
    : [];
  const unstructuredItems =
    Array.isArray(unstructuredRaw) ? readRecordArray(unstructuredRaw)
    : unstructuredByTableRecord ? Object.values(unstructuredByTableRecord).flatMap((v) => readRecordArray(v))
    : [];

  const flaggedByTable = new Map<string, Array<Record<string, unknown>>>();
  const unmappedByTable = new Map<string, Array<Record<string, unknown>>>();
  const unstructuredByTable = new Map<string, Array<Record<string, unknown>>>();

  function pushByTable(map: Map<string, Array<Record<string, unknown>>>, r: Record<string, unknown>, fallbackTable: string) {
    const t = readString(r.source_table) ?? readString(r.table) ?? fallbackTable;
    const prev = map.get(t) ?? [];
    prev.push(r);
    map.set(t, prev);
  }

  for (const r of flaggedItems) pushByTable(flaggedByTable, r, "(unknown)");
  for (const r of unmappedItems) pushByTable(unmappedByTable, r, "(unknown)");
  for (const r of unstructuredItems) pushByTable(unstructuredByTable, r, "(unknown)");

  const tables = sortTableNames([
    ...flaggedByTable.keys(),
    ...unmappedByTable.keys(),
    ...unstructuredByTable.keys(),
  ]).filter((t) => t !== "(unknown)");

  const tablesAffected = tables.length + (flaggedByTable.has("(unknown)") || unmappedByTable.has("(unknown)") || unstructuredByTable.has("(unknown)") ? 1 : 0);

  const [tab, setTab] = useState<"flagged" | "unmapped" | "unstructured">(
    flaggedItems.length ? "flagged" : unmappedItems.length ? "unmapped" : "unstructured",
  );
  const tableKeys = [
    ...sortTableNames(tables),
    ...(flaggedByTable.has("(unknown)") || unmappedByTable.has("(unknown)") || unstructuredByTable.has("(unknown)")
      ? ["(unknown)"]
      : []),
  ];
  const [open, setOpen] = useState<string | null>(tableKeys[0] ?? null);

  function rowsFor(table: string) {
    if (tab === "flagged") return flaggedByTable.get(table) ?? [];
    if (tab === "unmapped") return unmappedByTable.get(table) ?? [];
    return unstructuredByTable.get(table) ?? [];
  }

  function countFor(table: string) {
    return rowsFor(table).length;
  }

  const totalFlagged = flaggedItems.length;
  const totalUnmapped = unmappedItems.length;
  const totalUnstructured = unstructuredItems.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Flagged</div>
          <div className="mt-1 text-3xl font-bold font-mono text-amber-700">{totalFlagged}</div>
          <div className="mt-1 text-xs text-slate-500">Low-confidence mappings</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-red-700 uppercase tracking-wider">Unmapped</div>
          <div className="mt-1 text-3xl font-bold font-mono text-red-700">{totalUnmapped}</div>
          <div className="mt-1 text-xs text-slate-500">Fields with no target</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Tables</div>
          <div className="mt-1 text-3xl font-bold font-mono text-slate-800">{tablesAffected}</div>
          <div className="mt-1 text-xs text-slate-500">Tables needing review</div>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle size={14} className="text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-900">Ready for Gate 1 — Field Mapping Review</div>
            <div className="mt-0.5 text-xs text-emerald-700">
              Next step will ask you to approve, reject or override these suggestions.
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-800">Review items</div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setTab("flagged"); setOpen(tableKeys[0] ?? null); }}
              disabled={!totalFlagged}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                tab === "flagged"
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              }`}
            >
              Flagged ({totalFlagged})
            </button>
            <button
              type="button"
              onClick={() => { setTab("unmapped"); setOpen(tableKeys[0] ?? null); }}
              disabled={!totalUnmapped}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                tab === "unmapped"
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              }`}
            >
              Unmapped ({totalUnmapped})
            </button>
            <button
              type="button"
              onClick={() => { setTab("unstructured"); setOpen(tableKeys[0] ?? null); }}
              disabled={!totalUnstructured}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                tab === "unstructured"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              }`}
            >
              Unstructured ({totalUnstructured})
            </button>
          </div>
        </div>

        <div className="p-4 space-y-2">
          {tableKeys.length === 0 ? (
            <div className="text-sm text-slate-500">No review items found.</div>
          ) : (
            sortTableNames(tableKeys.filter((t) => countFor(t) > 0))
              .slice(0, 30)
              .map((tbl) => {
                const isOpen = open === tbl;
                const rows = rowsFor(tbl);
                return (
                  <div key={tbl} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                      onClick={() => setOpen(isOpen ? null : tbl)}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800 truncate">{tbl}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{rows.length} item{rows.length !== 1 ? "s" : ""}</div>
                      </div>
                      {isOpen ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-100 px-4 py-4 space-y-3">
                        {tab === "flagged" && (
                          <DataTable
                            rows={rows.slice(0, 80)}
                            columns={[
                              { key: "source_field", label: "Source field", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                              { key: "target_field", label: "Target field", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                              { key: "confidence", label: "Confidence", render: (v) => pct(v) },
                              { key: "tier", label: "Tier", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                            ]}
                          />
                        )}
                        {tab === "unmapped" && (
                          <DataTable
                            rows={rows.slice(0, 80)}
                            columns={[
                              { key: "source_field", label: "Source field", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                              { key: "data_type_hint", label: "Type hint", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                              { key: "nullable", label: "Nullable", render: (v) => String(v ?? "—") },
                            ]}
                          />
                        )}
                        {tab === "unstructured" && (
                          <DataTable
                            rows={rows.slice(0, 80)}
                            columns={[
                              { key: "source_field", label: "Source field", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                              { key: "target_field", label: "Target field", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                              { key: "confidence", label: "Confidence", render: (v) => pct(v) },
                            ]}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })
          )}

          {tableKeys.filter((t) => countFor(t) > 0).length === 0 && (
            <div className="text-sm text-slate-500">No items for this tab.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Step5Hierarchy({ payload }: { payload: Record<string, unknown> }) {
  const totalFks = readNumber(payload.total_fks) ?? readNumber(payload.fk_count) ?? null;
  const canonicalBackedFks = readNumber(payload.canonical_backed_fks) ?? null;
  const hierarchyCount = readNumber(payload.hierarchy_count) ?? readNumber(payload.hierarchy_trees) ?? null;
  const hierarchyRoots = readStringArray(payload.hierarchy_roots);
  const detectedFks = readRecordArray(payload.detected_fks ?? payload.fk_candidates ?? payload.foreign_keys);
  const selfRefFks = readRecordArray(payload.self_referential_fks ?? payload.self_referential ?? null);
  const junctionTables = readStringArray(payload.junction_tables);

  const fkCount = totalFks ?? detectedFks.length;
  const tables = new Set<string>();
  for (const fk of detectedFks) {
    const st = readString(fk.source_table);
    const tt = readString(fk.target_table);
    if (st) tables.add(st);
    if (tt) tables.add(tt);
  }

  const [showAllFks, setShowAllFks] = useState(false);
  const fkRows = showAllFks ? detectedFks : detectedFks.slice(0, 20);

  return (
    <div className="space-y-4">
      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold font-mono text-indigo-700">{fkCount ?? "—"}</div>
          <div className="text-xs text-indigo-500 mt-0.5">Total FKs</div>
          {canonicalBackedFks != null && (
            <div className="text-xs text-indigo-400 mt-0.5">{canonicalBackedFks} canonical</div>
          )}
        </div>
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold font-mono text-purple-700">{hierarchyCount ?? "—"}</div>
          <div className="text-xs text-purple-500 mt-0.5">Hierarchy trees</div>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold font-mono text-teal-700">{junctionTables.length || "—"}</div>
          <div className="text-xs text-teal-500 mt-0.5">Junction tables</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold font-mono text-amber-700">{selfRefFks.length || "—"}</div>
          <div className="text-xs text-amber-500 mt-0.5">Self-referential</div>
        </div>
      </div>

      {/* Hierarchy roots */}
      {hierarchyRoots.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
            <div className="text-sm font-semibold text-slate-800">Hierarchy roots ({hierarchyRoots.length})</div>
            <div className="text-xs text-slate-500 mt-0.5">Root tables of detected hierarchy trees</div>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {hierarchyRoots.map((root) => (
              <span key={root} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 text-xs font-mono font-medium text-purple-800">
                <Layers size={11} className="shrink-0" />
                {root}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Self-referential FKs */}
      {selfRefFks.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <div className="text-sm font-semibold text-amber-900">Self-referential FKs ({selfRefFks.length})</div>
            <div className="text-xs text-amber-600 mt-0.5">Columns that reference their own table (parent–child trees)</div>
          </div>
          <div className="divide-y divide-slate-100">
            {selfRefFks.map((fk, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
                <span className="font-mono bg-amber-50 text-amber-800 px-2 py-0.5 rounded border border-amber-100">
                  {readString(fk.source_table) ?? "—"}
                </span>
                <span className="font-mono text-slate-500">.{readString(fk.source_column) ?? "—"}</span>
                <ArrowRight size={12} className="text-slate-300 shrink-0" />
                <span className="font-mono bg-amber-50 text-amber-800 px-2 py-0.5 rounded border border-amber-100">
                  {readString(fk.target_table) ?? readString(fk.source_table) ?? "—"}
                </span>
                <span className="font-mono text-slate-500">.{readString(fk.target_column) ?? readString(fk.referenced_column) ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Junction tables */}
      {junctionTables.length > 0 && (
        <div className="rounded-xl border border-teal-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-teal-50 border-b border-teal-100">
            <div className="text-sm font-semibold text-teal-900">Junction tables ({junctionTables.length})</div>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {junctionTables.map((t) => (
              <span key={t} className="inline-flex items-center px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-xs font-mono font-medium text-teal-800">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Detected FKs table */}
      {fkCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <AlertTriangle size={16} className="text-amber-600" />
            No foreign keys detected
          </div>
          <div className="mt-1 text-sm text-slate-500">The next gate may ask for manual hierarchy confirmation.</div>
        </div>
      ) : detectedFks.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-800">Detected foreign keys ({detectedFks.length})</div>
              <div className="text-xs text-slate-500 mt-0.5">Review will happen in the hierarchy gate.</div>
            </div>
          </div>
          <div className="p-4">
            <DataTable
              rows={fkRows}
              columns={[
                { key: "source_table", label: "Source table", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "source_column", label: "Source column", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "target_table", label: "Target table", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "target_column", label: "Target column", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "confidence", label: "Conf.", render: (v) => pct(v) },
              ]}
            />
          </div>
          {detectedFks.length > 20 && (
            <div className="px-4 pb-3">
              <button
                onClick={() => setShowAllFks((p) => !p)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {showAllFks ? `Show fewer` : `Show all ${detectedFks.length} FKs`}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Step6VerifyHierarchy({ payload }: { payload: Record<string, unknown> }) {
  const approved = readNumber(payload.hierarchies_approved) ?? readNumber(payload.approved) ?? readNumber(payload.approved_count) ?? 0;
  const cyclesResolved = readNumber(payload.cycles_resolved) ?? readNumber(payload.cycles) ?? 0;
  const hierarchyConfirmed = typeof payload.hierarchy_confirmed === "boolean" ? payload.hierarchy_confirmed : null;

  const confirmedHierarchies = readRecordArray(
    payload.confirmed_hierarchies ??
      payload.approved_hierarchies ??
      payload.hierarchies ??
      payload.decisions ??
      null,
  );
  const containment = readRecord(payload.containment_hierarchy ?? payload.hierarchy ?? payload.tree ?? null);
  const topKeys = containment ? Object.keys(containment).slice(0, 20) : [];
  const logs = Array.isArray(payload.execution_logs) ? payload.execution_logs.filter((l) => typeof l === "string") : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Confirmed</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {hierarchyConfirmed == null ? "—" : hierarchyConfirmed ? "Yes" : "No"}
          </div>
          <div className="mt-1 text-xs text-slate-500">Final hierarchy decision</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Approved</div>
          <div className="mt-1 text-3xl font-bold font-mono text-emerald-700">{approved}</div>
          <div className="mt-1 text-xs text-slate-500">Relationships accepted</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-5 py-4">
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Cycles resolved</div>
          <div className="mt-1 text-3xl font-bold font-mono text-amber-700">{cyclesResolved}</div>
          <div className="mt-1 text-xs text-slate-500">Conflicts fixed</div>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle size={14} className="text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-900">Hierarchy verification completed</div>
            <div className="mt-0.5 text-xs text-emerald-700">
              Continue to generate the final output configuration.
            </div>
          </div>
        </div>
      </div>

      {topKeys.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="h-7 w-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <Layers size={14} className="text-indigo-600" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-indigo-900">Containment hierarchy</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {topKeys.map((k) => (
                  <span
                    key={k}
                    className="text-[11px] bg-white text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-full font-mono"
                  >
                    {k}
                  </span>
                ))}
                {containment && Object.keys(containment).length > topKeys.length && (
                  <span className="text-[11px] text-indigo-700">+{Object.keys(containment).length - topKeys.length} more</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmedHierarchies.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">Confirmed relationships</div>
            <div className="mt-0.5 text-xs text-slate-500">Showing the accepted hierarchy links.</div>
          </div>
          <div className="p-4">
            <DataTable
              rows={confirmedHierarchies.slice(0, 80)}
              columns={[
                { key: "source_table", label: "Source table", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "source_column", label: "Source column", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "target_table", label: "Target table", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "target_column", label: "Target column", render: (v) => <span className="font-mono">{String(v ?? "—")}</span> },
                { key: "confidence", label: "Confidence", render: (v) => pct(v) },
              ]}
            />
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">Execution summary</div>
            <div className="mt-0.5 text-xs text-slate-500">Key log lines for this step.</div>
          </div>
          <div className="p-4 space-y-1">
            {logs.slice(0, 8).map((l, i) => (
              <div key={`${i}-${l}`} className="text-xs text-slate-700 font-mono break-words">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Step7Output({ payload }: { payload: Record<string, unknown> }) {
  const coverage = readNumber(payload.mapping_coverage_pct) ?? readNumber(payload.coverage) ?? null;
  const canonicalFields = readNumber(payload.canonical_fields_count) ?? null;
  const sourceFields = readNumber(payload.total_source_fields) ?? readNumber(payload.total_columns) ?? null;
  const t1 = readNumber(payload.tier1_auto_mapped) ?? readNumber(payload.tier1_mapped) ?? null;
  const t2 = readNumber(payload.tier2_auto_mapped) ?? readNumber(payload.tier2_mapped) ?? null;
  const flagged = readNumber(payload.tier2_flagged) ?? readNumber(payload.flagged) ?? null;
  const unmappable = readNumber(payload.unmappable) ?? null;

  const c = coverage == null ? null : Math.max(0, Math.min(coverage, 100));
  const barColor =
    c == null ? "bg-slate-400"
    : c >= 80 ? "bg-emerald-500"
    : c >= 60 ? "bg-amber-500"
    : "bg-red-500";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Metric label="Canonical fields" value={canonicalFields ?? "—"} accent="green" />
        <Metric label="Source fields" value={sourceFields ?? "—"} accent="indigo" />
        <Metric label="T1 auto-mapped" value={t1 ?? "—"} accent="indigo" />
        <Metric label="T2 auto-mapped" value={t2 ?? "—"} accent="indigo" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-slate-800">Mapping coverage</div>
          <div className="text-sm font-bold text-indigo-600">{c == null ? "—" : `${c.toFixed(1)}%`}</div>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
          <div className={`h-3 rounded-full transition-all ${barColor}`} style={{ width: `${c == null ? 0 : c}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-slate-500">
          <span>{flagged == null ? "—" : `${flagged} flagged`}</span>
          <span>{unmappable == null ? "—" : `${unmappable} unmappable`}</span>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <CheckCircle size={14} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-blue-900">Output configuration generated</div>
            <div className="mt-0.5 text-xs text-blue-700">
              Continue to write the final schema mapping to the database.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step8Write({ payload }: { payload: Record<string, unknown> }) {
  const writeOkRaw =
    payload.write_success ??
    payload.write_completed ??
    payload.wrote_mappings ??
    payload.db_write_success ??
    payload.persisted ??
    null;
  const writeOk = typeof writeOkRaw === "boolean" ? writeOkRaw : null;

  const rowsWritten =
    readNumber(payload.rows_written) ??
    readNumber(payload.mappings_written) ??
    readNumber(payload.rows_updated) ??
    readNumber(payload.rows_inserted) ??
    readNumber(payload.written_count) ??
    null;
  const tablesTouched =
    readNumber(payload.tables_written) ??
    readNumber(payload.tables_updated) ??
    readNumber(payload.tables_touched) ??
    null;
  const ddlApplied =
    readNumber(payload.ddl_applied) ??
    readNumber(payload.ddl_statements_applied) ??
    null;

  const targetTable =
    readString(payload.mapping_table) ??
    readString(payload.target_table) ??
    readString(payload.table_name) ??
    null;

  const ddlStatementsRaw = payload.ddl_statements ?? payload.ddl ?? payload.sql_statements ?? payload.sql ?? null;
  const ddlStatements =
    typeof ddlStatementsRaw === "string"
      ? ddlStatementsRaw.split("\n").filter(Boolean)
      : readStringArray(ddlStatementsRaw);

  const logs = readStringArray(payload.execution_logs ?? payload.logs ?? null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric label="Rows written" value={rowsWritten ?? "—"} accent="indigo" />
        <Metric label="Tables touched" value={tablesTouched ?? "—"} accent="indigo" />
        <Metric label="DDL applied" value={ddlApplied ?? "—"} accent="green" />
      </div>

      <div className={`rounded-xl border px-4 py-3 ${writeOk === false ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
        <div className="flex items-start gap-2">
          <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${writeOk === false ? "bg-red-100" : "bg-emerald-100"}`}>
            <CheckCircle size={14} className={writeOk === false ? "text-red-600" : "text-emerald-600"} />
          </div>
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${writeOk === false ? "text-red-900" : "text-emerald-900"}`}>
              {writeOk === null ? "Write step completed" : writeOk ? "Write successful" : "Write reported issues"}
            </div>
            <div className={`mt-0.5 text-xs ${writeOk === false ? "text-red-700" : "text-emerald-700"}`}>
              {targetTable ? `Target table: ${targetTable}` : "Mappings were persisted to the database."}
            </div>
          </div>
        </div>
      </div>

      {ddlStatements.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">DDL / SQL applied</div>
            <div className="mt-0.5 text-xs text-slate-500">Key statements executed during write.</div>
          </div>
          <div className="p-4 space-y-2">
            {ddlStatements.slice(0, 12).map((s, i) => (
              <pre key={`${i}-${s}`} className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto whitespace-pre-wrap font-mono text-slate-700">
                {s}
              </pre>
            ))}
            {ddlStatements.length > 12 && (
              <div className="text-[11px] text-slate-400">Showing first 12 statements</div>
            )}
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">Execution summary</div>
            <div className="mt-0.5 text-xs text-slate-500">Key log lines for this step.</div>
          </div>
          <div className="p-4 space-y-1">
            {logs.slice(0, 10).map((l, i) => (
              <div key={`${i}-${l}`} className="text-xs text-slate-700 font-mono break-words">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Step9Finalize({ payload }: { payload: Record<string, unknown> }) {
  const artifacts = readRecord(payload.artifacts ?? payload.outputs ?? payload.links ?? null);
  const jsonUrl = readString(payload.output_json_url) ?? readString(payload.json_url) ?? (artifacts ? readString(artifacts.json) : null);
  const configUrl = readString(payload.config_url) ?? readString(payload.mapper_config_url) ?? null;
  const reportUrl = readString(payload.report_url) ?? readString(payload.pdf_url) ?? null;
  const logs = readStringArray(payload.execution_logs ?? payload.logs ?? null);

  const stats = readRecord(payload.stats ?? payload.summary ?? null);
  const totalMappings = stats ? (readNumber(stats.total_mappings) ?? readNumber(stats.mappings) ?? null) : null;
  const coverage = stats ? (readNumber(stats.mapping_coverage_pct) ?? readNumber(stats.coverage_pct) ?? null) : null;

  const links = [
    { label: "Mapper JSON", url: jsonUrl },
    { label: "Config", url: configUrl },
    { label: "Report", url: reportUrl },
  ].filter((l) => !!l.url);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Metric label="Total mappings" value={totalMappings ?? "—"} accent="indigo" />
        <Metric label="Coverage" value={coverage == null ? "—" : `${coverage.toFixed(1)}%`} accent="green" />
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <CheckCircle size={14} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-blue-900">Finalization completed</div>
            <div className="mt-0.5 text-xs text-blue-700">
              Next step will mark the session complete and show the full results panel.
            </div>
          </div>
        </div>
      </div>

      {links.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">Outputs</div>
            <div className="mt-0.5 text-xs text-slate-500">Download/view generated artifacts.</div>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.url!}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-800">Execution summary</div>
            <div className="mt-0.5 text-xs text-slate-500">Key log lines for this step.</div>
          </div>
          <div className="p-4 space-y-1">
            {logs.slice(0, 10).map((l, i) => (
              <div key={`${i}-${l}`} className="text-xs text-slate-700 font-mono break-words">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StepGeneric() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="text-sm font-semibold text-slate-800">Step complete</div>
      <div className="mt-1 text-sm text-slate-500">Detailed output is available in the right sidebar.</div>
    </div>
  );
}

function StepBody({
  stepKey,
  payload,
  reviewFocus,
  onReviewFocusChange,
}: {
  stepKey: string;
  payload: Record<string, unknown>;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
}) {
  const normalizedKey = stepKey.toLowerCase();
  if (stepKey === "step_0_canonical") return <Step0Canonical payload={payload} />;
  if (stepKey === "step_1_ingest") return <Step1Ingest payload={payload} />;
  if (stepKey === "step_2_deterministic") {
    return (
      <Step2Deterministic
        payload={payload}
        reviewFocus={reviewFocus}
        onReviewFocusChange={onReviewFocusChange}
      />
    );
  }
  if (normalizedKey === "step_2_5_preprocess" || normalizedKey === "step_2_5_preprocess_validate") return <Step25Preprocess payload={payload} />;
  if (
    stepKey === "step_3_semantic" ||
    stepKey === "step_4_semantic" ||
    normalizedKey === "step_4_semantic_mapping"
  ) {
    return (
      <Step3Semantic
        payload={payload}
        reviewFocus={reviewFocus}
        onReviewFocusChange={onReviewFocusChange}
      />
    );
  }
  if (stepKey === "step_4_human_review") return <Step4HumanReview payload={payload} />;
  if (
    stepKey === "step_5_hierarchy" ||
    stepKey === "step_6_hierarchy" ||
    normalizedKey === "step_6_hierarchy_detection"
  ) return <Step5Hierarchy payload={payload} />;
  if (stepKey === "step_6_verify_hierarchy") return <Step6VerifyHierarchy payload={payload} />;
  if (
    stepKey === "step_7_output" ||
    stepKey === "step_8_output" ||
    normalizedKey === "step_8_output_generation"
  ) return <Step7Output payload={payload} />;
  if (
    normalizedKey === "step_8_write" ||
    normalizedKey === "step_8_write_output" ||
    normalizedKey === "step_8_write_mappings" ||
    normalizedKey === "step_8_write_to_db"
  ) {
    return <Step8Write payload={payload} />;
  }
  if (
    normalizedKey === "step_9_finalize" ||
    normalizedKey === "step_9_finalise" ||
    normalizedKey === "step_9_complete" ||
    normalizedKey === "step_9_finish"
  ) {
    return <Step9Finalize payload={payload} />;
  }
  return <StepGeneric />;
}

/** Read-only step output for completed-step history in the center panel. */
export function SchemaStepSnapshot({
  stepKey,
  payload,
  reviewFocus = null,
  onReviewFocusChange = () => {},
}: {
  stepKey: string;
  payload: Record<string, unknown>;
  reviewFocus?: SchemaReviewFocus | null;
  onReviewFocusChange?: (focus: SchemaReviewFocus | null) => void;
}) {
  return (
    <StepBody
      stepKey={stepKey}
      payload={payload}
      reviewFocus={reviewFocus}
      onReviewFocusChange={onReviewFocusChange}
    />
  );
}

export default function SchemaStepPause({
  sessionId,
  stepKey,
  payload,
  onAdvanced,
  reviewFocus,
  onReviewFocusChange,
  readOnly = false,
  completedLabel,
  embeddedRail = false,
  onFieldFocus,
}: Props) {
  const [error, setError] = useState<string | null>(null);

  const { mutate: advance, isPending } = useSchemaMappingAdvance({
    onSuccess: () => onAdvanced(),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to advance"),
  });

  const nodeTitle = completedLabel ?? NODE_LABELS[stepKey] ?? stepKey;
  const banner =
    typeof payload.title === "string"
      ? payload.title
      : typeof payload.label === "string"
        ? payload.label
        : null;

  return (
    <div className={embeddedRail ? "w-full min-w-0" : "w-full max-w-6xl"}>
      {/* Header */}
      <div className={`flex items-center gap-3 ${embeddedRail ? "mb-4" : "mb-6"}`}>
        <div
          className={`rounded-xl flex items-center justify-center shrink-0 ${
            embeddedRail ? "w-8 h-8" : "w-10 h-10"
          } ${readOnly ? "bg-emerald-100" : "bg-emerald-100"}`}
        >
          <CheckCircle size={embeddedRail ? 16 : 20} className="text-emerald-600" />
        </div>
        <div>
          <h2 className={`font-bold text-slate-900 ${embeddedRail ? "text-sm" : "text-lg"}`}>
            {nodeTitle} — Complete
          </h2>
          <p className={`text-slate-500 ${embeddedRail ? "text-xs" : "text-sm"}`}>
            {readOnly
              ? "Completed step output (scroll up anytime to compare with the active step below)."
              : "Review the output below, then continue to the next step."}
          </p>
        </div>
      </div>

      {banner && (
        <div className="mb-6 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
          {banner}
        </div>
      )}

      <div className="mb-6">
        <StepBody
          stepKey={stepKey}
          payload={payload}
          reviewFocus={reviewFocus}
          onReviewFocusChange={onReviewFocusChange}
        />
      </div>

      {error && !readOnly && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!readOnly ? (
        <button
          onClick={() => {
            onFieldFocus?.([]);
            advance({ schemaMappingId: sessionId });
          }}
          disabled={isPending}
          className={`inline-flex items-center gap-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors ${
            embeddedRail ? "px-5 py-2 text-sm" : "px-8 py-3 text-base"
          }`}
        >
          {isPending ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processing…
            </>
          ) : (
            <>
              Continue
              <ArrowRight size={18} />
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
