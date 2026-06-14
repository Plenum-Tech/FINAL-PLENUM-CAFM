"use client";
import { useState } from "react";
import {
  CheckCircle, XCircle, Edit3, Archive, PlusCircle, ChevronDown, ChevronUp,
  ArrowRight, AlertTriangle, ToggleLeft, ToggleRight, Wand2, Trash2, Table2,
  Eye, EyeOff,
} from "lucide-react";
import {
  useSchemaMappingGateFieldMapping,
  type SchemaFieldMappingGatePayload,
  type SchemaFlaggedMappingItem,
  type SchemaUnmappedFieldGateItem,
  type SchemaFieldMappingDecision,
} from "../../../chat-api";
import type { SchemaReviewFocus } from "../review-focus";
import { sortTableNames } from "../schema-table-sort";

const DATA_TYPES = [
  "VARCHAR(255)", "VARCHAR(100)", "VARCHAR(50)",
  "TEXT", "INTEGER", "BIGINT", "DECIMAL(10,2)",
  "BOOLEAN", "TIMESTAMPTZ", "DATE", "JSONB", "UUID",
];

interface Props {
  sessionId: string;
  payload: SchemaFieldMappingGatePayload;
  onSubmitted: () => void;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
  readOnly?: boolean;
}

type LowConfAction = "accept" | "reject" | "override";
type UnmappedAction = "custom" | "raw_metadata" | "skip";

interface LowConfDecision {
  action: LowConfAction;
  overrideTarget: string;
}

interface CustomDDL {
  source_field: string;
  target_table: string;
  custom_column_name: string;
  data_type: string;
  is_new_table: boolean;
  new_table_name: string;
  new_table_pk: string;
  nullable: boolean;
}

interface UnmappedDecision {
  action: UnmappedAction;
  source_field: string;
  custom: CustomDDL | null;
}

interface NewTableColumn {
  column_name: string;
  data_type: string;
  nullable: boolean;
}

