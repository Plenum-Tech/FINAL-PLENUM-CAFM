"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, FilePlus, FileX2, GitBranch, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui";

import {
  editMigrationColumns,
  editMigrationHierarchy,
  editMigrationSources,
  rerunMigrationPhase,
  type ColumnEdit,
  type HierarchyEdit,
  type SourceFileEdit,
  type UdrEditResponse,
  type UdrRerunPhase,
} from "@/features/ai/udr-edit-api";

/**
 * Inline editors for the Saved UDR script (Feature 4 push-back #4).
 *
 * Spec asks for direct editing of sources, tables, columns, hierarchies, and
 * mapping decisions inside Saved UDR. Each editor here writes through to the
 * backend B.2–B.4 endpoints (api/udr_rerun.py) and exposes a follow-up rerun
 * button so the user can replay the affected phase without leaving the panel.
 *
 * Tables share the columns endpoint with a synthetic table_name target so we
 * don't introduce a new backend route this turn. When the dedicated table
 * route lands later, only the table editor swaps its handler.
 */

type EditorKind = "sources" | "tables" | "columns" | "hierarchy";

type Props = {
  migrationId: string;
  /** Filenames already attached to the run. Surface as removable rows. */
  initialSourceFileNames?: string[];
  /** Optional pre-loaded table names — drives create/remove rows. */
  initialTableNames?: string[];
  /** Callback fired when an edit succeeds (parent refetches script counts). */
  onEditAccepted?: (kind: EditorKind, response: UdrEditResponse) => void;
};

