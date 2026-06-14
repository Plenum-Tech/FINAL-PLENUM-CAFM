"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { Database, Loader2, RefreshCw } from "lucide-react";

import type { MatchedRow, RowIndexTableRow } from "@/features/ai/doc-rag-api";

const METHOD_COLOR: Record<string, string> = {
  exact_key: "bg-indigo-100 text-indigo-700",
  normalized_key: "bg-blue-100 text-blue-700",
  semantic: "bg-purple-100 text-purple-700",
  metadata_match: "bg-teal-100 text-teal-700",
  bm25: "bg-orange-100 text-orange-700",
  hybrid: "bg-slate-100 text-slate-600",
};

function confStyle(v: number) {
  if (v >= 0.6)
    return {
      bar: "bg-emerald-500",
      border: "border-emerald-200",
      bg: "bg-emerald-50/40",
    };
  if (v >= 0.3)
    return {
      bar: "bg-amber-400",
      border: "border-amber-200",
      bg: "bg-amber-50/40",
    };
  return { bar: "bg-slate-400", border: "border-slate-200", bg: "bg-white" };
}

function ContribBar({
  semantic,
  bm25,
  metadata,
}: {
  semantic: number;
  bm25: number;
  metadata: number;
}) {
  const total = 0.4 * semantic + 0.3 * bm25 + 0.3 * metadata || 1;
  const semPct = ((0.4 * semantic) / total) * 100;
  const bm25Pct = ((0.3 * bm25) / total) * 100;
  const metaPct = ((0.3 * metadata) / total) * 100;
  const driver =
    semPct >= bm25Pct && semPct >= metaPct ? "semantic" : bm25Pct >= metaPct ? "keyword" : "metadata";
  const driverColor =
    driver === "semantic" ? "text-purple-600" : driver === "keyword" ? "text-orange-600" : "text-teal-600";
  const driverPct = Math.max(semPct, bm25Pct, metaPct);

  return (
    <div className="flex items-center gap-2 mt-1">
      <div
        className="flex h-1.5 rounded-full overflow-hidden w-20 shrink-0"
        title={`Semantic ${semPct.toFixed(0)}% · BM25 ${bm25Pct.toFixed(0)}% · Meta ${metaPct.toFixed(0)}%`}
      >
        <div className="bg-purple-400" style={{ width: `${semPct}%` }} />
        <div className="bg-orange-400" style={{ width: `${bm25Pct}%` }} />
        <div className="bg-teal-400" style={{ width: `${metaPct}%` }} />
      </div>
      <span className={`text-[10px] font-medium ${driverColor}`}>{driverPct.toFixed(0)}% {driver}</span>
    </div>
  );
}

