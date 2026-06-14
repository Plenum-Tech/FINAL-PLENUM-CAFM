import type { SavedSpaceId } from "./deep-agent-spaces";

export type UdrScriptPhase =
  | "draft"
  | "ingest"
  | "deterministic"
  | "semantic"
  | "hierarchy"
  | "complete";

/** Rich counts captured for history display (Feature 4.5). All optional — the panel renders only what's present. */
export type UdrScriptCounts = {
  sourceFileNames?: string[];
  tableCount?: number;
  columnCount?: number;
  mappedColumnCount?: number;
  mappingCoveragePct?: number;
  hierarchyCount?: number;
  /** Terminal result (e.g. "complete", "failed", "awaiting_review"). */
  lastResult?: string;
};

export type UdrScriptSnapshot = {
  editedAt: number;
  lastPhase: UdrScriptPhase;
  migrationIds: string[];
  documentIds: string[];
  batchIds: string[];
  mappingStatus?: string;
  hierarchyStatus?: string;
  notes?: string;
} & UdrScriptCounts;

/** Saved UDR script — editable mapping run the FM can return to and re-run (Feature 4). */
export type UdrScriptRecord = {
  id: string;
  sessionId: string;
  label: string;
  updatedAt: number;
  editedAt: number;
  migrationIds: string[];
  documentIds: string[];
  batchIds: string[];
  lastPhase: UdrScriptPhase;
  mappingStatus?: string;
  hierarchyStatus?: string;
  notes?: string;
  /** Latest snapshot (denormalized for quick reads). */
  scriptSnapshot?: UdrScriptSnapshot;
  /** One-level rollback (Feature 4 Step 2 alignment). */
  previousSnapshot?: UdrScriptSnapshot;
} & UdrScriptCounts;

const STORAGE_KEY = "plenum_udr_scripts_v1";

function snapshotFromRecord(record: UdrScriptRecord): UdrScriptSnapshot {
  return {
    editedAt: record.editedAt,
    lastPhase: record.lastPhase,
    migrationIds: [...record.migrationIds],
    documentIds: [...record.documentIds],
    batchIds: [...record.batchIds],
    mappingStatus: record.mappingStatus,
    hierarchyStatus: record.hierarchyStatus,
    notes: record.notes,
    sourceFileNames: record.sourceFileNames ? [...record.sourceFileNames] : undefined,
    tableCount: record.tableCount,
    columnCount: record.columnCount,
    mappedColumnCount: record.mappedColumnCount,
    mappingCoveragePct: record.mappingCoveragePct,
    hierarchyCount: record.hierarchyCount,
    lastResult: record.lastResult,
  };
}

function snapshotsEqual(a: UdrScriptSnapshot, b: UdrScriptSnapshot): boolean {
  return (
    a.lastPhase === b.lastPhase &&
    a.mappingStatus === b.mappingStatus &&
    a.hierarchyStatus === b.hierarchyStatus &&
    a.migrationIds.join() === b.migrationIds.join() &&
    a.documentIds.join() === b.documentIds.join() &&
    a.batchIds.join() === b.batchIds.join() &&
    a.tableCount === b.tableCount &&
    a.columnCount === b.columnCount &&
    a.mappedColumnCount === b.mappedColumnCount &&
    a.mappingCoveragePct === b.mappingCoveragePct &&
    a.hierarchyCount === b.hierarchyCount &&
    a.lastResult === b.lastResult &&
    (a.sourceFileNames?.join("|") ?? "") === (b.sourceFileNames?.join("|") ?? "")
  );
}

export function loadUdrScripts(): UdrScriptRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UdrScriptRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistUdrScripts(scripts: UdrScriptRecord[]) {
  if (typeof window === "undefined") return;
  try {
    const sorted = [...scripts].sort((a, b) => b.updatedAt - a.updatedAt);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted.slice(0, 30)));
  } catch {
    /* ignore */
  }
}

export function upsertUdrScript(scripts: UdrScriptRecord[], record: UdrScriptRecord): UdrScriptRecord[] {
  const next = scripts.filter((s) => s.id !== record.id);
  next.push(record);
  return next;
}

