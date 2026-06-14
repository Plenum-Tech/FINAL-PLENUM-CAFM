"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Key, Link2, Search } from "lucide-react";

export type SchemaColumnTreeItem = {
  name: string;
  dataType?: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  fkTarget?: string;
  description?: string;
  defaultValue?: string;
};

export type SchemaTableTreeItem = {
  table: string;
  columns: SchemaColumnTreeItem[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function readRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}

function readBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "YES") return true;
  if (v === "NO") return false;
  return undefined;
}

function readRecordArray(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const it of v) {
    if (isRecord(it)) out.push(it);
  }
  return out;
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string") as string[];
}

function _readNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseColumnRecord(r: Record<string, unknown>): SchemaColumnTreeItem {
  const name =
    readString(r.field_name) ??
    readString(r.name) ??
    readString(r.column_name) ??
    readString(r.source_field) ??
    "—";
  const fkTable = readString(r.fk_target_table);
  const fkCol = readString(r.fk_target_column);
  const fkTarget =
    fkTable && fkCol ? `${fkTable}.${fkCol}` : fkTable ?? undefined;

  return {
    name,
    dataType: readString(r.data_type) ?? readString(r.type) ?? readString(r.data_type_hint) ?? undefined,
    nullable: readBool(r.nullable),
    isPrimaryKey: readBool(r.is_primary_key) ?? (readBool(r.primary_key) ?? undefined),
    isForeignKey: readBool(r.is_foreign_key) ?? (fkTarget ? true : undefined),
    fkTarget,
    description: readString(r.description) ?? readString(r.rationale) ?? undefined,
    defaultValue: readString(r.column_default) ?? readString(r.default) ?? undefined,
  };
}

function parseColumnsFromTableInfo(info: unknown): SchemaColumnTreeItem[] {
  if (!isRecord(info)) return [];
  const detailSource = info.column_details ?? info.column_defs ?? info.fields;
  if (Array.isArray(detailSource)) {
    return detailSource
      .map((c) => (isRecord(c) ? parseColumnRecord(c) : typeof c === "string" ? { name: c } : null))
      .filter((c): c is SchemaColumnTreeItem => c !== null);
  }
  const cols = info.columns;
  if (Array.isArray(cols)) {
    return cols
      .map((c) => (isRecord(c) ? parseColumnRecord(c) : typeof c === "string" ? { name: c } : null))
      .filter((c): c is SchemaColumnTreeItem => c !== null);
  }
  return readStringArray(info.all_cols).map((name) => ({ name }));
}

/** Build table/column tree from step pause or node output payloads. */
export function parseSchemaTablesFromPayload(payload: Record<string, unknown>): SchemaTableTreeItem[] {
  const canonical = readRecord(payload.canonical_tables);
  if (canonical && Object.keys(canonical).length > 0) {
    return Object.entries(canonical)
      .map(([table, info]) => ({
        table: readString(isRecord(info) ? info.table_name : null) ?? table,
        columns: parseColumnsFromTableInfo(info),
      }))
      .sort((a, b) => a.table.localeCompare(b.table));
  }

  const tablesRecord = readRecord(payload.tables);
  if (tablesRecord && Object.keys(tablesRecord).length > 0) {
    return Object.entries(tablesRecord)
      .map(([table, info]) => ({
        table,
        columns: parseColumnsFromTableInfo(info),
      }))
      .sort((a, b) => a.table.localeCompare(b.table));
  }

  const rows = readRecordArray(payload.tables_data);
  if (rows.length > 0) {
    return rows
      .map((r) => {
        const table = readString(r.table) ?? readString(r.table_name) ?? "—";
        const fromObjects = parseColumnsFromTableInfo({
          ...r,
          column_details: r.column_details ?? r.column_defs,
        });
        const fromNames = readStringArray(r.all_cols).map((name) => ({ name }));
        const columns = fromObjects.length > 0 ? fromObjects : fromNames;
        return {
          table,
          columns,
        };
      })
      .filter((t) => t.table !== "—")
      .sort((a, b) => a.table.localeCompare(b.table));
  }

  return [];
}

function ColumnMeta({ col }: { col: SchemaColumnTreeItem }) {
  const parts: string[] = [];
  if (col.dataType) parts.push(col.dataType);
  if (col.isPrimaryKey) parts.push("PK");
  if (col.isForeignKey && col.fkTarget) parts.push(`FK → ${col.fkTarget}`);
  else if (col.isForeignKey) parts.push("FK");
  if (col.nullable === false) parts.push("NOT NULL");
  else if (col.nullable === true) parts.push("nullable");
  if (col.defaultValue) parts.push(`default ${col.defaultValue}`);

  if (!parts.length) return null;
  return <span className="text-slate-400 font-normal ml-2">{parts.join(" · ")}</span>;
}

