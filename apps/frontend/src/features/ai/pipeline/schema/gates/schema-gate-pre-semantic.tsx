"use client";
import { useRef, useState } from "react";
import {
  GitBranch, CheckCircle, ChevronDown, ChevronUp, ArrowRight, AlertTriangle,
} from "lucide-react";
import {
  schemaMapperApi,
  useSchemaMappingAdvance,
  useSchemaMappingGatePreSemantic,
  type SchemaPreSemanticGatePayload,
  type SchemaPreSemanticItem,
} from "../../../chat-api";
import type { SchemaReviewFocus } from "../review-focus";
import { sortTableNames } from "../schema-table-sort";

type SchemaGatePreSemanticBody = {
  decisions: Array<{
    source_table: string;
    source_field: string;
    decision: "approve" | "semantic";
    target_field?: string;
  }>;
  /** Fiix source table → chosen CAFM target table (only when changed from the default). */
  table_overrides?: Record<string, string>;
  /** Fiix source table → NEW CAFM table name to create for it. */
  new_tables?: Record<string, string>;
  /** New-table columns to CREATE with explicit SQL types: source table → column defs. */
  new_columns?: Record<
    string,
    Array<{ source_field: string; column_name: string; data_type: string }>
  >;
};

interface Props {
  sessionId: string;
  payload: SchemaPreSemanticGatePayload;
  onSubmitted: () => void;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
  readOnly?: boolean;
}

const TIER_META: Record<string, string> = {
  T1_exact:    "bg-green-100 text-green-800",
  T1_alias:    "bg-blue-100 text-blue-800",
  T1_regex:    "bg-purple-100 text-purple-800",
  T1_registry: "bg-teal-100 text-teal-800",
  T1_llm:      "bg-indigo-100 text-indigo-800",
};

/** SQL types offered for new-table columns. */
const DATA_TYPES = [
  "VARCHAR(255)", "TEXT", "INTEGER", "BIGINT", "NUMERIC", "BOOLEAN", "DATE", "TIMESTAMP",
];