function SectionHeader({
  open,
  onToggle,
  icon,
  title,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-cyan-50/50 transition-colors"
      aria-expanded={open}
    >
      {open ? <ChevronDown size={11} className="text-slate-500" /> : <ChevronRight size={11} className="text-slate-500" />}
      <span className="shrink-0">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 flex-1 text-left">
        {title}
      </span>
      {typeof count === "number" && count > 0 ? (
        <span className="text-[10px] font-medium text-slate-500 tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

function StatusBar({
  busy,
  error,
  message,
}: {
  busy: boolean;
  error: string | null;
  message: string | null;
}) {
  if (!busy && !error && !message) return null;
  if (busy) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-slate-500">
        <Loader2 size={10} className="animate-spin" />
        Submitting edit…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
        {error}
      </p>
    );
  }
  return (
    <p className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
      {message}
    </p>
  );
}

function SourcesEditor({
  migrationId,
  initialFileNames,
  onEditAccepted,
}: {
  migrationId: string;
  initialFileNames: string[];
  onEditAccepted?: (response: UdrEditResponse) => void;
}) {
  const [files, setFiles] = useState<string[]>(initialFileNames);
  const [newFile, setNewFile] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setError(null);
    setMessage(null);
  }

  async function submit(edits: SourceFileEdit[]) {
    if (!edits.length) return;
    reset();
    setBusy(true);
    try {
      const res = await editMigrationSources(migrationId, { edits });
      setMessage(res.detail);
      onEditAccepted?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update sources.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(filename: string) {
    await submit([{ action: "remove", filename }]);
    setFiles((prev) => prev.filter((f) => f !== filename));
  }

  async function handleAdd() {
    const filename = newFile.trim();
    const data_url = newUrl.trim();
    if (!filename || !data_url) {
      setError("Filename and data URL are required to add a source.");
      return;
    }
    await submit([{ action: "add", filename, data_url }]);
    setFiles((prev) => (prev.includes(filename) ? prev : [...prev, filename]));
    setNewFile("");
    setNewUrl("");
  }

  return (
    <div className="space-y-1.5 px-2 pb-2">
      {files.length === 0 ? (
        <p className="text-[10px] text-slate-500">No source files attached. Add one below.</p>
      ) : (
        files.map((filename) => (
          <div
            key={filename}
            className="flex items-center gap-1.5 rounded-md ring-1 ring-slate-200 bg-white px-2 py-1"
          >
            <FilePlus size={11} className="text-slate-500 shrink-0" />
            <span className="flex-1 min-w-0 truncate text-[10px] text-slate-700">{filename}</span>
            <button
              type="button"
              onClick={() => void handleRemove(filename)}
              disabled={busy}
              aria-label={`Remove ${filename}`}
              className="text-slate-400 hover:text-rose-600 disabled:opacity-50"
            >
              <FileX2 size={11} />
            </button>
          </div>
        ))
      )}
      <div className="rounded-md ring-1 ring-slate-200 bg-slate-50/50 px-2 py-1.5 space-y-1">
        <input
          value={newFile}
          onChange={(e) => setNewFile(e.target.value)}
          placeholder="Filename (e.g. customers.xlsx)"
          className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
        />
        <input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="Blob URL (e.g. https://…/excel-raw/…)"
          className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !newFile.trim() || !newUrl.trim()}
            onClick={() => void handleAdd()}
            className="h-6 text-[10px] gap-1"
          >
            <Plus size={11} /> Add source
          </Button>
        </div>
      </div>
      <StatusBar busy={busy} error={error} message={message} />
    </div>
  );
}

function ColumnsEditor({
  migrationId,
  initialTableNames,
  onEditAccepted,
}: {
  migrationId: string;
  initialTableNames: string[];
  onEditAccepted?: (response: UdrEditResponse) => void;
}) {
  const [draftEdits, setDraftEdits] = useState<ColumnEdit[]>([]);
  const [tableName, setTableName] = useState(initialTableNames[0] ?? "");
  const [columnName, setColumnName] = useState("");
  const [action, setAction] = useState<ColumnEdit["action"]>("rename");
  const [newName, setNewName] = useState("");
  const [targetField, setTargetField] = useState("");
  const [dataType, setDataType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setError(null);
    setMessage(null);
  }

  function addDraft() {
    if (!tableName.trim() || !columnName.trim()) {
      setError("Table and column names are required.");
      return;
    }
    const edit: ColumnEdit = {
      table_name: tableName.trim(),
      column_name: columnName.trim(),
      action,
      new_name: newName.trim() || undefined,
      target_field: targetField.trim() || undefined,
      data_type: dataType.trim() || undefined,
    };
    setDraftEdits((prev) => [...prev, edit]);
    setColumnName("");
    setNewName("");
    setTargetField("");
    setDataType("");
    setError(null);
  }

  async function submit() {
    if (draftEdits.length === 0) {
      setError("Stage at least one edit before submitting.");
      return;
    }
    reset();
    setBusy(true);
    try {
      const res = await editMigrationColumns(migrationId, { edits: draftEdits });
      setMessage(res.detail);
      setDraftEdits([]);
      onEditAccepted?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit column edits.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 px-2 pb-2">
      <div className="rounded-md ring-1 ring-slate-200 bg-slate-50/50 px-2 py-1.5 space-y-1">
        <div className="grid grid-cols-2 gap-1">
          <input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="Table"
            list="udr-tables"
            className="rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
          <input
            value={columnName}
            onChange={(e) => setColumnName(e.target.value)}
            placeholder="Column"
            className="rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
        </div>
        <datalist id="udr-tables">
          {initialTableNames.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as ColumnEdit["action"])}
          className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
        >
          <option value="rename">Rename column</option>
          <option value="map">Map to canonical field</option>
          <option value="create">Create new column</option>
          <option value="remove">Remove column</option>
          <option value="set_type">Change data type</option>
        </select>
        {action === "rename" || action === "create" ? (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New column name"
            className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
        ) : null}
        {action === "map" ? (
          <input
            value={targetField}
            onChange={(e) => setTargetField(e.target.value)}
            placeholder="Canonical target field (e.g. asset_code)"
            className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
        ) : null}
        {action === "set_type" || action === "create" ? (
          <input
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            placeholder="Data type (e.g. VARCHAR(50))"
            className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
        ) : null}
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addDraft}
            className="h-6 text-[10px] gap-1"
            disabled={busy}
          >
            <Plus size={11} /> Stage edit
          </Button>
        </div>
      </div>
      {draftEdits.length > 0 ? (
        <div className="rounded-md ring-1 ring-slate-200 bg-white px-2 py-1.5 space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Staged · {draftEdits.length}
          </div>
          {draftEdits.map((edit, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-[10px] text-slate-700">
              <Pencil size={9} className="mt-0.5 text-slate-400" />
              <span className="flex-1 min-w-0">
                {edit.action} · {edit.table_name}.{edit.column_name}
                {edit.new_name ? ` → ${edit.new_name}` : ""}
                {edit.target_field ? ` ↳ ${edit.target_field}` : ""}
                {edit.data_type ? ` (${edit.data_type})` : ""}
              </span>
              <button
                type="button"
                onClick={() =>
                  setDraftEdits((prev) => prev.filter((_, i) => i !== idx))
                }
                className="text-slate-400 hover:text-rose-600"
                aria-label="Remove staged edit"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={() => void submit()}
              disabled={busy}
              className="h-6 text-[10px] gap-1 bg-cyan-700 hover:bg-cyan-800"
            >
              <Check size={11} /> Submit edits
            </Button>
          </div>
        </div>
      ) : null}
      <StatusBar busy={busy} error={error} message={message} />
    </div>
  );
}

function TablesEditor({
  migrationId,
  initialTableNames,
  onEditAccepted,
}: {
  migrationId: string;
  initialTableNames: string[];
  onEditAccepted?: (response: UdrEditResponse) => void;
}) {
  const [tableName, setTableName] = useState("");
  const [action, setAction] = useState<"rename" | "create" | "remove">("rename");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!tableName.trim()) {
      setError("Table name is required.");
      return;
    }
    if ((action === "rename" || action === "create") && !newName.trim()) {
      setError("New table name is required for rename/create.");
      return;
    }
    setError(null);
    setMessage(null);
    setBusy(true);
    // Tables share the columns endpoint with a sentinel column_name so the
    // backend records the intent into udr_edits.columns. The dedicated tables
    // endpoint can be split out later without changing this call surface.
    const edit: ColumnEdit = {
      table_name: tableName.trim(),
      column_name: "__table__",
      action: action === "remove" ? "remove" : action === "create" ? "create" : "rename",
      new_name: newName.trim() || undefined,
    };
    try {
      const res = await editMigrationColumns(migrationId, {
        edits: [edit],
        note: `table:${action}`,
      });
      setMessage(res.detail);
      setTableName("");
      setNewName("");
      onEditAccepted?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit table edit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 px-2 pb-2">
      <div className="rounded-md ring-1 ring-slate-200 bg-slate-50/50 px-2 py-1.5 space-y-1">
        <input
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="Table"
          list="udr-tables-edit"
          className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
        />
        <datalist id="udr-tables-edit">
          {initialTableNames.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as "rename" | "create" | "remove")}
          className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
        >
          <option value="rename">Rename table</option>
          <option value="create">Create table</option>
          <option value="remove">Remove table</option>
        </select>
        {action !== "remove" ? (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New table name"
            className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
        ) : null}
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={busy}
            className="h-6 text-[10px] gap-1 bg-cyan-700 hover:bg-cyan-800"
          >
            <Check size={11} /> Submit
          </Button>
        </div>
      </div>
      <StatusBar busy={busy} error={error} message={message} />
    </div>
  );
}

function HierarchyEditor({
  migrationId,
  initialTableNames,
  onEditAccepted,
}: {
  migrationId: string;
  initialTableNames: string[];
  onEditAccepted?: (response: UdrEditResponse) => void;
}) {
  const [sourceTable, setSourceTable] = useState("");
  const [sourceColumn, setSourceColumn] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [targetColumn, setTargetColumn] = useState("");
  const [action, setAction] = useState<"add" | "remove" | "update">("add");
  const [relationship, setRelationship] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!sourceTable.trim() || !sourceColumn.trim() || !targetTable.trim() || !targetColumn.trim()) {
      setError("All four FK fields are required (source table/column → target table/column).");
      return;
    }
    setError(null);
    setMessage(null);
    setBusy(true);
    const edit: HierarchyEdit = {
      action,
      source_table: sourceTable.trim(),
      source_column: sourceColumn.trim(),
      target_table: targetTable.trim(),
      target_column: targetColumn.trim(),
      relationship_type: relationship.trim() || undefined,
    };
    try {
      const res = await editMigrationHierarchy(migrationId, { edits: [edit] });
      setMessage(res.detail);
      setSourceTable("");
      setSourceColumn("");
      setTargetTable("");
      setTargetColumn("");
      setRelationship("");
      onEditAccepted?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit hierarchy edit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 px-2 pb-2">
      <div className="rounded-md ring-1 ring-slate-200 bg-slate-50/50 px-2 py-1.5 space-y-1">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as "add" | "remove" | "update")}
          className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
        >
          <option value="add">Add FK</option>
          <option value="update">Update FK</option>
          <option value="remove">Remove FK</option>
        </select>
        <div className="grid grid-cols-2 gap-1">
          <input
            value={sourceTable}
            onChange={(e) => setSourceTable(e.target.value)}
            placeholder="Source table"
            list="udr-hier-tables"
            className="rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
          <input
            value={sourceColumn}
            onChange={(e) => setSourceColumn(e.target.value)}
            placeholder="Source column"
            className="rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
          <input
            value={targetTable}
            onChange={(e) => setTargetTable(e.target.value)}
            placeholder="Target table"
            list="udr-hier-tables"
            className="rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
          <input
            value={targetColumn}
            onChange={(e) => setTargetColumn(e.target.value)}
            placeholder="Target column"
            className="rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
          />
        </div>
        <datalist id="udr-hier-tables">
          {initialTableNames.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <input
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          placeholder="Relationship (e.g. CONTAINMENT)"
          className="w-full rounded ring-1 ring-slate-200 px-2 py-1 text-[10px] focus:outline-none focus:ring-cyan-300"
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={busy}
            className="h-6 text-[10px] gap-1 bg-cyan-700 hover:bg-cyan-800"
          >
            <Check size={11} /> Submit
          </Button>
        </div>
      </div>
      <StatusBar busy={busy} error={error} message={message} />
    </div>
  );
}