function ColumnTreeNode({ col, depth }: { col: SchemaColumnTreeItem; depth: number }) {
  return (
    <div
      className="flex items-start gap-2 py-1 text-xs font-mono text-slate-700"
      style={{ paddingLeft: depth * 16 }}
    >
      <span className="text-slate-300 shrink-0 select-none">├─</span>
      <div className="min-w-0 flex-1 break-words">
        <span className="text-slate-800">{col.name}</span>
        <ColumnMeta col={col} />
        {col.description ? (
          <div className="text-[11px] text-slate-500 font-sans mt-0.5">{col.description}</div>
        ) : null}
      </div>
      {col.isPrimaryKey ? <Key size={12} className="text-amber-500 shrink-0 mt-0.5" /> : null}
      {col.isForeignKey ? <Link2 size={12} className="text-indigo-400 shrink-0 mt-0.5" /> : null}
    </div>
  );
}

function TableTreeNode({
  item,
  depth,
  defaultOpen,
  filter,
}: {
  item: SchemaTableTreeItem;
  depth: number;
  defaultOpen: boolean;
  filter: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const q = filter.trim().toLowerCase();

  const visibleColumns = useMemo(() => {
    if (!q) return item.columns;
    return item.columns.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.dataType?.toLowerCase().includes(q) ?? false) ||
        (c.fkTarget?.toLowerCase().includes(q) ?? false),
    );
  }, [item.columns, q]);

  const tableMatches = !q || item.table.toLowerCase().includes(q);
  if (!tableMatches && visibleColumns.length === 0) return null;

  const colCount = item.columns.length;

  return (
    <div className="select-none">
      <button
        type="button"
        className="w-full flex items-center gap-2 py-2 hover:bg-slate-50 rounded-lg text-left transition-colors"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={14} className="text-slate-400 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-slate-400 shrink-0" />
        )}
        <span className="text-sm font-semibold text-slate-800 truncate">{item.table}</span>
        <span className="text-xs text-slate-500 shrink-0">
          {colCount} column{colCount === 1 ? "" : "s"}
          {q && visibleColumns.length !== colCount ? ` · ${visibleColumns.length} shown` : ""}
        </span>
      </button>
      {open && (
        <div className="border-l border-slate-200 ml-3 mb-1">
          {visibleColumns.length === 0 ? (
            <div className="text-xs text-slate-400 py-2 pl-4">No columns match filter.</div>
          ) : (
            visibleColumns.map((col) => (
              <ColumnTreeNode key={`${item.table}.${col.name}`} col={col} depth={depth + 1} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  title: string;
  tables: SchemaTableTreeItem[];
  schemaLabel?: string;
  maxHeightClass?: string;
}

export default function SchemaTablesTree({
  title,
  tables,
  schemaLabel = "plenum_cafm",
  maxHeightClass = "max-h-[min(70vh,720px)]",
}: Props) {
  const [filter, setFilter] = useState("");
  const [expandAll, setExpandAll] = useState(false);

  const totalColumns = tables.reduce((s, t) => s + t.columns.length, 0);

  const visibleTables = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => {
      if (t.table.toLowerCase().includes(q)) return true;
      return t.columns.some(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.dataType?.toLowerCase().includes(q) ?? false),
      );
    });
  }, [tables, filter]);

  if (!tables.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        No table data in this step output.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpandAll(true)}
              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
            >
              Expand all
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => setExpandAll(false)}
              className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
            >
              Collapse all
            </button>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables or columns…"
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="text-[11px] text-slate-500">
          Showing all {tables.length} tables · {totalColumns.toLocaleString()} columns (no truncation)
        </div>
      </div>

      <div className={`overflow-y-auto overflow-x-auto p-3 ${maxHeightClass}`}>
        <SchemaTreeRoot
          schemaLabel={schemaLabel}
          tableCount={tables.length}
          columnCount={totalColumns}
          open={expandAll || !filter}
        />
        <div className="mt-1">
          {visibleTables.map((t, idx) => (
            <TableTreeNode
              key={`${t.table}-${expandAll}-${filter}`}
              item={t}
              depth={1}
              defaultOpen={expandAll || idx === 0 || !!filter.trim()}
              filter={filter}
            />
          ))}
        </div>
        {visibleTables.length === 0 ? (
          <div className="text-sm text-slate-500 py-6 text-center">No tables match your filter.</div>
        ) : null}
      </div>
    </div>
  );
}

function SchemaTreeRoot({
  schemaLabel,
  tableCount,
  columnCount,
  open,
}: {
  schemaLabel: string;
  tableCount: number;
  columnCount: number;
  open: boolean;
}) {
  const [rootOpen, setRootOpen] = useState(true);
  const isOpen = open || rootOpen;

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 py-2 hover:bg-slate-50 rounded-lg text-left"
        onClick={() => setRootOpen((v) => !v)}
      >
        {isOpen ? (
          <ChevronDown size={14} className="text-indigo-500 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-indigo-500 shrink-0" />
        )}
        <span className="text-sm font-bold text-indigo-800">{schemaLabel}</span>
        <span className="text-xs text-slate-500">
          {tableCount} tables · {columnCount.toLocaleString()} columns
        </span>
      </button>
    </div>
  );
}
