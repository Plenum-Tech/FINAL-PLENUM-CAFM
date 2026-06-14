"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Check, ChevronDown, ChevronUp, Database, FileText, GitBranch, History, Layers, Pencil, Play, RefreshCw, RotateCw, Upload, X } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";

import {
  createUdrRun,
  listUdrRuns,
  renameUdrRun,
  type UdrRunVersion,
} from "../../udr-runs-api";
import { DeepAgentUdrEditors } from "./deep-agent-udr-editors";
import { buildUdrHierarchyPrompt } from "./plenum-target-hierarchy";
import type { UdrForcedRoute } from "./udr-route-context";
import {
  inferUdrPhase,
  loadUdrScripts,
  mergeUdrScript,
  persistUdrScripts,
  restorePreviousUdrSnapshot,
  scriptsForSession,
  upsertUdrScript,
  type UdrScriptPhase,
  type UdrScriptRecord,
} from "./udr-script-storage";

export type DeepAgentUdrContext = {
  sessionId: string;
  migrationIds: string[];
  documentIds: string[];
  batchIds: string[];
  mappingStatus?: string;
  hierarchyStatus?: string;
  /** Canonical tables from migration/schema when available. */
  canonicalTables?: string[];
  /** Rich counts surfaced in the panel and the saved-version snapshot (Feature 4.5). */
  sourceFileNames?: string[];
  tableCount?: number;
  columnCount?: number;
  mappedColumnCount?: number;
  mappingCoveragePct?: number;
  hierarchyCount?: number;
  lastResult?: string;
};

const PHASE_LABEL: Record<UdrScriptPhase, string> = {
  draft: "Draft",
  ingest: "Ingested",
  deterministic: "Deterministic map",
  semantic: "Semantic review",
  hierarchy: "Hierarchy",
  complete: "Complete",
};

type UdrCountsSource = {
  sourceFileNames?: string[];
  tableCount?: number;
  columnCount?: number;
  mappedColumnCount?: number;
  mappingCoveragePct?: number;
  hierarchyCount?: number;
};

function UdrCountsLine({ record }: { record: UdrCountsSource }) {
  const sourceCount = record.sourceFileNames?.length ?? 0;
  const hasAny =
    sourceCount > 0 ||
    typeof record.tableCount === "number" ||
    typeof record.columnCount === "number" ||
    typeof record.mappedColumnCount === "number" ||
    typeof record.mappingCoveragePct === "number" ||
    typeof record.hierarchyCount === "number";
  if (!hasAny) return null;
  const parts: string[] = [];
  if (sourceCount > 0) parts.push(`${sourceCount} source file${sourceCount === 1 ? "" : "s"}`);
  if (typeof record.tableCount === "number") parts.push(`${record.tableCount} table${record.tableCount === 1 ? "" : "s"}`);
  if (typeof record.columnCount === "number") {
    const mapped =
      typeof record.mappedColumnCount === "number" ? `${record.mappedColumnCount}/${record.columnCount}` : `${record.columnCount}`;
    parts.push(`${mapped} column${record.columnCount === 1 ? "" : "s"}`);
  } else if (typeof record.mappedColumnCount === "number") {
    parts.push(`${record.mappedColumnCount} columns mapped`);
  }
  if (typeof record.mappingCoveragePct === "number") parts.push(`${Math.round(record.mappingCoveragePct)}% coverage`);
  if (typeof record.hierarchyCount === "number") {
    parts.push(`${record.hierarchyCount} hierarchy link${record.hierarchyCount === 1 ? "" : "s"}`);
  }
  return <p className="text-[9px] text-slate-500 mt-0.5 truncate">{parts.join(" · ")}</p>;
}