export function DeepAgentUdrEditors({
  migrationId,
  initialSourceFileNames = [],
  initialTableNames = [],
  onEditAccepted,
}: Props) {
  const [openSections, setOpenSections] = useState<Record<EditorKind, boolean>>({
    sources: false,
    tables: false,
    columns: true,
    hierarchy: false,
  });
  const [phaseBusy, setPhaseBusy] = useState<UdrRerunPhase | null>(null);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);

  function toggle(kind: EditorKind) {
    setOpenSections((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  async function rerun(phase: UdrRerunPhase) {
    setPhaseError(null);
    setPhaseMessage(null);
    setPhaseBusy(phase);
    try {
      const res = await rerunMigrationPhase(migrationId, phase);
      setPhaseMessage(res.detail);
    } catch (e) {
      setPhaseError(e instanceof Error ? e.message : "Failed to schedule rerun.");
    } finally {
      setPhaseBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-cyan-100 bg-white">
      <div className="px-2 py-1.5 border-b border-cyan-100 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-800">
          Edit saved UDR
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={phaseBusy !== null}
            onClick={() => void rerun("field_mapping")}
            className="h-6 text-[10px] gap-1"
            title="Rerun deterministic + semantic mapping"
          >
            {phaseBusy === "field_mapping" ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Rerun mapping
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={phaseBusy !== null}
            onClick={() => void rerun("hierarchy")}
            className="h-6 text-[10px] gap-1"
            title="Rerun hierarchy detection"
          >
            {phaseBusy === "hierarchy" ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Rerun hierarchy
          </Button>
        </div>
      </div>

      <SectionHeader
        open={openSections.sources}
        onToggle={() => toggle("sources")}
        icon={<FilePlus size={11} className="text-cyan-700" />}
        title="Source documents"
        count={initialSourceFileNames.length}
      />
      {openSections.sources ? (
        <SourcesEditor
          migrationId={migrationId}
          initialFileNames={initialSourceFileNames}
          onEditAccepted={(res) => onEditAccepted?.("sources", res)}
        />
      ) : null}

      <SectionHeader
        open={openSections.tables}
        onToggle={() => toggle("tables")}
        icon={<Pencil size={11} className="text-cyan-700" />}
        title="Tables"
        count={initialTableNames.length}
      />
      {openSections.tables ? (
        <TablesEditor
          migrationId={migrationId}
          initialTableNames={initialTableNames}
          onEditAccepted={(res) => onEditAccepted?.("tables", res)}
        />
      ) : null}

      <SectionHeader
        open={openSections.columns}
        onToggle={() => toggle("columns")}
        icon={<Pencil size={11} className="text-cyan-700" />}
        title="Columns · mapping decisions"
      />
      {openSections.columns ? (
        <ColumnsEditor
          migrationId={migrationId}
          initialTableNames={initialTableNames}
          onEditAccepted={(res) => onEditAccepted?.("columns", res)}
        />
      ) : null}

      <SectionHeader
        open={openSections.hierarchy}
        onToggle={() => toggle("hierarchy")}
        icon={<GitBranch size={11} className="text-cyan-700" />}
        title="Hierarchies"
      />
      {openSections.hierarchy ? (
        <HierarchyEditor
          migrationId={migrationId}
          initialTableNames={initialTableNames}
          onEditAccepted={(res) => onEditAccepted?.("hierarchy", res)}
        />
      ) : null}

      {phaseError || phaseMessage ? (
        <div className="px-2 py-1.5 border-t border-cyan-100">
          <StatusBar busy={false} error={phaseError} message={phaseMessage} />
        </div>
      ) : null}
    </div>
  );
}