export function scriptsForSession(scripts: UdrScriptRecord[], sessionId: string): UdrScriptRecord[] {
  return scripts
    .filter((s) => s.sessionId === sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function restorePreviousUdrSnapshot(record: UdrScriptRecord): UdrScriptRecord | null {
  const prev = record.previousSnapshot;
  if (!prev) return null;
  const now = Date.now();
  const current = snapshotFromRecord(record);
  return {
    ...record,
    updatedAt: now,
    editedAt: now,
    lastPhase: prev.lastPhase,
    migrationIds: [...prev.migrationIds],
    documentIds: [...prev.documentIds],
    batchIds: [...prev.batchIds],
    mappingStatus: prev.mappingStatus,
    hierarchyStatus: prev.hierarchyStatus,
    notes: prev.notes,
    sourceFileNames: prev.sourceFileNames ? [...prev.sourceFileNames] : undefined,
    tableCount: prev.tableCount,
    columnCount: prev.columnCount,
    mappedColumnCount: prev.mappedColumnCount,
    mappingCoveragePct: prev.mappingCoveragePct,
    hierarchyCount: prev.hierarchyCount,
    lastResult: prev.lastResult,
    scriptSnapshot: prev,
    previousSnapshot: current,
  };
}

export function mergeUdrScript(
  existing: UdrScriptRecord | undefined,
  patch: Partial<UdrScriptRecord> & { sessionId: string },
): UdrScriptRecord {
  const id = patch.id ?? existing?.id ?? patch.sessionId;
  const migrationIds = [...new Set([...(existing?.migrationIds ?? []), ...(patch.migrationIds ?? [])])];
  const documentIds = [...new Set([...(existing?.documentIds ?? []), ...(patch.documentIds ?? [])])];
  const batchIds = [...new Set([...(existing?.batchIds ?? []), ...(patch.batchIds ?? [])])];
  const now = Date.now();
  const draft: UdrScriptRecord = {
    id,
    sessionId: patch.sessionId,
    label: patch.label ?? existing?.label ?? "UDR script",
    updatedAt: now,
    editedAt: existing?.editedAt ?? now,
    migrationIds,
    documentIds,
    batchIds,
    lastPhase: patch.lastPhase ?? existing?.lastPhase ?? "draft",
    mappingStatus: patch.mappingStatus ?? existing?.mappingStatus,
    hierarchyStatus: patch.hierarchyStatus ?? existing?.hierarchyStatus,
    notes: patch.notes ?? existing?.notes,
    sourceFileNames: patch.sourceFileNames ?? existing?.sourceFileNames,
    tableCount: patch.tableCount ?? existing?.tableCount,
    columnCount: patch.columnCount ?? existing?.columnCount,
    mappedColumnCount: patch.mappedColumnCount ?? existing?.mappedColumnCount,
    mappingCoveragePct: patch.mappingCoveragePct ?? existing?.mappingCoveragePct,
    hierarchyCount: patch.hierarchyCount ?? existing?.hierarchyCount,
    lastResult: patch.lastResult ?? existing?.lastResult,
    scriptSnapshot: existing?.scriptSnapshot,
    previousSnapshot: existing?.previousSnapshot,
  };

  const nextSnap = snapshotFromRecord(draft);
  const prevSnap = existing?.scriptSnapshot;
  if (prevSnap && !snapshotsEqual(prevSnap, nextSnap)) {
    draft.previousSnapshot = prevSnap;
    draft.editedAt = now;
  }
  draft.scriptSnapshot = nextSnap;

  return draft;
}

export function inferUdrPhase(opts: {
  mappingStatus?: string;
  hierarchyStatus?: string;
  hasMigration?: boolean;
  hasDocuments?: boolean;
}): UdrScriptPhase {
  const map = (opts.mappingStatus ?? "").toLowerCase();
  const hier = (opts.hierarchyStatus ?? "").toLowerCase();
  if (map === "complete" && hier === "complete") return "complete";
  if (hier === "in_progress" || hier === "complete") return "hierarchy";
  if (map === "in_progress" || map === "complete") return "semantic";
  if (opts.hasMigration || opts.hasDocuments) return "ingest";
  return "draft";
}

/** Saved space id for UDR script sessions (Feature 2 alignment). */
export const UDR_SCRIPT_SPACE: SavedSpaceId = "udr";