/** snake_case a header for a NEW column name: "Trip ID" → "trip_id". */
const snakeColumn = (s: string) =>
  (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "column";

/** Best-guess SQL type from a Fiix column name + source type (editable in the dropdown). */
function inferDataType(field: string, sourceType?: string): string {
  const st = (sourceType || "").toLowerCase();
  if (/(timestamp|datetime)/.test(st)) return "TIMESTAMP";
  if (/date/.test(st)) return "DATE";
  if (/(bool|bit)/.test(st)) return "BOOLEAN";
  if (/(int|serial)/.test(st)) return "INTEGER";
  if (/(numeric|decimal|double|float|real|money)/.test(st)) return "NUMERIC";
  const f = (field || "").toLowerCase();
  if (/(^dtm|timestamp|datetime|created|updated|modified|_at\b)/.test(f)) return "TIMESTAMP";
  if (/(date|dob|^dtm)/.test(f)) return "DATE";
  if (/(^bol|^bln|is_|flag|active|enabled|deactivated)/.test(f)) return "BOOLEAN";
  if (/(^dbl|^flt|amount|price|cost|total|rate|latitude|longitude|qty|quantity|balance)/.test(f)) return "NUMERIC";
  if (/(^int|^id$|_id\b|count|number|^qty)/.test(f)) return "INTEGER";
  return "VARCHAR(255)";
}

export default function SchemaGatePreSemantic({
  sessionId,
  payload,
  onSubmitted,
  reviewFocus,
  onReviewFocusChange,
  readOnly = false,
}: Props) {
  const itemsByTable = payload.items_by_table ?? {};
  const allTables = sortTableNames(Object.keys(itemsByTable));
  const targetTableBySource = payload.target_table_by_source ?? {};
  const newTableBySource = payload.new_table_by_source ?? {};
  const sourceColumnsByTable = payload.source_columns_by_table ?? {};
  const canonicalColumnsByTable = payload.canonical_columns_by_table ?? {};
  // Step-1 routing covers EVERY Fiix object (incl. fully-new tables with no reviewable
  // columns), not just the tables that have column-review items.
  const NEW_TABLE = "__new__"; // sentinel: "create a new CAFM table"
  const allSourceTables = sortTableNames(
    payload.all_source_tables ??
      Array.from(
        new Set([
          ...Object.keys(itemsByTable),
          ...Object.keys(targetTableBySource),
          ...Object.keys(newTableBySource),
        ]),
      ),
  );
  // Per-field target-column override from the dropdown. key `${tbl}.${field}` → column.
  const [fieldRenames, setFieldRenames] = useState<Record<string, string>>({});

  // Detect many-to-one: same target field mapped from 2+ source fields (same or different tables)
  const manyToOneTargets = (() => {
    const targetMap = new Map<string, Array<{ source_table: string; source_field: string; confidence: number }>>();
    for (const [tbl, items] of Object.entries(itemsByTable)) {
      for (const item of items as SchemaPreSemanticItem[]) {
        const target = item.target_field.trim();
        if (!target) continue;
        const existing = targetMap.get(target) ?? [];
        targetMap.set(target, [...existing, { source_table: tbl, source_field: item.source_field, confidence: item.confidence ?? 0 }]);
      }
    }
    const result = new Map<string, Array<{ source_table: string; source_field: string; confidence: number }>>();
    for (const [target, sources] of targetMap.entries()) {
      if (sources.length >= 2) result.set(target, sources);
    }
    return result;
  })();

  const [decisions, setDecisions] = useState<Record<string, "approve" | "semantic">>(() => {
    const init: Record<string, "approve" | "semantic"> = {};
    for (const [tbl, items] of Object.entries(itemsByTable)) {
      for (const item of items) {
        init[`${tbl}.${item.source_field}`] = "approve";
      }
    }
    return init;
  });
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set(allTables));
  const [error, setError] = useState<string | null>(null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const lastSubmitRef = useRef<SchemaGatePreSemanticBody | null>(null);

  const { mutate: submitGate, isPending: isSubmitPending } = useSchemaMappingGatePreSemantic({
    onSuccess: () => {
      lastSubmitRef.current = null;
      onSubmitted();
    },
    onError: (err: unknown) => {
      lastSubmitRef.current = null;
      setError(err instanceof Error ? err.message : "Submission failed");
    },
  });
  const { mutate: advanceSchema, isPending: isAdvancing } = useSchemaMappingAdvance({
    onSuccess: () => {
      setError(null);
      const pending = lastSubmitRef.current;
      if (pending) {
        submitGate({ schemaMappingId: sessionId, body: pending });
      }
    },
    onError: (err: unknown) => {
      lastSubmitRef.current = null;
      setError(`Pipeline advance failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });
  const isPending = isSubmitPending || isAdvancing || isPreflighting;

  function toggleTable(tbl: string) {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tbl)) next.delete(tbl);
      else next.add(tbl);
      return next;
    });
  }

  function setDecision(tbl: string, field: string, action: "approve" | "semantic") {
    setDecisions((prev) => ({ ...prev, [`${tbl}.${field}`]: action }));
  }

  function approveAllMapped() {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const [tbl, items] of Object.entries(itemsByTable)) {
        for (const item of items) next[`${tbl}.${item.source_field}`] = "approve";
      }
      return next;
    });
  }

  function sendAllToSemantic() {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const [tbl, items] of Object.entries(itemsByTable)) {
        for (const item of items) next[`${tbl}.${item.source_field}`] = "semantic";
      }
      return next;
    });
  }

  function handleSubmit() {
    const list = allTables.flatMap((tbl) =>
      (itemsByTable[tbl] ?? []).map((item: SchemaPreSemanticItem) => {
        const renamed = (fieldRenames[`${tbl}.${item.source_field}`] ?? "").trim();
        return {
          source_table: tbl,
          source_field: item.source_field,
          decision: decisions[`${tbl}.${item.source_field}`] ?? "approve",
          ...(renamed && renamed !== item.target_field ? { target_field: renamed } : {}),
        };
      })
    );
    // Routing: an existing-table choice changed from the default → table_overrides;
    // a "create new table" choice → new_tables (Fiix object → new CAFM table name).
    const tableOverrides: Record<string, string> = {};
    const newTables: Record<string, string> = {};
    for (const tbl of allSourceTables) {
      const chosen = (tableTargets[tbl] ?? "").trim();
      if (chosen === NEW_TABLE) {
        const name = (newTableNames[tbl] ?? "").trim();
        if (name) newTables[tbl] = name;
        continue;
      }
      const original = (targetTableBySource[tbl] ?? "").trim();
      if (chosen && chosen !== original) tableOverrides[tbl] = chosen;
    }
    // New table → emit a typed column def for each of its source columns.
    const newColumns: Record<
      string,
      Array<{ source_field: string; column_name: string; data_type: string }>
    > = {};
    for (const tbl of allSourceTables) {
      if ((tableTargets[tbl] ?? "") !== NEW_TABLE) continue;
      const cols = (sourceColumnsByTable[tbl] ?? []).map((c) => ({
        source_field: c.field_name,
        column_name: snakeColumn(c.field_name),
        data_type: newColumnTypes[`${tbl}.${c.field_name}`] ?? inferDataType(c.field_name, c.data_type),
      }));
      if (cols.length) newColumns[tbl] = cols;
    }
    const body: SchemaGatePreSemanticBody = {
      decisions: list,
      ...(Object.keys(tableOverrides).length ? { table_overrides: tableOverrides } : {}),
      ...(Object.keys(newTables).length ? { new_tables: newTables } : {}),
      ...(Object.keys(newColumns).length ? { new_columns: newColumns } : {}),
    };
    lastSubmitRef.current = body;
    setError(null);
    setIsPreflighting(true);
    // The schema-mapper endpoint rejects POST /gate/pre-semantic when the session
    // is in `step_paused` (between node completion and gate ready). Preflight the
    // current status — advance the pipeline first if paused, then submit.
    schemaMapperApi
      .getSchemaMappingStatus(sessionId)
      .then((latest) => {
        const status = String(latest.status ?? "").toLowerCase();
        if (status === "failed" || status === "ddl_failed" || status === "cancelled") {
          lastSubmitRef.current = null;
          onSubmitted();
          return;
        }
        if (status === "step_paused") {
          advanceSchema({ schemaMappingId: sessionId });
          return;
        }
        if (status !== "awaiting_review" && status !== "running") {
          lastSubmitRef.current = null;
          setError(`Cannot submit pre-semantic decisions yet. Current status: ${status}`);
          return;
        }
        submitGate({ schemaMappingId: sessionId, body });
      })
      .catch((err: unknown) => {
        lastSubmitRef.current = null;
        setError(err instanceof Error ? err.message : "Could not read schema mapping status");
      })
      .finally(() => {
        setIsPreflighting(false);
      });
  }

  const countApproved = Object.values(decisions).filter((v) => v === "approve").length;
  const countSemantic = Object.values(decisions).filter((v) => v === "semantic").length;
  const total = Object.values(itemsByTable).flat().length;

  // ── Two-phase gate: Step 1 = Fiix table → CAFM table routing; Step 2 = columns.
  const existingCanonicalTables = payload.existing_canonical_tables ?? [];
  const [phase, setPhase] = useState<"tables" | "columns">("tables");
  // Chosen CAFM target per Fiix source table. Existing match → that table; otherwise the
  // NEW_TABLE sentinel (a new CAFM table will be created, name from newTableNames).
  const [tableTargets, setTableTargets] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of allSourceTables) {
      init[t] = targetTableBySource[t] ? targetTableBySource[t] : NEW_TABLE;
    }
    return init;
  });
  // Editable new-table names (used when a row's target is NEW_TABLE).
  const [newTableNames, setNewTableNames] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of allSourceTables) {
      if (!targetTableBySource[t]) init[t] = newTableBySource[t] ?? "";
    }
    return init;
  });
  // SQL type chosen for each NEW-table column. key `${tbl}.${field}` → data type.
  const [newColumnTypes, setNewColumnTypes] = useState<Record<string, string>>({});
  const normCol = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Re-match a table's columns when its CAFM target changes (exact column → approve;
  // no counterpart → semantic), mirroring the migration flow.
  function applyTableTarget(tbl: string, target: string) {
    setTableTargets((prev) => ({ ...prev, [tbl]: target }));
    if (target === NEW_TABLE) {
      // New table → its columns are created downstream (Node 4); nothing to re-match here.
      if (!newTableNames[tbl]) {
        setNewTableNames((prev) => ({ ...prev, [tbl]: newTableBySource[tbl] ?? "" }));
      }
      return;
    }
    const key = Object.keys(canonicalColumnsByTable).find((k) => k.toLowerCase() === target.toLowerCase());
    const cols = key ? canonicalColumnsByTable[key] : [];
    if (!cols.length) return;
    const byNorm = new Map(cols.map((c) => [normCol(c), c]));
    const items = itemsByTable[tbl] ?? [];
    setFieldRenames((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const hit = byNorm.get(normCol(it.source_field));
        if (hit) next[`${tbl}.${it.source_field}`] = hit;
      }
      return next;
    });
    setDecisions((prev) => {
      const next = { ...prev };
      for (const it of items) {
        next[`${tbl}.${it.source_field}`] = byNorm.has(normCol(it.source_field)) ? "approve" : "semantic";
      }
      return next;
    });
  }
  const routingComplete = allSourceTables.every((t) => {
    const tgt = tableTargets[t] ?? "";
    if (tgt === NEW_TABLE) return (newTableNames[t] ?? "").trim().length > 0;
    return tgt.trim().length > 0;
  });

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
          <GitBranch size={20} className="text-amber-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900">
            {phase === "tables" ? "Step 1 — Confirm table mapping (Fiix → CAFM)" : "Step 2 — Column mapping"}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {phase === "tables"
              ? "Each Fiix object is mapped to a CAFM table. Change a target if needed, then confirm to review column matches."
              : "Approve confident Tier-1 matches or send uncertain ones to Tier-2 semantic search."}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold font-mono text-slate-800">
            {phase === "tables" ? allTables.length : total}
          </div>
          <div className="text-xs text-slate-500">{phase === "tables" ? "tables" : "fields to review"}</div>
        </div>
      </div>

      {phase === "tables" ? (
        <div className="mb-6">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
            {allSourceTables.map((tbl) => {
              const target = tableTargets[tbl] ?? "";
              const isNew = target === NEW_TABLE;
              return (
                <div key={tbl} className="px-5 py-4 flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{tbl}</span>
                  <ArrowRight size={12} className="text-slate-300 shrink-0" />
                  <select
                    value={isNew ? NEW_TABLE : target}
                    onChange={(e) => applyTableTarget(tbl, e.target.value)}
                    title="CAFM target table — pick an existing table or create a new one"
                    className={`font-mono text-xs px-2 py-1 rounded border focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                      isNew
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                        : target
                        ? "border-indigo-100 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    <option value={NEW_TABLE}>➕ Create new table…</option>
                    <optgroup label="Existing CAFM tables">
                      {existingCanonicalTables.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </optgroup>
                  </select>
                  {isNew && (
                    <input
                      type="text"
                      value={newTableNames[tbl] ?? ""}
                      onChange={(e) =>
                        setNewTableNames((prev) => ({ ...prev, [tbl]: e.target.value }))
                      }
                      placeholder="new_table_name"
                      title="Name for the new CAFM table"
                      className="font-mono text-xs px-2 py-1 rounded border border-indigo-200 bg-white text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 w-48"
                    />
                  )}
                  {isNew && (
                    <span className="text-[9px] uppercase tracking-wide text-indigo-400 font-semibold">new</span>
                  )}
                  <span className="text-[10px] text-slate-400 ml-auto">
                    {(itemsByTable[tbl] ?? []).length} columns
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end mt-4">
            <button
              onClick={() => setPhase("columns")}
              disabled={!routingComplete || readOnly}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Confirm table mapping
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      ) : (
      <>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setPhase("tables")}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowRight size={13} className="rotate-180" />
          Back to table mapping
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {[
          { label: "Approved",  value: countApproved, color: "text-green-600" },
          { label: "→ Semantic",value: countSemantic, color: "text-blue-600" },
          { label: "Skipped",   value: 0,             color: "text-slate-500" },
          { label: "Tables",    value: allTables.length, color: "text-slate-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 text-center">
            <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {total > 0 && (
        <div className="flex justify-end gap-2 mb-4">
          <button
            onClick={sendAllToSemantic}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            <GitBranch size={14} />
            Send all to Semantic
          </button>
          <button
            onClick={approveAllMapped}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            <CheckCircle size={14} />
            Approve all T1 matched
          </button>
        </div>
      )}

      {/* Many-to-one conflict banner */}
      {manyToOneTargets.size > 0 && (
        <details className="mb-4 rounded-xl border border-orange-200 bg-orange-50 overflow-hidden">
          <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none text-sm font-semibold text-orange-800 select-none">
            <AlertTriangle size={14} className="text-orange-500 shrink-0" />
            Many-to-one conflicts — {manyToOneTargets.size} target {manyToOneTargets.size === 1 ? "field" : "fields"} mapped from multiple sources
            <ChevronDown size={14} className="text-orange-400 ml-auto" />
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-3">
            {Array.from(manyToOneTargets.entries()).map(([target, sources]) => (
              <div key={target} className="rounded-lg bg-white border border-orange-200 p-3">
                <div className="text-xs font-semibold text-orange-800 font-mono mb-2">{target}</div>
                <div className="space-y-1">
                  {sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{s.source_table}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-slate-700">{s.source_field}</span>
                      <span className="ml-auto font-mono text-slate-400">{Math.round(s.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* New tables — define each column + its SQL type (created on write) */}
      {allSourceTables.filter(
        (t) => (tableTargets[t] ?? "") === NEW_TABLE && (sourceColumnsByTable[t] ?? []).length > 0,
      ).length > 0 && (
        <div className="space-y-3 mb-6">
          {allSourceTables
            .filter((t) => (tableTargets[t] ?? "") === NEW_TABLE && (sourceColumnsByTable[t] ?? []).length > 0)
            .map((tbl) => {
              const cols = sourceColumnsByTable[tbl] ?? [];
              const isOpen = expandedTables.has(tbl);
              return (
                <div key={`new-${tbl}`} className="rounded-xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-indigo-50/40 transition-colors text-left"
                    onClick={() => toggleTable(tbl)}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{tbl}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <ArrowRight size={11} className="text-slate-300" />
                        <span className="font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">{newTableNames[tbl] || "new_table"}</span>
                        <span className="text-[9px] uppercase tracking-wide text-indigo-400 font-semibold">new</span>
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        {cols.length} columns
                      </span>
                    </div>
                    {isOpen
                      ? <ChevronUp size={16} className="text-slate-400 shrink-0" />
                      : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {cols.map((c) => {
                        const k = `${tbl}.${c.field_name}`;
                        const dtype = newColumnTypes[k] ?? inferDataType(c.field_name, c.data_type);
                        return (
                          <div key={c.field_name} className="px-5 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500">{c.field_name}</span>
                              <ArrowRight size={11} className="text-slate-300 shrink-0" />
                              <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">{snakeColumn(c.field_name)}</span>
                              <select
                                value={dtype}
                                onChange={(e) =>
                                  setNewColumnTypes((prev) => ({ ...prev, [k]: e.target.value }))
                                }
                                title="SQL type for the new column"
                                className="font-mono text-xs px-2 py-1 rounded border border-indigo-200 bg-white text-indigo-700 w-36 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              >
                                {(DATA_TYPES.includes(dtype) ? DATA_TYPES : [dtype, ...DATA_TYPES]).map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                              <CheckCircle size={12} />new column
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Table cards */}
      <div className="space-y-3 mb-6">
        {allTables.map((tbl) => {
          const items: SchemaPreSemanticItem[] = itemsByTable[tbl] ?? [];
          const isOpen = expandedTables.has(tbl);
          const targetTable = tableTargets[tbl] ?? targetTableBySource[tbl] ?? "";
          const targetColsKey = Object.keys(canonicalColumnsByTable).find(
            (k) => k.toLowerCase() === targetTable.toLowerCase(),
          );
          const targetCols = targetColsKey ? canonicalColumnsByTable[targetColsKey] : [];
          const allApproved = items.every(
            (item) => (decisions[`${tbl}.${item.source_field}`] ?? "approve") === "approve"
          );

          return (
            <div key={tbl} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                onClick={() => toggleTable(tbl)}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm">{tbl}</span>
                  {targetTable && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <ArrowRight size={11} className="text-slate-300" />
                      <span className="font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">{targetTable}</span>
                    </span>
                  )}
                  {items.length > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      {items.length} T1
                    </span>
                  )}
                  {allApproved && items.length > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      All approved
                    </span>
                  )}
                </div>
                {isOpen
                  ? <ChevronUp size={16} className="text-slate-400 shrink-0" />
                  : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {items.map((item, idx) => {
                    const key = `${tbl}.${item.source_field}`;
                    const action = decisions[key] ?? "approve";
                    const isFocused =
                      reviewFocus?.scope === "deterministic" &&
                      reviewFocus.sourceTable === tbl &&
                      reviewFocus.sourceField === item.source_field;
                    const confPct = Math.round((item.confidence ?? 0) * 100);
                    const tierColor = TIER_META[item.tier] ?? "bg-slate-100 text-slate-600";

                    return (
                      <div
                        key={idx}
                        className={`px-5 py-3 flex items-start gap-4 transition-colors ${
                          isFocused ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
                        }`}
                        onClick={() =>
                          onReviewFocusChange({
                            scope: "deterministic",
                            sourceTable: tbl,
                            sourceField: item.source_field,
                            targetField: item.target_field,
                            nodeHint: 2,
                          })
                        }
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                              {item.source_field}
                            </span>
                            <ArrowRight size={11} className="text-slate-300 shrink-0" />
                            {targetCols.length ? (
                              <select
                                value={fieldRenames[key] ?? item.target_field}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setFieldRenames((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                title="Target column on the CAFM table — change to remap"
                                className={`font-mono text-xs px-2 py-1 rounded border focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                                  (fieldRenames[key] ?? item.target_field) !== item.target_field
                                    ? "border-amber-300 bg-amber-50 text-amber-800"
                                    : "border-indigo-100 bg-indigo-50 text-indigo-700"
                                }`}
                              >
                                {(() => {
                                  const cur = fieldRenames[key] ?? item.target_field;
                                  const opts = targetCols.includes(cur) ? targetCols : [cur, ...targetCols];
                                  return opts.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ));
                                })()}
                              </select>
                            ) : (
                              <span className="font-mono text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                                {item.target_field}
                              </span>
                            )}
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tierColor}`}>
                              {item.tier.replace("T1_", "")}
                            </span>
                            <span className={`text-xs font-mono font-semibold ${
                              confPct >= 95 ? "text-green-600" : confPct >= 85 ? "text-amber-600" : "text-red-500"
                            }`}>{confPct}%</span>
                            {manyToOneTargets.has(item.target_field) && (() => {
                              const others = (manyToOneTargets.get(item.target_field) ?? []).filter(
                                (s) => !(s.source_table === tbl && s.source_field === item.source_field)
                              );
                              return others.length > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                                  <AlertTriangle size={9} />
                                  {others.length === 1
                                    ? `Also from ${others[0].source_table}.${others[0].source_field}`
                                    : `Also from ${others.length} other sources`}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          {item.rationale && (
                            <p className="text-xs text-slate-400 mt-1 truncate">{item.rationale}</p>
                          )}
                        </div>
                        <div className="flex gap-1.5 shrink-0 pt-0.5">
                          <button
                            onClick={() => setDecision(tbl, item.source_field, "approve")}
                            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                              action === "approve" ? "bg-green-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            <CheckCircle size={12} />Approve
                          </button>
                          <button
                            onClick={() => {
                              setDecision(tbl, item.source_field, "semantic");
                              onReviewFocusChange({
                                scope: "deterministic",
                                sourceTable: tbl,
                                sourceField: item.source_field,
                                targetField: item.target_field,
                                nodeHint: 2,
                              });
                            }}
                            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                              action === "semantic" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            <GitBranch size={12} />Semantic
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && !readOnly && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!readOnly ? (
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white text-base font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <CheckCircle size={18} />
              Submit Review — {countApproved} approved · {countSemantic} → semantic
            </>
          )}
        </button>
      ) : null}
      </>
      )}
    </div>
  );
}