export function DocRagRowMatchCard({
  row,
  selectable,
  selected,
  onToggle,
}: {
  row: MatchedRow;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (row: MatchedRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cls = confStyle(row.confidence);

  return (
    <div className={`rounded-xl border ${cls.border} ${cls.bg} overflow-hidden`}>
      <div
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-black/[0.03] transition-colors cursor-pointer"
      >
        {selectable ? (
          <div
            role="checkbox"
            aria-checked={!!selected}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.(row);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onToggle?.(row);
              }
            }}
            className={`mt-0.5 mr-1 shrink-0 rounded-full border w-4 h-4 flex items-center justify-center outline-none focus:ring-2 focus:ring-indigo-400 ${
              selected ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white"
            }`}
          >
            {selected ? <Check size={10} className="text-white" /> : null}
          </div>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-slate-800">{row.row_pk}</span>
            <span className="text-xs text-slate-400">{row.source_table}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${METHOD_COLOR[row.match_method] ?? "bg-slate-100 text-slate-600"}`}
            >
              {row.match_method.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden max-w-[80px]">
              <div
                className={`h-full rounded-full ${cls.bar}`}
                style={{ width: `${Math.round(row.confidence * 100)}%` }}
              />
            </div>
            <span className="text-xs font-bold text-slate-600 tabular-nums">
              {(row.confidence * 100).toFixed(0)}%
            </span>
            {row.match_details ? (
              <ContribBar
                semantic={row.match_details.semantic_score}
                bm25={row.match_details.bm25_overlap}
                metadata={row.match_details.metadata_overlap}
              />
            ) : null}
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={14} className="text-slate-400 shrink-0 mt-1" />
        ) : (
          <ChevronDown size={14} className="text-slate-400 shrink-0 mt-1" />
        )}
      </div>

      {expanded ? (
        <div className="border-t border-slate-200 px-4 pb-4 pt-3 space-y-3">
          <div>
            <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Row data
            </h5>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {Object.entries(row.row_data ?? {}).map(([k, v]) => (
                <div key={k} className="text-xs">
                  <span className="text-slate-400">{k}</span>
                  <span className="mx-1 text-slate-300">·</span>
                  <span className="text-slate-700 font-medium">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
          </div>

          {row.matched_metadata_fields && row.matched_metadata_fields.length > 0 ? (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Matched columns
              </h5>
              <div className="flex flex-wrap gap-1.5">
                {row.matched_metadata_fields.map((f) => (
                  <span
                    key={f}
                    className="text-[11px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {row.evidence ? (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Evidence
              </h5>
              <p className="text-xs text-slate-500 italic">&quot;{row.evidence}&quot;</p>
            </div>
          ) : null}

          {row.chunk_matches && row.chunk_matches.length > 0 ? (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Matched chunks ({row.chunk_matches.length})
              </h5>
              <div className="space-y-2">
                {row.chunk_matches.map((cm) => (
                  <div key={cm.chunk_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-slate-600">#{cm.chunk_index}</span>
                      <span className="text-[11px] text-slate-400">
                        {cm.page_number != null ? `p.${cm.page_number}` : "—"}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-700">
                        {(cm.confidence * 100).toFixed(0)}%
                      </span>
                      <span className="text-[11px] text-slate-400">
                        sem {cm.semantic_score.toFixed(3)} · bm25 {cm.bm25_score.toFixed(3)} · meta{" "}
                        {cm.metadata_score.toFixed(3)}
                      </span>
                    </div>
                    {cm.matched_fields && cm.matched_fields.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {cm.matched_fields.map((f) => (
                          <span
                            key={f}
                            className="text-[11px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                      {cm.chunk_text_preview}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function rowMatchKey(row: MatchedRow) {
  return `${row.source_table}::${row.row_pk}`;
}

function normalizeSingleIndexRow(input: unknown): RowIndexTableRow | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  const rowPk =
    (typeof rec.row_pk === "string" && rec.row_pk) || (typeof rec.id === "string" && rec.id) || "";
  const explicitRowData =
    rec.row_data && typeof rec.row_data === "object" && !Array.isArray(rec.row_data)
      ? (rec.row_data as Record<string, unknown>)
      : null;
  const metaRowData =
    rec.meta && typeof rec.meta === "object" && !Array.isArray(rec.meta)
      ? (rec.meta as Record<string, unknown>)
      : null;
  const createdAt = typeof rec.created_at === "string" ? rec.created_at : null;
  const rowDataBase = explicitRowData ?? metaRowData ?? null;
  if (!rowDataBase && !rowPk) return null;
  const rowData: Record<string, unknown> = { ...(rowDataBase ?? {}) };
  if (createdAt && rowData.created_at == null) rowData.created_at = createdAt;
  return {
    row_pk: rowPk || String(rowData.id ?? ""),
    row_data: rowData,
  };
}

export function normalizeRowIndexRows(data: unknown): RowIndexTableRow[] {
  function fromArray(rows: unknown[]): RowIndexTableRow[] {
    const out: RowIndexTableRow[] = [];
    for (const r of rows) {
      const n = normalizeSingleIndexRow(r);
      if (n) out.push(n);
    }
    return out;
  }
  if (!data) return [];
  if (Array.isArray(data)) return fromArray(data);
  const rows = (data as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? fromArray(rows) : [];
}

const PREVIEW_COLUMN_ORDER = [
  "id",
  "organization_id",
  "name",
  "description",
  "parent_id",
  "document_id",
  "document_ids",
  "created_at",
];

export function previewColumnsFromRows(rows: RowIndexTableRow[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.row_data ?? {})) keys.add(k);
  }
  const ordered = PREVIEW_COLUMN_ORDER.filter((k) => keys.has(k));
  const rest = Array.from(keys).filter((k) => !PREVIEW_COLUMN_ORDER.includes(k)).sort();
  return [...ordered, ...rest];
}

type LinkedRowsPreviewProps = {
  tableName: string;
  rows: RowIndexTableRow[];
  confirmedPkSet: Set<string>;
  loading?: boolean;
  error?: unknown;
  onRefresh?: () => void;
};

export function DocRagLinkedRowsPreview({
  tableName,
  rows,
  confirmedPkSet,
  loading,
  error,
  onRefresh,
}: LinkedRowsPreviewProps) {
  const columns = previewColumnsFromRows(rows);
  const errMsg = error instanceof Error ? error.message : error ? "Failed to load rows" : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
        <Database size={13} className="text-slate-500 shrink-0" />
        <span className="text-[11px] font-semibold text-slate-800">Table preview</span>
        <span className="text-[10px] text-slate-500 font-mono truncate">{tableName}</span>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh
          </button>
        ) : null}
      </div>
      <div className="px-3 py-2">
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Loader2 size={12} className="animate-spin" />
            Loading rows…
          </div>
        ) : null}
        {!loading && errMsg ? (
          <p className="text-[11px] text-red-700 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5">
            {errMsg}
          </p>
        ) : null}
        {!loading && !errMsg && rows.length > 0 ? (
          <div className="overflow-auto max-h-64">
            <div className="mb-1.5 text-[10px] text-slate-500">
              {rows.length} row{rows.length === 1 ? "" : "s"}
              {confirmedPkSet.size > 0 ? ` · ${confirmedPkSet.size} linked (highlighted)` : ""}
            </div>
            <table className="min-w-full text-[10px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-1.5 pr-2 font-semibold">row_pk</th>
                  {columns.map((c) => (
                    <th key={c} className="py-1.5 pr-2 font-semibold whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr
                    key={r.row_pk}
                    className={confirmedPkSet.has(r.row_pk) ? "bg-emerald-50" : undefined}
                  >
                    <td className="py-1.5 pr-2 font-mono text-slate-800 whitespace-nowrap">
                      {r.row_pk}
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="py-1.5 pr-2 text-slate-700 whitespace-nowrap max-w-[140px] truncate">
                        {String((r.row_data ?? {})[c] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loading && !errMsg && rows.length === 0 ? (
          <p className="text-[11px] text-slate-400">No rows in index for this table.</p>
        ) : null}
      </div>
    </div>
  );
}