function UdrVersionCompareCard({
  left,
  right,
  onClose,
}: {
  left: UdrRunVersion;
  right: UdrRunVersion;
  onClose: () => void;
}) {
  const leftCounts = pickCountsFromSnapshot(left.snapshot);
  const rightCounts = pickCountsFromSnapshot(right.snapshot);
  const rows: { label: string; l: string; r: string }[] = [
    {
      label: "Phase",
      l: left.phase ?? "—",
      r: right.phase ?? "—",
    },
    {
      label: "Source files",
      l: String(leftCounts.sourceFileNames?.length ?? 0),
      r: String(rightCounts.sourceFileNames?.length ?? 0),
    },
    {
      label: "Tables",
      l: leftCounts.tableCount != null ? String(leftCounts.tableCount) : "—",
      r: rightCounts.tableCount != null ? String(rightCounts.tableCount) : "—",
    },
    {
      label: "Columns mapped",
      l:
        leftCounts.mappedColumnCount != null && leftCounts.columnCount != null
          ? `${leftCounts.mappedColumnCount}/${leftCounts.columnCount}`
          : leftCounts.mappedColumnCount != null
            ? String(leftCounts.mappedColumnCount)
            : "—",
      r:
        rightCounts.mappedColumnCount != null && rightCounts.columnCount != null
          ? `${rightCounts.mappedColumnCount}/${rightCounts.columnCount}`
          : rightCounts.mappedColumnCount != null
            ? String(rightCounts.mappedColumnCount)
            : "—",
    },
    {
      label: "Coverage",
      l:
        leftCounts.mappingCoveragePct != null
          ? `${Math.round(leftCounts.mappingCoveragePct)}%`
          : "—",
      r:
        rightCounts.mappingCoveragePct != null
          ? `${Math.round(rightCounts.mappingCoveragePct)}%`
          : "—",
    },
    {
      label: "Hierarchy",
      l: leftCounts.hierarchyCount != null ? String(leftCounts.hierarchyCount) : "—",
      r: rightCounts.hierarchyCount != null ? String(rightCounts.hierarchyCount) : "—",
    },
  ];
  return (
    <div className="rounded-md border border-cyan-200 bg-cyan-50/40 p-2 space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-800">
          Compare v{left.version_no} ↔ v{right.version_no}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Close compare"
        >
          <X size={11} />
        </button>
      </div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-medium">Field</th>
            <th className="text-right font-medium">v{left.version_no}</th>
            <th className="text-right font-medium">v{right.version_no}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.l !== r.r;
            return (
              <tr key={r.label} className={diff ? "text-cyan-900 font-medium" : "text-slate-700"}>
                <td className="py-0.5">{r.label}</td>
                <td className="text-right tabular-nums">{r.l}</td>
                <td className="text-right tabular-nums">{r.r}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pickCountsFromSnapshot(snapshot: Record<string, unknown> | null | undefined): UdrCountsSource {
  if (!snapshot || typeof snapshot !== "object") return {};
  const s = snapshot as Record<string, unknown>;
  const out: UdrCountsSource = {};
  if (Array.isArray(s.sourceFileNames)) {
    out.sourceFileNames = s.sourceFileNames.filter((v): v is string => typeof v === "string");
  }
  if (typeof s.tableCount === "number") out.tableCount = s.tableCount;
  if (typeof s.columnCount === "number") out.columnCount = s.columnCount;
  if (typeof s.mappedColumnCount === "number") out.mappedColumnCount = s.mappedColumnCount;
  if (typeof s.mappingCoveragePct === "number") out.mappingCoveragePct = s.mappingCoveragePct;
  if (typeof s.hierarchyCount === "number") out.hierarchyCount = s.hierarchyCount;
  return out;
}

export type UdrRunPinOptions = {
  forcedRoute?: UdrForcedRoute;
  migrationId?: string;
};

type Props = {
  context: DeepAgentUdrContext;
  onDismiss?: () => void;
  onRunPin: (prompt: string, opts?: UdrRunPinOptions) => void;
  onOpenMigration: (migrationId: string) => void | Promise<void>;
  embeddedRail?: boolean;
};

export function DeepAgentUdrPanel({
  context,
  onRunPin,
  onOpenMigration,
  embeddedRail = true,
}: Props) {
  const [scripts, setScripts] = useState<UdrScriptRecord[]>([]);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [openingMigration, setOpeningMigration] = useState(false);

  const sessionScripts = useMemo(
    () => scriptsForSession(scripts, context.sessionId),
    [scripts, context.sessionId],
  );
  const active = sessionScripts[0];

  const hierarchyPrompt = useMemo(
    () => buildUdrHierarchyPrompt(context.canonicalTables),
    [context.canonicalTables],
  );

  useEffect(() => {
    setScripts(loadUdrScripts());
  }, []);

  const runAction = useCallback(
    (prompt: string, forcedRoute: UdrForcedRoute, migrationId?: string) => {
      onRunPin(prompt, { forcedRoute, migrationId: migrationId ?? context.migrationIds[0] });
    },
    [context.migrationIds, onRunPin],
  );

  const handleOpenMigration = useCallback(
    async (migrationId: string) => {
      setMigrationError(null);
      setOpeningMigration(true);
      try {
        await onOpenMigration(migrationId);
      } catch {
        setMigrationError(
          "Could not open this migration run. It may no longer exist — re-run ingest or upload files to restore mappings.",
        );
      } finally {
        setOpeningMigration(false);
      }
    },
    [onOpenMigration],
  );

  const handleUndo = useCallback(() => {
    if (!active?.previousSnapshot) return;
    const restored = restorePreviousUdrSnapshot(active);
    if (!restored) return;
    const all = loadUdrScripts();
    persistUdrScripts(upsertUdrScript(all, restored));
    setScripts(loadUdrScripts());
  }, [active]);

  // ── WP-4: backend-persisted run versions (last 3, cross-device) ─────────────
  const [versions, setVersions] = useState<UdrRunVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [savingVersion, setSavingVersion] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Compare mode (push-back #4 — UDR versioning).
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const compareReady = compareSelection.length === 2;
  // History collapsed by default — whenever the active version changes
  // (rerun / restart / branch / restore all create a new top version),
  // collapse the previous versions automatically so the user stays focused
  // on the current execution.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const lastActiveVersionIdRef = useRef<string | null>(null);
  const activeVersion = versions[0] ?? null;
  const previousVersions = versions.slice(1);
  useEffect(() => {
    const nextId = activeVersion?.id ?? null;
    if (nextId !== lastActiveVersionIdRef.current) {
      lastActiveVersionIdRef.current = nextId;
      setHistoryExpanded(false);
      setCompareSelection([]);
    }
  }, [activeVersion?.id]);

  const loadVersions = useCallback(async () => {
    if (!context.sessionId) return;
    setVersionsLoading(true);
    setVersionError(null);
    try {
      setVersions(await listUdrRuns(context.sessionId, 3));
    } catch (e) {
      setVersionError(e instanceof Error ? e.message : "Could not load saved versions.");
    } finally {
      setVersionsLoading(false);
    }
  }, [context.sessionId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const handleSaveVersion = useCallback(async () => {
    setSavingVersion(true);
    setVersionError(null);
    try {
      const snapshot: Record<string, unknown> = {};
      const sourceFiles = context.sourceFileNames ?? active?.sourceFileNames;
      if (sourceFiles?.length) snapshot.sourceFileNames = sourceFiles;
      const tableCount = context.tableCount ?? active?.tableCount;
      if (typeof tableCount === "number") snapshot.tableCount = tableCount;
      const columnCount = context.columnCount ?? active?.columnCount;
      if (typeof columnCount === "number") snapshot.columnCount = columnCount;
      const mappedColumnCount = context.mappedColumnCount ?? active?.mappedColumnCount;
      if (typeof mappedColumnCount === "number") snapshot.mappedColumnCount = mappedColumnCount;
      const mappingCoveragePct = context.mappingCoveragePct ?? active?.mappingCoveragePct;
      if (typeof mappingCoveragePct === "number") snapshot.mappingCoveragePct = mappingCoveragePct;
      const hierarchyCount = context.hierarchyCount ?? active?.hierarchyCount;
      if (typeof hierarchyCount === "number") snapshot.hierarchyCount = hierarchyCount;
      const lastResult = context.lastResult ?? active?.lastResult;
      if (lastResult) snapshot.lastResult = lastResult;

      await createUdrRun({
        sessionId: context.sessionId,
        phase: active?.lastPhase,
        mappingStatus: context.mappingStatus ?? active?.mappingStatus,
        hierarchyStatus: context.hierarchyStatus ?? active?.hierarchyStatus,
        migrationIds: active?.migrationIds ?? context.migrationIds,
        documentIds: active?.documentIds ?? context.documentIds,
        batchIds: active?.batchIds ?? context.batchIds,
        snapshot: Object.keys(snapshot).length ? snapshot : undefined,
      });
      await loadVersions();
    } catch (e) {
      setVersionError(e instanceof Error ? e.message : "Could not save version.");
    } finally {
      setSavingVersion(false);
    }
  }, [active, context, loadVersions]);

  // After an editor submit succeeds, snapshot the script as a new version so
  // every edit shows up as v1 / v2 / v3 — the spec's reusable-asset model.
  const handleAutoVersionAfterEdit = useCallback(
    async (label: string) => {
      try {
        const snapshot: Record<string, unknown> = {};
        const sourceFiles = active?.sourceFileNames ?? context.sourceFileNames;
        if (sourceFiles?.length) snapshot.sourceFileNames = sourceFiles;
        if (typeof active?.tableCount === "number") snapshot.tableCount = active.tableCount;
        if (typeof active?.columnCount === "number") snapshot.columnCount = active.columnCount;
        if (typeof active?.mappedColumnCount === "number")
          snapshot.mappedColumnCount = active.mappedColumnCount;
        if (typeof active?.mappingCoveragePct === "number")
          snapshot.mappingCoveragePct = active.mappingCoveragePct;
        if (typeof active?.hierarchyCount === "number")
          snapshot.hierarchyCount = active.hierarchyCount;
        snapshot.editLabel = label;
        await createUdrRun({
          sessionId: context.sessionId,
          customName: label,
          phase: active?.lastPhase,
          mappingStatus: context.mappingStatus ?? active?.mappingStatus,
          hierarchyStatus: context.hierarchyStatus ?? active?.hierarchyStatus,
          migrationIds: active?.migrationIds ?? context.migrationIds,
          documentIds: active?.documentIds ?? context.documentIds,
          batchIds: active?.batchIds ?? context.batchIds,
          snapshot: Object.keys(snapshot).length ? snapshot : undefined,
        });
        await loadVersions();
      } catch (e) {
        setVersionError(e instanceof Error ? e.message : "Could not snapshot version.");
      }
    },
    [active, context, loadVersions],
  );

  // Restore a version: copy its snapshot into the active UdrScriptRecord and
  // record the restore as a fresh version so history stays linear.
  const handleRestoreVersion = useCallback(
    async (version: UdrRunVersion) => {
      try {
        const snap = version.snapshot ?? null;
        await createUdrRun({
          sessionId: context.sessionId,
          customName: `Restore of v${version.version_no}`,
          phase: version.phase,
          mappingStatus: version.mapping_status,
          hierarchyStatus: version.hierarchy_status,
          migrationIds: version.migration_ids,
          documentIds: version.document_ids,
          batchIds: version.batch_ids,
          snapshot: snap,
        });
        if (active) {
          const restored: UdrScriptRecord = mergeUdrScript(active, {
            id: active.id,
            sessionId: active.sessionId,
            label: active.label,
            migrationIds: version.migration_ids,
            documentIds: version.document_ids,
            batchIds: version.batch_ids,
            mappingStatus: version.mapping_status ?? undefined,
            hierarchyStatus: version.hierarchy_status ?? undefined,
            sourceFileNames: Array.isArray((snap as Record<string, unknown> | null)?.sourceFileNames)
              ? ((snap as Record<string, unknown>).sourceFileNames as string[])
              : undefined,
            tableCount:
              typeof (snap as Record<string, unknown> | null)?.tableCount === "number"
                ? ((snap as Record<string, unknown>).tableCount as number)
                : undefined,
            columnCount:
              typeof (snap as Record<string, unknown> | null)?.columnCount === "number"
                ? ((snap as Record<string, unknown>).columnCount as number)
                : undefined,
            mappedColumnCount:
              typeof (snap as Record<string, unknown> | null)?.mappedColumnCount === "number"
                ? ((snap as Record<string, unknown>).mappedColumnCount as number)
                : undefined,
            mappingCoveragePct:
              typeof (snap as Record<string, unknown> | null)?.mappingCoveragePct === "number"
                ? ((snap as Record<string, unknown>).mappingCoveragePct as number)
                : undefined,
            hierarchyCount:
              typeof (snap as Record<string, unknown> | null)?.hierarchyCount === "number"
                ? ((snap as Record<string, unknown>).hierarchyCount as number)
                : undefined,
          });
          const all = loadUdrScripts();
          persistUdrScripts(upsertUdrScript(all, restored));
          setScripts(loadUdrScripts());
        }
        await loadVersions();
      } catch (e) {
        setVersionError(e instanceof Error ? e.message : "Could not restore version.");
      }
    },
    [active, context.sessionId, loadVersions],
  );

  // Branch a version: clone its snapshot as a new version that becomes the
  // start of a parallel edit chain.
  const handleBranchVersion = useCallback(
    async (version: UdrRunVersion) => {
      try {
        await createUdrRun({
          sessionId: context.sessionId,
          customName: `Branch of v${version.version_no}`,
          phase: version.phase,
          mappingStatus: version.mapping_status,
          hierarchyStatus: version.hierarchy_status,
          migrationIds: version.migration_ids,
          documentIds: version.document_ids,
          batchIds: version.batch_ids,
          snapshot: version.snapshot,
        });
        await loadVersions();
      } catch (e) {
        setVersionError(e instanceof Error ? e.message : "Could not branch version.");
      }
    },
    [context.sessionId, loadVersions],
  );

  const handleRename = useCallback(
    async (runId: string) => {
      const name = renameValue.trim();
      if (!name) {
        setRenamingId(null);
        return;
      }
      try {
        await renameUdrRun(runId, name);
        setRenamingId(null);
        await loadVersions();
      } catch (e) {
        setVersionError(e instanceof Error ? e.message : "Could not rename version.");
      }
    },
    [renameValue, loadVersions],
  );

  const primaryMigration = context.migrationIds[0] ?? active?.migrationIds[0];

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-2xl border border-cyan-200 bg-gradient-to-b from-cyan-50/50 to-white shadow-sm",
        embeddedRail ? "text-xs" : "text-sm",
      )}
    >
      <div className="shrink-0 flex items-center justify-between gap-2 border-b border-cyan-100 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Database size={16} className="text-cyan-700 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-slate-800 truncate">Saved UDR script</div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Re-open, edit mappings, add docs, re-run pipeline steps.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {active ? (
          <div className="rounded-lg border border-cyan-100 bg-white px-2.5 py-2">
            <div className="font-medium text-slate-800 truncate">{active.label}</div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
              <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-cyan-800">
                {PHASE_LABEL[active.lastPhase]}
              </span>
              {active.migrationIds.length ? (
                <span>{active.migrationIds.length} migration run(s)</span>
              ) : null}
              {active.documentIds.length ? (
                <span>{active.documentIds.length} doc(s)</span>
              ) : null}
              {active.previousSnapshot ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-cyan-700 hover:underline"
                  onClick={handleUndo}
                >
                  <History size={10} />
                  Undo last change
                </button>
              ) : null}
            </div>
            <UdrCountsLine record={active} />
            {active.sourceFileNames?.length ? (
              <p
                className="text-[9px] text-slate-500 mt-0.5 truncate"
                title={active.sourceFileNames.join(", ")}
              >
                Sources: {active.sourceFileNames.slice(0, 3).join(", ")}
                {active.sourceFileNames.length > 3
                  ? ` (+${active.sourceFileNames.length - 3} more)`
                  : ""}
              </p>
            ) : null}
            {active.editedAt ? (
              <p className="text-[9px] text-slate-400 mt-1">
                Updated {new Date(active.editedAt).toLocaleString()}
                {active.lastResult ? ` · ${active.lastResult}` : ""}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No saved script for this session yet. Ingest files or start mapping — it will be indexed here automatically.
          </p>
        )}

        {versions.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap rounded-lg border border-cyan-100 bg-white px-2 py-1.5">
            <History size={11} className="text-cyan-600 shrink-0" />
            <span className="text-[10px] font-medium text-slate-600">Migration version:</span>
            <select
              value=""
              onChange={(e) => {
                const v = versions.find((x) => x.id === e.target.value);
                const mid = v?.migration_ids?.[0];
                if (mid) void handleOpenMigration(mid);
              }}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] max-w-[10rem]"
              title="Open a saved migration version by ID"
            >
              <option value="">Select…</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_no}
                  {v.custom_name ? ` · ${v.custom_name}` : ""} — {(v.migration_ids[0] ?? "").slice(0, 8)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleSaveVersion()}
              disabled={savingVersion}
              className="rounded border border-cyan-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
            >
              {savingVersion ? "Saving…" : "Save version"}
            </button>
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
          <div className="text-[10px] font-semibold text-slate-600 mb-1">Target hierarchy (plenum_cafm)</div>
          <p className="text-[10px] text-slate-600 leading-snug">{hierarchyPrompt}</p>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Re-run steps</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 h-8 text-[11px]"
            onClick={() =>
              runAction(
                "Ingest the attached certificates, warranties, or readings into Doc RAG and UDR. Summarize what was indexed.",
                "udr_ingest_documents",
              )
            }
          >
            <Upload size={13} />
            Ingest documents
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 h-8 text-[11px]"
            onClick={() =>
              runAction(
                `${hierarchyPrompt} Re-run deterministic and semantic field mapping on the latest ingested dataset.`,
                "udr_run_mapping_hierarchy",
                primaryMigration,
              )
            }
          >
            <RefreshCw size={13} />
            Re-run mapping (deterministic + semantic)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 h-8 text-[11px]"
            onClick={() =>
              runAction(
                `${hierarchyPrompt} Run hierarchy detection again on the current mappings and show FK / parent-child results.`,
                "udr_run_mapping_hierarchy",
                primaryMigration,
              )
            }
          >
            <Layers size={13} />
            Re-run hierarchy detection
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 h-8 text-[11px]"
            onClick={() =>
              runAction(
                "Run the full UDR pipeline: verify ingestion, mapping, hierarchy, and report status for this saved script.",
                "udr_run_mapping_hierarchy",
                primaryMigration,
              )
            }
          >
            <Play size={13} />
            Run full UDR
          </Button>
        </div>

        {migrationError ? (
          <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            {migrationError}
          </p>
        ) : null}

        {primaryMigration ? (
          <>
            <Button
              type="button"
              size="sm"
              className="w-full gap-2 h-8 text-[11px] bg-cyan-700 hover:bg-cyan-800"
              disabled={openingMigration}
              onClick={() => void handleOpenMigration(primaryMigration)}
            >
              <FileText size={13} />
              {openingMigration ? "Opening…" : "Edit mappings & gates"}
            </Button>
            {/* Direct, in-panel editors (push-back #4): source documents,
                tables, columns / mapping decisions, hierarchies. Each
                editor writes through to the Saved-UDR backend endpoints. */}
            <DeepAgentUdrEditors
              migrationId={primaryMigration}
              initialSourceFileNames={active?.sourceFileNames ?? context.sourceFileNames ?? []}
              initialTableNames={context.canonicalTables ?? []}
              onEditAccepted={(kind) => {
                void handleAutoVersionAfterEdit(`Edit · ${kind}`);
              }}
            />
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            No migration run linked yet. Upload structured data or run ingest to open field-mapping gates.
          </p>
        )}

        <div className="pt-1 border-t border-slate-100 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Run versions
            </div>
            <div className="flex items-center gap-1.5">
              {compareSelection.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCompareSelection([])}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800"
                >
                  Clear ({compareSelection.length}/2)
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSaveVersion()}
                disabled={savingVersion}
                className="inline-flex items-center gap-1 text-[10px] text-cyan-700 hover:underline disabled:opacity-50"
              >
                <History size={10} />
                {savingVersion ? "Saving…" : "Save current"}
              </button>
            </div>
          </div>

          {compareReady ? (
            <UdrVersionCompareCard
              left={versions.find((v) => v.id === compareSelection[0])!}
              right={versions.find((v) => v.id === compareSelection[1])!}
              onClose={() => setCompareSelection([])}
            />
          ) : null}

          {versionError ? (
            <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
              {versionError}
            </p>
          ) : null}

          {versionsLoading ? (
            <p className="text-[10px] text-slate-400">Loading versions…</p>
          ) : versions.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No saved versions yet. Click “Save current” to snapshot this run — the last 3 are kept here and on the server.
            </p>
          ) : (
            (historyExpanded ? versions : versions.slice(0, 1)).map((v) => (
              <div
                key={v.id}
                className={cn(
                  "rounded-md border bg-white px-2 py-1.5",
                  v.id === activeVersion?.id
                    ? "border-cyan-300 ring-1 ring-cyan-200"
                    : "border-slate-200",
                )}
              >
                {renamingId === v.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRename(v.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="flex-1 min-w-0 rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                    />
                    <button type="button" onClick={() => void handleRename(v.id)} className="text-cyan-700" aria-label="Save name">
                      <Check size={12} />
                    </button>
                    <button type="button" onClick={() => setRenamingId(null)} className="text-slate-400" aria-label="Cancel">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-1">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left"
                        onClick={() => v.migration_ids[0] && void handleOpenMigration(v.migration_ids[0])}
                        title={v.migration_ids[0] ? "Open this version's mappings & gates" : "No migration linked"}
                      >
                        <span className="block truncate text-[11px] font-medium text-slate-700">
                          v{v.version_no} · {v.custom_name ?? `Version ${v.version_no}`}
                          {v.id === activeVersion?.id ? (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-cyan-600 px-1.5 py-px text-[9px] font-medium text-white align-middle">
                              Active
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[9px] text-slate-400">
                          {v.phase ? PHASE_LABEL[v.phase as UdrScriptPhase] ?? v.phase : "—"} ·{" "}
                          {new Date(v.created_at).toLocaleString()}
                        </span>
                        <UdrCountsLine record={pickCountsFromSnapshot(v.snapshot)} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(v.id);
                          setRenameValue(v.custom_name ?? `Version ${v.version_no}`);
                        }}
                        className="shrink-0 text-slate-400 hover:text-cyan-700"
                        aria-label="Rename version"
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          setCompareSelection((prev) =>
                            prev.includes(v.id)
                              ? prev.filter((id) => id !== v.id)
                              : prev.length >= 2
                                ? [prev[1], v.id]
                                : [...prev, v.id],
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                          compareSelection.includes(v.id)
                            ? "bg-cyan-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                        )}
                        title="Toggle for compare (pick two versions)"
                      >
                        <ArrowLeftRight size={9} />
                        Compare
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRestoreVersion(v)}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                        title="Restore this version into the active script"
                      >
                        <RotateCw size={9} />
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleBranchVersion(v)}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                        title="Create a new version chain starting from here"
                      >
                        <GitBranch size={9} />
                        Branch
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {previousVersions.length > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryExpanded((v) => !v)}
              className={cn(
                "w-full inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors",
                historyExpanded
                  ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
                  : "border border-cyan-200 bg-cyan-50/60 text-cyan-800 hover:bg-cyan-100/60",
              )}
              aria-expanded={historyExpanded}
              title="Previous versions are preserved — nothing is deleted by Restart, Branch, or Restore."
            >
              {historyExpanded ? (
                <>
                  <ChevronUp size={11} />
                  Hide previous versions
                </>
              ) : (
                <>
                  <History size={11} />
                  Show {previousVersions.length} previous version
                  {previousVersions.length === 1 ? "" : "s"}
                  <ChevronDown size={11} />
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Persist script snapshot from orchestrator workspace + contexts. */
export function syncUdrScriptFromContext(context: DeepAgentUdrContext, label?: string) {
  const all = loadUdrScripts();
  const existing = scriptsForSession(all, context.sessionId)[0];
  const record = mergeUdrScript(existing, {
    id: context.sessionId,
    sessionId: context.sessionId,
    label: label ?? existing?.label ?? "UDR script",
    migrationIds: context.migrationIds,
    documentIds: context.documentIds,
    batchIds: context.batchIds,
    mappingStatus: context.mappingStatus,
    hierarchyStatus: context.hierarchyStatus,
    sourceFileNames: context.sourceFileNames,
    tableCount: context.tableCount,
    columnCount: context.columnCount,
    mappedColumnCount: context.mappedColumnCount,
    mappingCoveragePct: context.mappingCoveragePct,
    hierarchyCount: context.hierarchyCount,
    lastResult: context.lastResult,
    lastPhase: inferUdrPhase({
      mappingStatus: context.mappingStatus,
      hierarchyStatus: context.hierarchyStatus,
      hasMigration: context.migrationIds.length > 0,
      hasDocuments: context.documentIds.length > 0,
    }),
  });
  const next = upsertUdrScript(all, record);
  persistUdrScripts(next);
  return record;
}