interface NewTableDef {
  id: string;
  table_name: string;
  pk_col: string;
  columns: NewTableColumn[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function smartMatchCanonicalTable(sourceTable: string, canonicalTables: string[]): string {
  if (!sourceTable || canonicalTables.length === 0) return "";
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const src = norm(sourceTable);
  return canonicalTables.find((t) => norm(t) === src) ?? "";
}

function guessDataType(hint?: string): string {
  if (!hint) return "VARCHAR(255)";
  const h = hint.toLowerCase();
  if (h.includes("bigint")) return "BIGINT";
  if (h.includes("int") || h.includes("integer")) return "INTEGER";
  if (h.includes("bool")) return "BOOLEAN";
  if (h.includes("float") || h.includes("double") || h.includes("decimal") || h.includes("numeric")) return "DECIMAL(10,2)";
  if (h.includes("timestamp") || h.includes("datetime")) return "TIMESTAMPTZ";
  if (h.includes("date")) return "DATE";
  if (h.includes("json")) return "JSONB";
  if (h.includes("uuid")) return "UUID";
  if (h.includes("text") || h.includes("clob")) return "TEXT";
  return "VARCHAR(255)";
}

function emptyCustomDDL(sourceField: string, canonicalTables: string[], sourceTable?: string): CustomDDL {
  return {
    source_field: sourceField,
    target_table: sourceTable ? smartMatchCanonicalTable(sourceTable, canonicalTables) : "",
    custom_column_name: sourceField.toLowerCase().replace(/\s+/g, "_"),
    data_type: "VARCHAR(255)",
    is_new_table: false,
    new_table_name: "",
    new_table_pk: "id",
    nullable: true,
  };
}

function customDDLFromSuggestion(
  item: { source_field: string; data_type_hint?: string; nullable?: boolean; suggested_canonical_table?: string },
  canonicalTables: string[],
  sourceTable: string,
): CustomDDL {
  const suggested = item.suggested_canonical_table ?? null;
  const existsInCanonical = suggested !== null && canonicalTables.includes(suggested);
  const isNew = !existsInCanonical;
  const newTableName = isNew
    ? (suggested && !existsInCanonical ? suggested : sourceTable.toLowerCase().replace(/[^a-z0-9]/g, "_"))
    : "";
  return {
    source_field: item.source_field,
    target_table: existsInCanonical ? suggested! : "",
    custom_column_name: item.source_field.toLowerCase().replace(/[\s-]/g, "_"),
    data_type: guessDataType(item.data_type_hint),
    is_new_table: isNew,
    new_table_name: newTableName,
    new_table_pk: "id",
    nullable: item.nullable ?? true,
  };
}

function emptyNewTable(): NewTableDef {
  return {
    id: `nt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    table_name: "",
    pk_col: "id",
    columns: [{ column_name: "", data_type: "VARCHAR(255)", nullable: true }],
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SchemaGateFieldMapping({
  sessionId,
  payload,
  onSubmitted,
  reviewFocus,
  onReviewFocusChange,
  readOnly = false,
}: Props) {
  const canonicalTables = payload.existing_canonical_tables ?? [];

  // Build table-grouped low-confidence items (merge tier1 + tier2)
  const lowConfByTable: Record<string, SchemaFlaggedMappingItem[]> = {};
  for (const [table, items] of Object.entries(payload.low_confidence_tier1 ?? {})) {
    lowConfByTable[table] = [...(lowConfByTable[table] ?? []), ...items];
  }
  for (const [table, items] of Object.entries(payload.low_confidence_tier2 ?? {})) {
    lowConfByTable[table] = [...(lowConfByTable[table] ?? []), ...items];
  }
  const lowConfTables = sortTableNames(Object.keys(lowConfByTable));

  // Detect many-to-one: same target field mapped from 2+ distinct source tables
  const manyToOneTargets = (() => {
    const targetMap = new Map<string, Array<{ source_table: string; source_field: string; confidence: number | undefined }>>();
    for (const [tbl, items] of Object.entries(lowConfByTable)) {
      for (const item of items) {
        const target = (item.suggested_target ?? "").trim();
        if (!target) continue;
        const existing = targetMap.get(target) ?? [];
        targetMap.set(target, [...existing, { source_table: tbl, source_field: item.source_field, confidence: item.confidence }]);
      }
    }
    const result = new Map<string, Array<{ source_table: string; source_field: string; confidence: number | undefined }>>();
    for (const [target, sources] of targetMap.entries()) {
      if (sources.length >= 2) result.set(target, sources);
    }
    return result;
  })();

  // Build table-grouped unmapped items
  const unmappedByTableInit: Record<string, SchemaUnmappedFieldGateItem[]> = payload.unmapped_fields ?? {};
  const unmappedTables = sortTableNames(Object.keys(unmappedByTableInit));

  const allSourceTables = sortTableNames([...lowConfTables, ...unmappedTables]);

  // ── Initial state builders ────────────────────────────────────────────────
  function buildInitLowConf(): Record<string, LowConfDecision[]> {
    const out: Record<string, LowConfDecision[]> = {};
    for (const [table, items] of Object.entries(lowConfByTable)) {
      out[table] = items.map((item) => ({
        action: "accept" as LowConfAction,
        overrideTarget: item.suggested_target ?? "",
      }));
    }
    return out;
  }

  function buildInitUnmapped(): Record<string, UnmappedDecision[]> {
    const out: Record<string, UnmappedDecision[]> = {};
    for (const [table, items] of Object.entries(unmappedByTableInit)) {
      out[table] = items.map((item) => ({
        action: "custom" as UnmappedAction,
        source_field: item.source_field,
        custom: customDDLFromSuggestion(item, canonicalTables, table),
      }));
    }
    return out;
  }

  const [lowConfDecisions, setLowConfDecisions] = useState<Record<string, LowConfDecision[]>>(buildInitLowConf);
  const [unmappedDecisions, setUnmappedDecisions] = useState<Record<string, UnmappedDecision[]>>(buildInitUnmapped);
  const [tableInclusion, setTableInclusion] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allSourceTables.map((t) => [t, true]))
  );
  const [expandedLowConf, setExpandedLowConf] = useState<Set<string>>(new Set(lowConfTables));
  const [expandedUnmapped, setExpandedUnmapped] = useState<Set<string>>(new Set(unmappedTables));
  const [expandedTableCols, setExpandedTableCols] = useState<Set<string>>(new Set());
  const [newTableDefs, setNewTableDefs] = useState<NewTableDef[]>([]);
  const [activeTab, setActiveTab] = useState<"flagged" | "unmapped" | "tables">("unmapped");
  const [error, setError] = useState<string | null>(null);

  const { mutate: submitGate, isPending } = useSchemaMappingGateFieldMapping({
    onSuccess: () => onSubmitted(),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Submission failed"),
  });

  // ── New-table helpers ─────────────────────────────────────────────────────
  function addNewTable() { setNewTableDefs((prev) => [...prev, emptyNewTable()]); }
  function removeNewTable(id: string) { setNewTableDefs((prev) => prev.filter((t) => t.id !== id)); }
  function patchNewTable(id: string, patch: Partial<NewTableDef>) {
    setNewTableDefs((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }
  function addNewTableColumn(id: string) {
    setNewTableDefs((prev) => prev.map((t) =>
      t.id === id
        ? { ...t, columns: [...t.columns, { column_name: "", data_type: "VARCHAR(255)", nullable: true }] }
        : t
    ));
  }
  function updateNewTableColumn(id: string, ci: number, patch: Partial<NewTableColumn>) {
    setNewTableDefs((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      return { ...t, columns: t.columns.map((c, i) => i === ci ? { ...c, ...patch } : c) };
    }));
  }
  function removeNewTableColumn(id: string, ci: number) {
    setNewTableDefs((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      return { ...t, columns: t.columns.filter((_, i) => i !== ci) };
    }));
  }

  // ── Low-conf helpers ──────────────────────────────────────────────────────
  function setLowConfAction(table: string, idx: number, action: LowConfAction) {
    setLowConfDecisions((prev) => {
      const rows = [...(prev[table] ?? [])];
      rows[idx] = { ...rows[idx], action };
      return { ...prev, [table]: rows };
    });
  }
  function setOverrideTarget(table: string, idx: number, val: string) {
    setLowConfDecisions((prev) => {
      const rows = [...(prev[table] ?? [])];
      rows[idx] = { ...rows[idx], overrideTarget: val };
      return { ...prev, [table]: rows };
    });
  }

  // ── Unmapped helpers ──────────────────────────────────────────────────────
  function setUnmappedAction(table: string, idx: number, action: UnmappedAction) {
    setUnmappedDecisions((prev) => {
      const rows = [...(prev[table] ?? [])];
      const row = rows[idx];
      let newCustom: CustomDDL | null = null;
      if (action === "custom") {
        if (row.custom) {
          newCustom = row.custom;
        } else {
          const originalItem = unmappedByTableInit[table]?.[idx];
          newCustom = originalItem
            ? customDDLFromSuggestion(originalItem, canonicalTables, table)
            : emptyCustomDDL(row.source_field, canonicalTables, table);
        }
      }
      rows[idx] = { ...row, action, custom: newCustom };
      return { ...prev, [table]: rows };
    });
  }

  function updateCustom(table: string, idx: number, patch: Partial<CustomDDL>) {
    setUnmappedDecisions((prev) => {
      const rows = [...(prev[table] ?? [])];
      const row = rows[idx];
      rows[idx] = {
        ...row,
        custom: { ...(row.custom ?? emptyCustomDDL(row.source_field, canonicalTables, table)), ...patch },
      };
      return { ...prev, [table]: rows };
    });
  }

  function addExtraColumn(table: string) {
    setUnmappedDecisions((prev) => ({
      ...prev,
      [table]: [
        ...(prev[table] ?? []),
        { action: "custom", source_field: "", custom: emptyCustomDDL("", canonicalTables, table) },
      ],
    }));
    setExpandedUnmapped((prev) => new Set([...prev, table]));
    setExpandedTableCols((prev) => new Set([...prev, table]));
  }

  function removeRow(table: string, idx: number) {
    setUnmappedDecisions((prev) => {
      const rows = [...(prev[table] ?? [])];
      rows.splice(idx, 1);
      return { ...prev, [table]: rows };
    });
  }

  function setRowSourceField(table: string, idx: number, val: string) {
    setUnmappedDecisions((prev) => {
      const rows = [...(prev[table] ?? [])];
      rows[idx] = { ...rows[idx], source_field: val };
      if (rows[idx].custom) {
        rows[idx] = { ...rows[idx], custom: { ...rows[idx].custom!, source_field: val } };
      }
      return { ...prev, [table]: rows };
    });
  }

  function addColumnToAllTables() {
    for (const table of allSourceTables) {
      if (tableInclusion[table] !== false) addExtraColumn(table);
    }
    setActiveTab("unmapped");
  }

  function autoSelectAddColumn() {
    setUnmappedDecisions((prev) => {
      const next = { ...prev };
      for (const table of [...unmappedTables, ...Object.keys(prev)]) {
        if (tableInclusion[table] === false) continue;
        next[table] = (prev[table] ?? []).map((row) => ({
          ...row,
          action: "custom" as UnmappedAction,
          custom: row.custom ?? emptyCustomDDL(row.source_field, canonicalTables, table),
        }));
      }
      return next;
    });
  }

  function toggleTable(table: string) {
    setTableInclusion((prev) => ({ ...prev, [table]: !prev[table] }));
  }

  // Detect column name conflicts across unmapped rows (same target_table.col_name from different sources)
  const unmappedColumnConflicts = (() => {
    const colMap = new Map<string, Array<{ source_table: string; source_field: string }>>();
    for (const [tbl, rows] of Object.entries(unmappedDecisions)) {
      for (const row of rows) {
        if (row.action === "custom" && row.custom) {
          const targetTable = row.custom.is_new_table ? row.custom.new_table_name : row.custom.target_table;
          const colName = row.custom.custom_column_name;
          const key = `${targetTable}.${colName}`.toLowerCase().trim();
          if (!key || key === ".") continue;
          const existing = colMap.get(key) ?? [];
          colMap.set(key, [...existing, { source_table: tbl, source_field: row.source_field }]);
        }
      }
    }
    const result = new Map<string, Array<{ source_table: string; source_field: string }>>();
    for (const [key, sources] of colMap.entries()) {
      if (sources.length >= 2) result.set(key, sources);
    }
    return result;
  })();

  // ── Submit ────────────────────────────────────────────────────────────────
  function handleSubmit() {
    // Validate custom columns have a target
    for (const [table, rows] of Object.entries(unmappedDecisions)) {
      if (tableInclusion[table] === false) continue;
      for (const row of rows) {
        if (row.action === "custom" && row.custom && !row.custom.is_new_table && !row.custom.target_table.trim()) {
          setError(`Table "${table}": a custom column has no target table selected.`);
          return;
        }
      }
    }
    setError(null);

    const decisions: SchemaFieldMappingDecision[] = [];

    // Low-confidence decisions
    for (const [table, items] of Object.entries(lowConfByTable)) {
      const included = tableInclusion[table] !== false;
      items.forEach((item, idx) => {
        const d = lowConfDecisions[table]?.[idx];
        const action = included ? (d?.action ?? "accept") : "reject";
        const suggestedTarget = item.suggested_target ?? "";
        if (action === "accept") {
          decisions.push({ action: "accept", source_field: item.source_field, source_table: table });
        } else if (action === "override") {
          decisions.push({ action: "override", source_field: item.source_field, source_table: table, target_field: d?.overrideTarget ?? suggestedTarget });
        } else {
          decisions.push({ action: "reject", source_field: item.source_field, source_table: table });
        }
      });
    }

    // Unmapped + extra columns
    const allUnmappedTableKeys = new Set([...unmappedTables, ...Object.keys(unmappedDecisions)]);
    for (const table of allUnmappedTableKeys) {
      const included = tableInclusion[table] !== false;
      const rows = unmappedDecisions[table] ?? [];
      for (const row of rows) {
        const action = included ? row.action : "skip";
        if (action === "custom" && row.custom) {
          const c = row.custom;
          const effectiveTable = c.is_new_table ? c.new_table_name : c.target_table;
          decisions.push({
            action: "custom",
            source_field: row.source_field,
            source_table: table,
            target_table: effectiveTable,
            custom_column_name: c.custom_column_name,
            data_type: c.data_type,
            nullable: c.nullable,
            is_new_table: c.is_new_table,
            new_table_name: c.is_new_table ? c.new_table_name : undefined,
            new_table_pk: c.is_new_table ? c.new_table_pk : undefined,
          });
        } else if (action === "raw_metadata") {
          decisions.push({ action: "raw_metadata", source_field: row.source_field, source_table: table });
        } else {
          decisions.push({ action: "skip", source_field: row.source_field, source_table: table });
        }
      }
    }

    // New table definitions
    for (const nt of newTableDefs) {
      if (!nt.table_name.trim()) continue;
      for (const col of nt.columns) {
        if (!col.column_name.trim()) continue;
        decisions.push({
          action: "custom",
          source_field: col.column_name,
          source_table: `_new_table_${nt.table_name}`,
          target_table: nt.table_name,
          custom_column_name: col.column_name,
          data_type: col.data_type,
          is_new_table: true,
          new_table_pk: nt.pk_col || "id",
          nullable: col.nullable,
        });
      }
    }

    submitGate({ schemaMappingId: sessionId, body: { decisions } });
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  const totalLowConf = lowConfTables.reduce((s, t) => s + (lowConfByTable[t]?.length ?? 0), 0);
  const totalUnmapped = unmappedTables.reduce((s, t) => s + (unmappedByTableInit[t]?.length ?? 0), 0);
  const excludedCount = allSourceTables.filter((t) => tableInclusion[t] === false).length;
  const includedCount = allSourceTables.length - excludedCount;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
          <Edit3 size={20} className="text-amber-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Field Mapping Review</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Review field mappings, include/exclude source tables, and define custom columns.
          </p>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl border border-slate-200 bg-amber-50 shadow-sm p-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <div>
            <div className="text-lg font-bold font-mono text-slate-800">{totalLowConf}</div>
            <div className="text-xs text-slate-500">Low-confidence</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-red-50 shadow-sm p-3 flex items-center gap-3">
          <XCircle size={16} className="text-red-500 shrink-0" />
          <div>
            <div className="text-lg font-bold font-mono text-slate-800">{totalUnmapped}</div>
            <div className="text-xs text-slate-500">Unmapped</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-green-50 shadow-sm p-3 flex items-center gap-3">
          <Eye size={16} className="text-green-600 shrink-0" />
          <div>
            <div className="text-lg font-bold font-mono text-slate-800">{includedCount}</div>
            <div className="text-xs text-slate-500">Tables included</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 shadow-sm p-3 flex items-center gap-3">
          <EyeOff size={16} className="text-slate-400 shrink-0" />
          <div>
            <div className="text-lg font-bold font-mono text-slate-800">{excludedCount}</div>
            <div className="text-xs text-slate-500">Tables excluded</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {[
          { key: "flagged" as const, label: `Low-confidence (${totalLowConf})` },
          { key: "unmapped" as const, label: `Unmapped (${totalUnmapped})` },
          { key: "tables" as const, label: `Source tables (${allSourceTables.length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
            {tab.key === "tables" && excludedCount > 0 && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                {excludedCount} off
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── LOW-CONFIDENCE TAB ──────────────────────────────────────────────── */}
      {activeTab === "flagged" && (
        <>
          {manyToOneTargets.size > 0 && (
            <details className="mb-3 rounded-xl border border-orange-200 bg-orange-50 overflow-hidden">
              <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none text-sm font-semibold text-orange-800 select-none">
                <AlertTriangle size={14} className="text-orange-500 shrink-0" />
                Many-to-one conflicts — {manyToOneTargets.size} target {manyToOneTargets.size === 1 ? "field" : "fields"} shared across multiple source tables
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
                          {s.confidence !== undefined && (
                            <span className="ml-auto font-mono text-slate-400">{Math.round(s.confidence * 100)}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {lowConfTables.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 text-center text-slate-500 text-sm mb-6">
              No low-confidence mappings to review.
            </div>
          ) : (
            <div className="space-y-3 mb-6">
              {lowConfTables.map((table) => {
                const items = lowConfByTable[table] ?? [];
                const isOpen = expandedLowConf.has(table);
                const isIncluded = tableInclusion[table] !== false;
                const allAccepted = lowConfDecisions[table]?.every((d) => d.action === "accept");

                return (
                  <div
                    key={table}
                    className={`rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${!isIncluded ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
                      <button
                        className="flex items-center gap-3 flex-1 text-left"
                        onClick={() => setExpandedLowConf((prev) => {
                          const n = new Set(prev); if (n.has(table)) n.delete(table); else n.add(table); return n;
                        })}
                      >
                        <span className={`font-semibold text-sm font-mono ${isIncluded ? "text-slate-800" : "text-slate-400 line-through"}`}>
                          {table}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          {items.length} flagged
                        </span>
                        {allAccepted && isIncluded && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            All accepted
                          </span>
                        )}
                        {!isIncluded && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-500">
                            Excluded
                          </span>
                        )}
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        {isIncluded && (
                          <button
                            onClick={() => { addExtraColumn(table); setActiveTab("unmapped"); }}
                            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <PlusCircle size={12} />
                            Add column
                          </button>
                        )}
                        <button
                          onClick={() => toggleTable(table)}
                          className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                            isIncluded ? "text-green-700 bg-green-50 hover:bg-green-100" : "text-slate-500 bg-slate-100 hover:bg-slate-200"
                          }`}
                        >
                          {isIncluded ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                          {isIncluded ? "Included" : "Excluded"}
                        </button>
                        <button
                          onClick={() => setExpandedLowConf((prev) => {
                            const n = new Set(prev); if (n.has(table)) n.delete(table); else n.add(table); return n;
                          })}
                        >
                          {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                        </button>
                      </div>
                    </div>

                    {isOpen && isIncluded && (
                      <div className="border-t border-slate-100 divide-y divide-slate-100">
                        {items.map((item, idx) => {
                          const d = lowConfDecisions[table]?.[idx] ?? { action: "accept" as LowConfAction, overrideTarget: "" };
                          const isFocused =
                            reviewFocus?.scope === "semantic" &&
                            reviewFocus.sourceTable === table &&
                            reviewFocus.sourceField === item.source_field;
                          return (
                            <div
                              key={idx}
                              className={`px-5 py-4 transition-colors cursor-pointer ${
                                d.action === "accept" ? "bg-green-50/40" :
                                d.action === "reject" ? "bg-red-50/40" : "bg-blue-50/40"
                              } ${isFocused ? "ring-1 ring-inset ring-indigo-300" : ""}`}
                              onClick={() => onReviewFocusChange({
                                scope: "semantic",
                                sourceTable: table,
                                sourceField: item.source_field,
                                targetField: item.suggested_target,
                                nodeHint: 3,
                              })}
                            >
                              <div className="flex items-start gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                                      {item.source_field}
                                    </span>
                                    <ArrowRight size={12} className="text-slate-300" />
                                    <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                                      d.action === "reject"
                                        ? "bg-red-100 text-red-500 line-through"
                                        : "bg-indigo-50 text-indigo-700"
                                    }`}>
                                      {d.action === "override" && d.overrideTarget ? d.overrideTarget : (item.suggested_target || "—")}
                                    </span>
                                    {item.confidence !== undefined && (
                                      <ConfidenceBadge value={item.confidence} tier={item.tier ?? ""} />
                                    )}
                                    {item.suggested_target && manyToOneTargets.has(item.suggested_target) && (() => {
                                      const others = (manyToOneTargets.get(item.suggested_target) ?? []).filter(
                                        (s) => !(s.source_table === table && s.source_field === item.source_field)
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
                                    <p className="text-xs text-slate-400 mb-2">{item.rationale}</p>
                                  )}
                                  {d.action === "accept" && item.suggested_target && (
                                    <div className="flex items-center gap-1.5 text-xs text-green-700 mt-1">
                                      <CheckCircle size={12} />
                                      Mapped to <span className="font-mono font-semibold">{item.suggested_target}</span>
                                    </div>
                                  )}
                                  {d.action === "override" && (
                                    <div
                                      className="mt-2 flex items-center gap-2 max-w-sm"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <label className="text-xs font-medium text-slate-600 shrink-0">Map to</label>
                                      <input
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1"
                                        value={d.overrideTarget}
                                        onChange={(e) => setOverrideTarget(table, idx, e.target.value)}
                                        placeholder="canonical_field_name"
                                      />
                                    </div>
                                  )}
                                  {d.action === "reject" && (
                                    <p className="text-xs text-red-500 mt-1">Field will be discarded</p>
                                  )}
                                </div>
                                <div
                                  className="flex gap-1.5 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ActionBtn
                                    label="Accept"
                                    icon={<CheckCircle size={11} />}
                                    active={d.action === "accept"}
                                    activeColor="bg-green-600"
                                    onClick={() => setLowConfAction(table, idx, "accept")}
                                  />
                                  <ActionBtn
                                    label="Override"
                                    icon={<Edit3 size={11} />}
                                    active={d.action === "override"}
                                    activeColor="bg-blue-600"
                                    onClick={() => setLowConfAction(table, idx, "override")}
                                  />
                                  <ActionBtn
                                    label="Reject"
                                    icon={<XCircle size={11} />}
                                    active={d.action === "reject"}
                                    activeColor="bg-red-600"
                                    onClick={() => setLowConfAction(table, idx, "reject")}
                                  />
                                </div>
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
          )}
        </>
      )}

      {/* ── UNMAPPED TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "unmapped" && (
        <>
          {/* Batch toolbar */}
          <div className="flex items-center justify-between mb-4 px-4 py-3 bg-indigo-50 rounded-xl border border-indigo-200">
            <div>
              <p className="text-sm font-semibold text-indigo-800">Batch action</p>
              <p className="text-xs text-indigo-600">Apply the same decision to all unmapped fields at once</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={autoSelectAddColumn}
                className="flex items-center gap-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition-colors"
              >
                <Wand2 size={14} />
                Auto-select &ldquo;Add column&rdquo; for all
              </button>
              <button
                onClick={addColumnToAllTables}
                className="flex items-center gap-2 text-sm font-medium text-indigo-700 bg-white hover:bg-indigo-50 border border-indigo-300 px-4 py-2 rounded-lg transition-colors"
              >
                <PlusCircle size={14} />
                Add column to all tables
              </button>
            </div>
          </div>

          {/* Unmapped fields */}
          {(unmappedTables.length > 0 || Object.keys(unmappedDecisions).length > 0) ? (
            <section className="mb-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
                <PlusCircle size={14} className="text-indigo-500" />
                Unmapped fields &amp; additional columns
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                Define how to store unmapped fields. Use <strong>+ Add column</strong> to create extra columns.
              </p>
              <div className="space-y-4">
                {sortTableNames([...unmappedTables, ...Object.keys(unmappedDecisions)]).map((table) => {
                  const rows = unmappedDecisions[table] ?? [];
                  const isOpen = expandedUnmapped.has(table);
                  const isIncluded = tableInclusion[table] !== false;
                  const customCount = rows.filter((r) => r.action === "custom").length;

                  return (
                    <div
                      key={table}
                      className={`rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${!isIncluded ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
                        <button
                          className="flex items-center gap-3 flex-1 text-left"
                          onClick={() => setExpandedUnmapped((prev) => {
                            const n = new Set(prev); if (n.has(table)) n.delete(table); else n.add(table); return n;
                          })}
                        >
                          <span className={`font-semibold text-sm font-mono ${isIncluded ? "text-slate-800" : "text-slate-400 line-through"}`}>
                            {table}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                            {rows.length} fields
                          </span>
                          {customCount > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                              {customCount} new col{customCount > 1 ? "s" : ""}
                            </span>
                          )}
                          {!isIncluded && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-500">
                              Excluded
                            </span>
                          )}
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => toggleTable(table)}
                            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                              isIncluded ? "text-green-700 bg-green-50 hover:bg-green-100" : "text-slate-500 bg-slate-100 hover:bg-slate-200"
                            }`}
                          >
                            {isIncluded ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                            {isIncluded ? "Included" : "Excluded"}
                          </button>
                          <button
                            onClick={() => setExpandedUnmapped((prev) => {
                              const n = new Set(prev); if (n.has(table)) n.delete(table); else n.add(table); return n;
                            })}
                          >
                            {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="border-t border-slate-100">
                          {rows.map((row, idx) => (
                            <div key={idx} className="border-b border-slate-100 last:border-b-0">
                              <div className="px-5 py-3 flex items-center gap-4">
                                <div className="flex-1 min-w-0">
                                  {idx < (unmappedByTableInit[table]?.length ?? 0) ? (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono text-sm font-semibold text-slate-800">{row.source_field}</span>
                                      {(() => {
                                        const orig = unmappedByTableInit[table]?.[idx];
                                        if (!orig) return null;
                                        const sug = orig.suggested_canonical_table;
                                        const exists = sug ? canonicalTables.includes(sug) : false;
                                        const label = sug
                                          ? (exists ? `→ ${sug}` : `new: ${sug}`)
                                          : "→ new table";
                                        const cls = exists
                                          ? "bg-indigo-50 text-indigo-600 border border-indigo-200"
                                          : "bg-violet-50 text-violet-600 border border-violet-200";
                                        return (
                                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                                            <Wand2 size={10} />
                                            {label}
                                          </span>
                                        );
                                      })()}
                                    </div>
                                  ) : (
                                    <input
                                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[200px]"
                                      value={row.source_field}
                                      onChange={(e) => setRowSourceField(table, idx, e.target.value)}
                                      placeholder="source_field_name"
                                    />
                                  )}
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <ActionBtn label="New column"   icon={<PlusCircle size={11} />} active={row.action === "custom"}       activeColor="bg-indigo-600" onClick={() => setUnmappedAction(table, idx, "custom")} />
                                  <ActionBtn label="raw_metadata" icon={<Archive size={11} />}     active={row.action === "raw_metadata"} activeColor="bg-slate-600"  onClick={() => setUnmappedAction(table, idx, "raw_metadata")} />
                                  <ActionBtn label="Skip"         icon={<XCircle size={11} />}     active={row.action === "skip"}         activeColor="bg-red-600"    onClick={() => setUnmappedAction(table, idx, "skip")} />
                                  {idx >= (unmappedByTableInit[table]?.length ?? 0) && (
                                    <button
                                      onClick={() => removeRow(table, idx)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {row.action === "custom" && row.custom && (
                                <div className="px-5 pb-4">
                                  {idx < (unmappedByTableInit[table]?.length ?? 0) && (() => {
                                    const orig = unmappedByTableInit[table]?.[idx];
                                    const sug = orig?.suggested_canonical_table;
                                    const exists = sug ? canonicalTables.includes(sug) : false;
                                    const hint = sug
                                      ? (exists
                                          ? <span>Add column to existing canonical table <span className="font-mono font-semibold">{sug}</span></span>
                                          : <span>Create new table <span className="font-mono font-semibold">{sug}</span></span>)
                                      : <span>No canonical match found — suggest creating a new table from source <span className="font-mono font-semibold">{table}</span></span>;
                                    return (
                                      <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200">
                                        <Wand2 size={13} className="text-violet-500 shrink-0 mt-0.5" />
                                        <p className="text-xs text-violet-700">
                                          <span className="font-semibold">AI suggestion: </span>{hint}
                                        </p>
                                      </div>
                                    );
                                  })()}
                                  <CustomDDLForm
                                    ddl={row.custom}
                                    canonicalTables={canonicalTables}
                                    onChange={(p) => updateCustom(table, idx, p)}
                                  />
                                  {(() => {
                                    const targetTable = row.custom.is_new_table ? row.custom.new_table_name : row.custom.target_table;
                                    const colName = row.custom.custom_column_name;
                                    const key = `${targetTable}.${colName}`.toLowerCase().trim();
                                    if (!key || key === ".") return null;
                                    const others = (unmappedColumnConflicts.get(key) ?? []).filter(
                                      (s) => !(s.source_table === table && s.source_field === row.source_field)
                                    );
                                    if (others.length === 0) return null;
                                    return (
                                      <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-200">
                                        <AlertTriangle size={13} className="text-orange-500 shrink-0 mt-0.5" />
                                        <p className="text-xs text-orange-700">
                                          <span className="font-semibold">Column name conflict: </span>
                                          <span className="font-mono">{colName}</span> in <span className="font-mono">{targetTable}</span> is also used by{" "}
                                          {others.map((o, i) => (
                                            <span key={i}>{i > 0 ? ", " : ""}<span className="font-mono font-semibold">{o.source_table}.{o.source_field}</span></span>
                                          ))}. Rename one if they represent different data.
                                        </p>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                              {row.action === "raw_metadata" && (
                                <div className="px-5 pb-3">
                                  <p className="text-xs text-slate-400">
                                    Stored in <code className="bg-slate-100 px-1 rounded">raw_metadata</code> JSONB — no schema changes.
                                  </p>
                                </div>
                              )}
                              {row.action === "skip" && (
                                <div className="px-5 pb-3">
                                  <p className="text-xs text-slate-400">Field will be discarded — not stored anywhere.</p>
                                </div>
                              )}
                            </div>
                          ))}
                          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
                            <button
                              onClick={() => addExtraColumn(table)}
                              className="flex items-center gap-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                            >
                              <PlusCircle size={14} />
                              Add column to <span className="font-mono">{table}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="mb-6">
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                <p className="text-xs text-slate-500 mb-3">No unmapped fields. Add custom columns to any table below.</p>
                <div className="flex flex-wrap gap-2">
                  {allSourceTables.filter((t) => tableInclusion[t] !== false).slice(0, 8).map((t) => (
                    <button
                      key={t}
                      onClick={() => addExtraColumn(t)}
                      className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <PlusCircle size={12} />
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Create brand-new tables */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Table2 size={14} className="text-violet-500" />
                Create brand-new tables
                <span className="text-xs font-normal text-slate-400">(not from extracted data)</span>
              </h3>
              <button
                onClick={addNewTable}
                className="flex items-center gap-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <PlusCircle size={13} />
                New table
              </button>
            </div>
            {newTableDefs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400 text-center">
                Click <strong>New table</strong> to define a completely new table in{" "}
                <code className="bg-slate-100 px-1 rounded">plenum_cafm</code>
              </div>
            ) : (
              <div className="space-y-4">
                {newTableDefs.map((nt) => (
                  <NewTableCard
                    key={nt.id}
                    def={nt}
                    onRemove={() => removeNewTable(nt.id)}
                    onPatch={(patch) => patchNewTable(nt.id, patch)}
                    onAddColumn={() => addNewTableColumn(nt.id)}
                    onUpdateColumn={(ci, patch) => updateNewTableColumn(nt.id, ci, patch)}
                    onRemoveColumn={(ci) => removeNewTableColumn(nt.id, ci)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ── TABLES TAB ───────────────────────────────────────────────────────── */}
      {activeTab === "tables" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-600">
              Toggle which source tables to include in the migration. Excluded tables have all field decisions set to skip/reject.
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setTableInclusion((prev) => {
                  const next = { ...prev };
                  for (const t of allSourceTables) next[t] = true;
                  return next;
                })}
                className="text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                Include all
              </button>
              <button
                onClick={() => setTableInclusion((prev) => {
                  const next = { ...prev };
                  for (const t of allSourceTables) next[t] = false;
                  return next;
                })}
                className="text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Exclude all
              </button>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {allSourceTables.map((table) => {
              const isIncluded = tableInclusion[table] !== false;
              const lowConfCount = lowConfByTable[table]?.length ?? 0;
              const unmappedCount = unmappedByTableInit[table]?.length ?? 0;
              const extraColCount = (unmappedDecisions[table]?.length ?? 0) - unmappedCount;
              const hasExtraCols = extraColCount > 0;
              const isColsOpen = expandedTableCols.has(table);

              return (
                <div
                  key={table}
                  className={`rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden transition-opacity ${!isIncluded ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    <button
                      onClick={() => toggleTable(table)}
                      className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${isIncluded ? "bg-green-500" : "bg-slate-300"}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isIncluded ? "translate-x-7" : "translate-x-1"}`} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-mono text-sm font-bold ${isIncluded ? "text-slate-800" : "text-slate-400 line-through"}`}>
                          {table}
                        </span>
                        {isIncluded
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Included</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-500">Excluded</span>
                        }
                        {lowConfCount > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            {lowConfCount} low-conf
                          </span>
                        )}
                        {unmappedCount > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                            {unmappedCount} unmapped
                          </span>
                        )}
                        {hasExtraCols && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                            +{extraColCount} extra col{extraColCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>

                    {isIncluded && (
                      <button
                        onClick={() => addExtraColumn(table)}
                        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                      >
                        <PlusCircle size={13} />
                        Add column
                      </button>
                    )}

                    {hasExtraCols && (
                      <button
                        onClick={() => setExpandedTableCols((prev) => {
                          const n = new Set(prev); if (n.has(table)) n.delete(table); else n.add(table); return n;
                        })}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        {isColsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    )}
                  </div>

                  {isColsOpen && hasExtraCols && (
                    <div className="border-t border-slate-100 px-5 pb-3 pt-2 bg-indigo-50/40">
                      <p className="text-xs font-medium text-slate-500 mb-2">Extra columns added</p>
                      {(unmappedDecisions[table] ?? []).slice(unmappedCount).map((row, i) => {
                        const actualIdx = unmappedCount + i;
                        return (
                          <div key={i} className="flex items-center gap-2 mb-1.5">
                            <input
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 max-w-[160px]"
                              value={row.source_field}
                              onChange={(e) => setRowSourceField(table, actualIdx, e.target.value)}
                              placeholder="col_name"
                            />
                            {row.custom && (
                              <>
                                <span className="text-xs text-slate-400">→</span>
                                <span className="text-xs font-mono text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                                  {row.custom.is_new_table ? row.custom.new_table_name || "(new)" : row.custom.target_table || "?"}
                                </span>
                                <span className="text-xs font-mono text-slate-500">{row.custom.data_type}</span>
                              </>
                            )}
                            <button
                              onClick={() => removeRow(table, actualIdx)}
                              className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Create brand-new tables (also from Tables tab) */}
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Table2 size={14} className="text-violet-500" />
              Create brand-new tables
              <span className="text-xs font-normal text-slate-400">(not from extracted data)</span>
            </h3>
            <button
              onClick={addNewTable}
              className="flex items-center gap-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <PlusCircle size={13} />
              New table
            </button>
          </div>
          {newTableDefs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400 text-center mb-6">
              Click <strong>New table</strong> to define a completely new table in{" "}
              <code className="bg-slate-100 px-1 rounded">plenum_cafm</code>
            </div>
          ) : (
            <div className="space-y-4 mb-6">
              {newTableDefs.map((nt) => (
                <NewTableCard
                  key={nt.id}
                  def={nt}
                  onRemove={() => removeNewTable(nt.id)}
                  onPatch={(patch) => patchNewTable(nt.id, patch)}
                  onAddColumn={() => addNewTableColumn(nt.id)}
                  onUpdateColumn={(ci, patch) => updateNewTableColumn(nt.id, ci, patch)}
                  onRemoveColumn={(ci) => removeNewTableColumn(nt.id, ci)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {error && !readOnly && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
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
              Submit field mapping decisions
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

// ── New table card ────────────────────────────────────────────────────────────

function NewTableCard({
  def, onRemove, onPatch, onAddColumn, onUpdateColumn, onRemoveColumn,
}: {
  def: NewTableDef;
  onRemove: () => void;
  onPatch: (p: Partial<NewTableDef>) => void;
  onAddColumn: () => void;
  onUpdateColumn: (ci: number, p: Partial<NewTableColumn>) => void;
  onRemoveColumn: (ci: number) => void;
}) {
  const tableName = def.table_name.trim() || "…";
  const pk = def.pk_col.trim() || "id";

  const colDefs = [
    `  ${pk} UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
    ...def.columns
      .filter((c) => c.column_name.trim())
      .map((c) => `  ${c.column_name} ${c.data_type}${c.nullable ? "" : " NOT NULL"}`),
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  ];
  const sqlPreview = `CREATE TABLE plenum_cafm.${tableName} (\n${colDefs.join(",\n")}\n);`;

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-violet-50 border-b border-violet-200">
        <Table2 size={14} className="text-violet-500 shrink-0" />
        <input
          className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 max-w-xs"
          value={def.table_name}
          onChange={(e) => onPatch({ table_name: e.target.value })}
          placeholder="new_table_name"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          <label className="text-xs text-slate-500">PK</label>
          <input
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 w-24"
            value={def.pk_col}
            onChange={(e) => onPatch({ pk_col: e.target.value })}
            placeholder="id"
          />
        </div>
        <button
          onClick={onRemove}
          className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="px-4 pt-3 pb-2 space-y-2">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Columns</p>
        {def.columns.map((col, ci) => (
          <div key={ci} className="flex items-center gap-2">
            <input
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1"
              value={col.column_name}
              onChange={(e) => onUpdateColumn(ci, { column_name: e.target.value })}
              placeholder="column_name"
            />
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 w-36 shrink-0"
              value={col.data_type}
              onChange={(e) => onUpdateColumn(ci, { data_type: e.target.value })}
            >
              {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0 cursor-pointer">
              <div
                className={`relative w-7 h-4 rounded-full transition-colors cursor-pointer ${col.nullable ? "bg-indigo-500" : "bg-slate-300"}`}
                onClick={() => onUpdateColumn(ci, { nullable: !col.nullable })}
              >
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${col.nullable ? "translate-x-3" : "translate-x-0.5"}`} />
              </div>
              Null
            </label>
            <button
              onClick={() => onRemoveColumn(ci)}
              disabled={def.columns.length === 1}
              className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={onAddColumn}
          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 transition-colors mt-1"
        >
          <PlusCircle size={12} />
          Add column
        </button>
      </div>

      <div className="px-4 pb-4">
        <pre className="rounded-lg bg-white border border-violet-200 px-3 py-2 font-mono text-xs text-slate-600 leading-relaxed overflow-auto mt-2">
          {sqlPreview}
        </pre>
      </div>
    </div>
  );
}

// ── Custom DDL form ───────────────────────────────────────────────────────────

function CustomDDLForm({
  ddl, canonicalTables, onChange,
}: {
  ddl: CustomDDL;
  canonicalTables: string[];
  onChange: (p: Partial<CustomDDL>) => void;
}) {
  const effectiveTable = ddl.is_new_table ? (ddl.new_table_name || "…") : (ddl.target_table || "…");
  const col = ddl.custom_column_name || "…";
  const nullStr = ddl.nullable ? "" : " NOT NULL";
  const sqlPreview = ddl.is_new_table
    ? `CREATE TABLE plenum_cafm.${effectiveTable} (\n  ${ddl.new_table_pk || "id"} UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  ${col} ${ddl.data_type}${nullStr}\n);`
    : `ALTER TABLE plenum_cafm.${effectiveTable}\n  ADD COLUMN ${col} ${ddl.data_type}${nullStr};`;

  return (
    <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-4 space-y-3 mt-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
          <PlusCircle size={12} />
          Column definition
        </p>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-slate-600">{ddl.is_new_table ? "New table" : "Existing table"}</span>
          <div
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${ddl.is_new_table ? "bg-indigo-600" : "bg-slate-300"}`}
            onClick={() => onChange({ is_new_table: !ddl.is_new_table })}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${ddl.is_new_table ? "translate-x-4" : "translate-x-0.5"}`} />
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {ddl.is_new_table ? (
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New table name</label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={ddl.new_table_name}
                onChange={(e) => onChange({ new_table_name: e.target.value })}
                placeholder="my_new_table"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Primary key column</label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={ddl.new_table_pk}
                onChange={(e) => onChange({ new_table_pk: e.target.value })}
                placeholder="id"
              />
            </div>
          </div>
        ) : (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Target table <span className="text-red-500">*</span>
            </label>
            {canonicalTables.length > 0 ? (
              <select
                className={`w-full rounded-lg border bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  !ddl.target_table ? "border-amber-400 text-slate-400" : "border-slate-200"
                }`}
                value={ddl.target_table}
                onChange={(e) => onChange({ target_table: e.target.value })}
              >
                <option value="">— select target table —</option>
                {canonicalTables.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={ddl.target_table}
                onChange={(e) => onChange({ target_table: e.target.value })}
                placeholder="assets"
              />
            )}
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Column name</label>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={ddl.custom_column_name}
            onChange={(e) => onChange({ custom_column_name: e.target.value })}
            placeholder="my_column"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Data type</label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={ddl.data_type}
            onChange={(e) => onChange({ data_type: e.target.value })}
          >
            {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <div
          className={`relative w-9 h-5 rounded-full transition-colors ${ddl.nullable ? "bg-indigo-600" : "bg-slate-300"}`}
          onClick={() => onChange({ nullable: !ddl.nullable })}
        >
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${ddl.nullable ? "translate-x-4" : "translate-x-0.5"}`} />
        </div>
        <span className="text-xs font-medium text-slate-700">Nullable</span>
      </label>

      <pre className="rounded-lg bg-white border border-indigo-200 px-3 py-2 font-mono text-xs text-slate-600 leading-relaxed overflow-auto">
        {sqlPreview}
      </pre>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function ActionBtn({ label, icon, active, activeColor, onClick }: {
  label: string; icon: React.ReactNode; active: boolean; activeColor: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
        active ? `${activeColor} text-white` : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {icon}{label}
    </button>
  );
}

function ConfidenceBadge({ value, tier }: { value: number; tier: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-green-100 text-green-700" : pct >= 65 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-medium ${color}`}>
      {tier ? `${tier} · ` : ""}{pct}%
    </span>
  );
}
