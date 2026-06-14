"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, Link2, Loader2, Play } from "lucide-react";

import { Button, toast } from "@/components/ui";
import {
  PLENUM_CMMS_SCHEMA,
  useConfirmMatches,
  useDbTableColumns,
  useDbTables,
  useDocMatchRows,
  useImportDbTable,
  useRowIndexTableRows,
  useRowIndexTables,
  type ConfirmMatchRow,
  type MatchedRow,
} from "@/features/ai/doc-rag-api";

import {
  DocRagLinkedRowsPreview,
  DocRagRowMatchCard,
  normalizeRowIndexRows,
  rowMatchKey,
} from "./doc-rag-match-shared";

export type DeepAgentDocMatchContext = {
  documentIds: string[];
  fileNames: string[];
};

type Props = {
  context: DeepAgentDocMatchContext;
  onDismiss?: () => void;
};

export function DeepAgentDocMatchPanel({ context }: Props) {
  const queryClient = useQueryClient();
  const [documentId, setDocumentId] = useState(context.documentIds[0] ?? "");
  const [threshold, setThreshold] = useState(0.25);
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [pkModalOpen, setPkModalOpen] = useState(false);
  const [pkModalTable, setPkModalTable] = useState("");
  const [pkModalValue, setPkModalValue] = useState("");
  const [matchActiveTable, setMatchActiveTable] = useState<string | null>(null);
  const [lastConfirmedRows, setLastConfirmedRows] = useState<ConfirmMatchRow[]>([]);
  const [previewTableName, setPreviewTableName] = useState("");

  const { data: indexedTables = [] } = useRowIndexTables();
  const {
    data: dbTablesData,
    isLoading: loadingDbTables,
    isError: dbTablesError,
    error: dbTablesErrorDetail,
  } = useDbTables();
  const cmmsSchema = dbTablesData?.schemaName ?? PLENUM_CMMS_SCHEMA;
  const dbTables = dbTablesData?.tables ?? [];
  const { data: pkColumns = [], isLoading: loadingPkCols } = useDbTableColumns(pkModalTable, {
    enabled: pkModalOpen && !!pkModalTable,
  });

  const indexedSet = useMemo(
    () => new Set(indexedTables.map((t) => t.source_table)),
    [indexedTables],
  );

  const indexedOnlyTables = useMemo(() => {
    const dbNames = new Set(dbTables.map((t) => t.table_name));
    return indexedTables
      .map((t) => t.source_table)
      .filter((name): name is string => !!name && !dbNames.has(name))
      .sort();
  }, [dbTables, indexedTables]);

  const {
    mutate: runMatch,
    isPending: matching,
    error: matchError,
    data: matchResult,
    reset: resetMatch,
  } = useDocMatchRows({
    onSuccess: () => setSelectedRowKeys(new Set()),
  });

  const { mutate: importDbTable, isPending: importing } = useImportDbTable({
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["doc-rag", "row-index-tables"] });
      toast({ title: "Table indexed", description: `${vars.tableName} is ready for matching.`, variant: "success" });
      runMatchForTable(vars.tableName);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Import failed";
      toast({ title: "Could not index table", description: msg, variant: "destructive" });
    },
  });

  const {
    mutate: fetchIndexRows,
    isPending: fetchingIndexRows,
    error: indexRowsError,
    data: indexRowsData,
  } = useRowIndexTableRows();

  const {
    mutate: confirmMatches,
    isPending: confirming,
    data: confirmResult,
  } = useConfirmMatches({
    onSuccess: (res, vars) => {
      const tableSummary = Object.entries(res.by_table)
        .map(([t, c]) => `${t} (${c})`)
        .join(", ");
      toast({
        title: "document_id linked",
        description: tableSummary
          ? `Updated ${res.rows_updated} row${res.rows_updated === 1 ? "" : "s"}: ${tableSummary}.`
          : `Updated ${res.rows_updated} row${res.rows_updated === 1 ? "" : "s"} in CMMS tables.`,
        variant: "success",
      });
      setSelectedRowKeys(new Set());
      setLastConfirmedRows(vars.rows);
      const tables = Object.keys(res.by_table);
      const tn =
        (tables.length === 1 ? tables[0] : null) ??
        (selectedTable || vars.rows[0]?.source_table || "");
      setPreviewTableName(tn);
      if (tn) fetchIndexRows({ tableName: tn, limit: 50, offset: 0 });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Confirm failed";
      toast({ title: "Confirm failed", description: msg, variant: "destructive" });
    },
  });

  useEffect(() => {
    const next = context.documentIds[0] ?? "";
    if (next && next !== documentId) setDocumentId(next);
  }, [context.documentIds.join(",")]);

  useEffect(() => {
    resetMatch();
    setSelectedRowKeys(new Set());
    setMatchActiveTable(null);
  }, [documentId, selectedTable, resetMatch]);

  useEffect(() => {
    if (!matchResult) return;
    const tables = Object.keys(matchResult.by_table ?? {});
    if (tables.length === 1) setMatchActiveTable(tables[0]);
    else if (selectedTable) setMatchActiveTable(selectedTable);
  }, [matchResult, selectedTable]);

  function runMatchForTable(tableName: string) {
    if (!documentId || !tableName) return;
    runMatch({
      documentId,
      confidence_threshold: threshold,
      source_table: tableName,
    });
  }

  function handleTableChange(tableName: string) {
    setSelectedTable(tableName);
    if (!tableName) return;
    if (indexedSet.has(tableName)) {
      runMatchForTable(tableName);
      return;
    }
    setPkModalTable(tableName);
    setPkModalValue("");
    setPkModalOpen(true);
  }

  function toggleRow(row: MatchedRow) {
    const key = rowMatchKey(row);
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const displayRows: MatchedRow[] = matchResult
    ? (matchActiveTable && matchResult.matched_rows_by_table?.[matchActiveTable]) ||
      (selectedTable && matchResult.matched_rows_by_table?.[selectedTable]) ||
      matchResult.matched_rows
    : [];

  const normalizedIndexRows = useMemo(
    () => normalizeRowIndexRows(indexRowsData),
    [indexRowsData],
  );

  const confirmedPkSet = useMemo(() => {
    if (!previewTableName) return new Set<string>();
    return new Set(
      lastConfirmedRows.filter((r) => r.source_table === previewTableName).map((r) => r.row_pk),
    );
  }, [lastConfirmedRows, previewTableName]);

  const confirmedTables = useMemo(() => {
    const out = new Set<string>();
    for (const r of lastConfirmedRows) out.add(r.source_table);
    return Array.from(out).sort();
  }, [lastConfirmedRows]);

  function loadPreviewForTable(tableName: string) {
    setPreviewTableName(tableName);
    fetchIndexRows({ tableName, limit: 50, offset: 0 });
  }

  const selectedRows: MatchedRow[] = useMemo(() => {
    if (!matchResult?.matched_rows?.length) return [];
    return matchResult.matched_rows.filter((r) => selectedRowKeys.has(rowMatchKey(r)));
  }, [matchResult, selectedRowKeys]);

  const errMsg =
    matchError instanceof Error ? matchError.message : matchError ? "Match failed" : null;

  function handleConfirm() {
    if (!documentId || !selectedRows.length) return;
    const rows: ConfirmMatchRow[] = selectedRows.map((r) => ({
      source_table: r.source_table,
      row_pk: r.row_pk,
    }));
    confirmMatches({ documentId, rows });
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 px-3 py-2.5 bg-gradient-to-r from-indigo-50/80 to-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Link2 size={13} className="text-indigo-600 shrink-0" />
              Row ↔ chunk match
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
              Pick a CMMS table, review semantic / BM25 / metadata scores, then confirm to write{" "}
              <span className="font-mono">document_id</span> on selected rows.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {context.documentIds.length > 1 ? (
          <label className="block text-[11px]">
            <span className="text-muted-foreground">Document</span>
            <select
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono"
            >
              {context.documentIds.map((id, i) => (
                <option key={id} value={id}>
                  {context.fileNames[i] ?? id.slice(0, 8)}… ({id.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </label>
        ) : documentId ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-[10px] font-mono text-slate-600 truncate">
            doc: {documentId}
          </div>
        ) : null}

        <label className="block text-[11px]">
          <span className="text-muted-foreground flex items-center gap-1">
            <Database size={11} />
            CMMS table
            <span className="font-mono text-[10px] text-slate-500">({cmmsSchema} · live Postgres)</span>
          </span>
          <select
            value={selectedTable}
            onChange={(e) => handleTableChange(e.target.value)}
            disabled={!documentId || loadingDbTables}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">
              {loadingDbTables ? "Loading plenum_cafm tables…" : "Select table…"}
            </option>
            {dbTables.length > 0 ? (
              <optgroup label={`Schema ${cmmsSchema} — raw tables`}>
                {dbTables.map((t) => (
                  <option key={t.table_name} value={t.table_name}>
                    {t.table_name}
                    {t.row_count != null ? ` (${t.row_count.toLocaleString()} rows)` : ""}
                    {indexedSet.has(t.table_name) ? " · indexed" : " · import on select"}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {indexedOnlyTables.length > 0 ? (
              <optgroup label="Row index only (already imported)">
                {indexedOnlyTables.map((name) => (
                  <option key={name} value={name}>
                    {name} · indexed
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
            Tables are read from <span className="font-mono">{cmmsSchema}</span> on the same DB as Schema
            Mapper. Pick a table → choose primary key → rows load into the semantic index → Run match →
            Confirm writes <span className="font-mono">document_id</span> on the live table.
          </p>
        </label>

        {dbTablesError ? (
          <p className="text-[11px] text-red-600 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5">
            Could not load {cmmsSchema} tables:{" "}
            {dbTablesErrorDetail instanceof Error ? dbTablesErrorDetail.message : "request failed"}
          </p>
        ) : null}

        {!loadingDbTables && !dbTablesError && dbTables.length === 0 ? (
          <p className="text-[11px] text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
            No tables in <span className="font-mono">{cmmsSchema}</span>. Run Schema Mapper or Migration
            first so CMMS tables exist, and ensure doc-rag uses Postgres (USE_SQLITE_DEV=false, DB_URL set).
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <label className="text-[11px] text-muted-foreground shrink-0">Min confidence</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-[11px] font-mono tabular-nums w-8">{(threshold * 100).toFixed(0)}%</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px] px-2"
            disabled={!documentId || !selectedTable || matching || importing}
            onClick={() => runMatchForTable(selectedTable)}
          >
            {matching || importing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} className="mr-1" />
            )}
            Run
          </Button>
        </div>

        {errMsg ? (
          <p className="text-[11px] text-red-600 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5">{errMsg}</p>
        ) : null}

        {matchResult && Object.keys(matchResult.by_table ?? {}).length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setMatchActiveTable(null)}
              className={`px-2 py-1 rounded-full text-[10px] font-medium ${
                matchActiveTable === null
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All {matchResult.unique_rows_matched}
            </button>
            {Object.entries(matchResult.by_table).map(([tbl, cnt]) => (
              <button
                key={tbl}
                type="button"
                onClick={() => setMatchActiveTable(tbl)}
                className={`px-2 py-1 rounded-full text-[10px] font-medium ${
                  matchActiveTable === tbl
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tbl} {cnt}
              </button>
            ))}
          </div>
        ) : null}

        {matchResult && !displayRows.length && !matching ? (
          <p className="text-[11px] text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
            No rows above threshold for this table. Lower confidence or index more rows in Doc RAG → Index.
          </p>
        ) : null}

        {displayRows.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-700">
                {displayRows.length} match{displayRows.length === 1 ? "" : "es"}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="text-[10px] text-indigo-600 hover:underline"
                  onClick={() =>
                    setSelectedRowKeys(new Set(displayRows.map((r) => rowMatchKey(r))))
                  }
                >
                  Select all
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:underline"
                  onClick={() => setSelectedRowKeys(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            {displayRows.map((row) => (
              <DocRagRowMatchCard
                key={rowMatchKey(row)}
                row={row}
                selectable
                selected={selectedRowKeys.has(rowMatchKey(row))}
                onToggle={toggleRow}
              />
            ))}
          </div>
        ) : null}

        {confirmResult ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-emerald-800 font-semibold">
                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                Linked document to {confirmResult.rows_updated} row
                {confirmResult.rows_updated === 1 ? "" : "s"}
                {confirmResult.rows_not_found > 0 ? (
                  <span className="font-normal text-emerald-700">
                    · not found: {confirmResult.rows_not_found}
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-[10px] font-normal text-emerald-700 truncate max-w-[120px]">
                  {confirmResult.document_id}
                </span>
              </div>
              {Object.keys(confirmResult.by_table).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(confirmResult.by_table).map(([t, c]) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => loadPreviewForTable(t)}
                      className={`text-[10px] border px-2 py-0.5 rounded-full transition-colors ${
                        previewTableName === t
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white/60 text-emerald-800 border-emerald-200 hover:bg-white"
                      }`}
                    >
                      {t} <span className="opacity-80">{c}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {confirmResult.columns_created && confirmResult.columns_created.length > 0 ? (
                <p className="mt-1.5 text-[10px] text-emerald-700">
                  Columns created: {confirmResult.columns_created.join(", ")}
                </p>
              ) : null}
            </div>
            {confirmedTables.length > 1 ? (
              <div className="flex flex-wrap gap-1">
                <span className="text-[10px] text-muted-foreground w-full">Preview table:</span>
                {confirmedTables.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => loadPreviewForTable(t)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      previewTableName === t
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}
            {previewTableName ? (
              <DocRagLinkedRowsPreview
                tableName={previewTableName}
                rows={normalizedIndexRows}
                confirmedPkSet={confirmedPkSet}
                loading={fetchingIndexRows}
                error={indexRowsError}
                onRefresh={() => loadPreviewForTable(previewTableName)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-slate-200 p-3 bg-slate-50/80">
        <Button
          type="button"
          className="w-full h-9 text-xs bg-gradient-to-r from-indigo-600 to-blue-600"
          disabled={!selectedRows.length || confirming || !documentId}
          onClick={handleConfirm}
        >
          {confirming ? (
            <Loader2 size={14} className="animate-spin mr-2" />
          ) : null}
          Confirm {selectedRows.length} row{selectedRows.length === 1 ? "" : "s"} → set document_id
        </Button>
      </div>

      {pkModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white border shadow-lg p-4 space-y-3">
            <div className="text-sm font-semibold">Index table for matching</div>
            <p className="text-xs text-muted-foreground">
              Choose the primary key column for <span className="font-mono">{pkModalTable}</span>.
            </p>
            <select
              value={pkModalValue}
              onChange={(e) => setPkModalValue(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-xs"
              disabled={loadingPkCols}
            >
              <option value="">PK column…</option>
              {pkColumns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setPkModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!pkModalValue || importing}
                onClick={() => {
                  importDbTable({ tableName: pkModalTable, pkColumn: pkModalValue });
                  setPkModalOpen(false);
                }}
              >
                {importing ? <Loader2 size={12} className="animate-spin" /> : "Import & match"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
