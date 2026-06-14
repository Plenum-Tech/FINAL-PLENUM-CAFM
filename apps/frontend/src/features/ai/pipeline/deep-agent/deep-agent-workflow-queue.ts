/**
 * Per-session workflow queue (push-back #5 — the missing foundation).
 *
 * The orchestrator is workflow-first: a session is a graph of
 *   uploads → workflows → recommendations → completions
 * which must reconstruct identically after a refresh, a Saved-Space jump,
 * a session restore, or a fresh login. None of this lived in persistent
 * state before — the task strip was derived from in-memory orch context.
 *
 * This module is the single source of truth, persisted in localStorage and
 * keyed by sessionId. Everything else (task buckets, recommendations, the
 * Activity Log derivations) reads from it.
 *
 * Storage key: ``plenum_workflow_queue_v1:${sessionId}``
 *
 * What's stored
 *   - uploads[]  — every file the user dropped into the composer that the
 *                  orchestrator accepted, with the workflow it was routed to.
 *   - workflows[] — every workflow run that started for this session, with
 *                  its status, source uploads, and any backend id.
 *
 * What's derived (not stored)
 *   - active workflows   — workflows[] filtered to running / awaiting_input
 *   - completed workflows — workflows[] filtered to complete / failed
 *   - recommendations    — uploads[] whose intended workflow isn't yet
 *                          present in workflows[]
 */
import type { SavedSpaceId } from "./deep-agent-spaces";

export type WorkflowKind = "migration" | "documents" | "schema" | "work_order";

export type WorkflowStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "complete"
  | "failed";

/** Upload registered with the orchestrator. */
export type WorkflowQueueUpload = {
  id: string;
  filename: string;
  size?: number;
  /** Workflow the orchestrator routed this upload to (best-guess at upload time). */
  intendedKind: WorkflowKind;
  /** When the user dropped the file. */
  uploadedAt: number;
  /** Workflow run id once one has been kicked off (mirrors WorkflowQueueRun.id). */
  consumedBy?: string;
  /** Free-text label shown alongside the chip when something needs explaining. */
  label?: string;
};

/** A workflow run that exists for this session. */
export type WorkflowQueueRun = {
  id: string;
  kind: WorkflowKind;
  /** Backend-issued workflow id when one exists (migration_id, schema_mapping_id, document_id, etc.). */
  backendId?: string;
  /** Uploads consumed by this run, by upload.id. */
  uploadIds: string[];
  status: WorkflowStatus;
  /** Short display label. */
  title: string;
  /** Phase or gate label when paused. */
  detail?: string;
  /** Human-readable gate label (e.g. "Pre-semantic review") shown above the progress bar. */
  gateLabel?: string;
  /** Current step number (1-indexed). */
  step?: number;
  /** Total step count. */
  totalSteps?: number;
  /** 0-100 progress percentage when known. */
  progressPct?: number;
  /** Timestamps for ordering + activity-log reconstruction. */
  startedAt: number;
  updatedAt: number;
  /** Saved-space hint so spaces can filter their workspace view. */
  space?: SavedSpaceId;
};

export type WorkflowQueueState = {
  sessionId: string;
  uploads: WorkflowQueueUpload[];
  workflows: WorkflowQueueRun[];
  /** Storage schema version — bump when persistence shape changes. */
  schemaVersion: 1;
};

const KEY_PREFIX = "plenum_workflow_queue_v1";

function key(sessionId: string): string {
  return `${KEY_PREFIX}:${sessionId}`;
}

function emptyState(sessionId: string): WorkflowQueueState {
  return { sessionId, uploads: [], workflows: [], schemaVersion: 1 };
}

export function loadWorkflowQueue(sessionId: string): WorkflowQueueState {
  if (typeof window === "undefined" || !sessionId) return emptyState(sessionId);
  try {
    const raw = window.localStorage.getItem(key(sessionId));
    if (!raw) return emptyState(sessionId);
    const parsed = JSON.parse(raw) as Partial<WorkflowQueueState>;
    if (!parsed || parsed.schemaVersion !== 1) return emptyState(sessionId);
    return {
      sessionId,
      uploads: Array.isArray(parsed.uploads) ? parsed.uploads : [],
      workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
      schemaVersion: 1,
    };
  } catch {
    return emptyState(sessionId);
  }
}

export function persistWorkflowQueue(state: WorkflowQueueState): void {
  if (typeof window === "undefined" || !state.sessionId) return;
  try {
    window.localStorage.setItem(key(state.sessionId), JSON.stringify(state));
  } catch {
    /* quota / SSR */
  }
}

function nextId(prefix: string, existing: Set<string>): string {
  // Counter pattern instead of Date.now() so we don't conflict with the
  // session's persist-and-reload cycle (multiple uploads in the same tick).
  let i = 1;
  let candidate = `${prefix}_${i}`;
  while (existing.has(candidate)) {
    i += 1;
    candidate = `${prefix}_${i}`;
  }
  return candidate;
}

/** Detect intended workflow from a filename. Mirrors single-door classifier. */
export function intendedKindForFilename(filename: string): WorkflowKind | null {
  const m = filename.toLowerCase();
  if (/\.(csv|xlsx|xls|xlsm)$/i.test(m)) return "migration";
  if (/\.(pdf|docx?|txt|png|jpe?g|webp|tiff?|gif)$/i.test(m)) return "documents";
  if (/\.(ya?ml|json)$/i.test(m)) return "schema";
  return null;
}

/** Returns a new state with the given uploads registered, deduped by filename. */
export function registerUploads(
  state: WorkflowQueueState,
  files: Array<{ filename: string; size?: number; uploadedAt?: number }>,
): WorkflowQueueState {
  const seen = new Set(state.uploads.map((u) => u.id));
  const existingByName = new Map(state.uploads.map((u) => [u.filename.toLowerCase(), u]));
  const next: WorkflowQueueUpload[] = [...state.uploads];
  for (const f of files) {
    const fname = f.filename.trim();
    if (!fname) continue;
    if (existingByName.has(fname.toLowerCase())) continue;
    const kind = intendedKindForFilename(fname);
    if (!kind) continue;
    const id = nextId("upload", seen);
    seen.add(id);
    next.push({
      id,
      filename: fname,
      size: f.size,
      intendedKind: kind,
      uploadedAt: f.uploadedAt ?? next.length + 1,
    });
  }
  return { ...state, uploads: next };
}

/** Returns a new state with the workflow run upserted by (kind, backendId). */
export function upsertWorkflowRun(
  state: WorkflowQueueState,
  patch: Omit<WorkflowQueueRun, "id" | "startedAt" | "updatedAt"> & {
    id?: string;
    startedAt?: number;
    updatedAt?: number;
  },
): WorkflowQueueState {
  const seen = new Set(state.workflows.map((w) => w.id));
  const existingIdx = state.workflows.findIndex(
    (w) =>
      w.kind === patch.kind &&
      (patch.backendId
        ? w.backendId === patch.backendId
        : patch.id
          ? w.id === patch.id
          : false),
  );
  const now = patch.updatedAt ?? state.workflows.length + 1;
  if (existingIdx >= 0) {
    const merged: WorkflowQueueRun = {
      ...state.workflows[existingIdx],
      ...patch,
      id: state.workflows[existingIdx].id,
      startedAt: state.workflows[existingIdx].startedAt,
      updatedAt: now,
      uploadIds:
        patch.uploadIds && patch.uploadIds.length
          ? [...new Set([...state.workflows[existingIdx].uploadIds, ...patch.uploadIds])]
          : state.workflows[existingIdx].uploadIds,
    };
    const next = state.workflows.slice();
    next[existingIdx] = merged;
    return { ...state, workflows: next };
  }
  const id = patch.id ?? nextId(`run_${patch.kind}`, seen);
  const startedAt = patch.startedAt ?? now;
  const run: WorkflowQueueRun = {
    ...patch,
    id,
    startedAt,
    updatedAt: now,
    uploadIds: patch.uploadIds ?? [],
  };
  // When a run is created the consuming upload should mark consumedBy so
  // recommendations don't re-fire that workflow.
  const uploads = state.uploads.map((u) =>
    run.uploadIds.includes(u.id) ? { ...u, consumedBy: run.id } : u,
  );
  return {
    ...state,
    uploads,
    workflows: [...state.workflows, run],
  };
}

/** Returns a new state where the given workflow row has been updated by id. */
export function updateWorkflowStatus(
  state: WorkflowQueueState,
  workflowId: string,
  patch: Partial<Pick<WorkflowQueueRun, "status" | "detail" | "title" | "backendId">>,
): WorkflowQueueState {
  const idx = state.workflows.findIndex((w) => w.id === workflowId);
  if (idx < 0) return state;
  const next = state.workflows.slice();
  next[idx] = { ...next[idx], ...patch, updatedAt: state.workflows.length + 1 };
  return { ...state, workflows: next };
}

/** Returns a new state with the upload removed. */
export function removeUpload(state: WorkflowQueueState, uploadId: string): WorkflowQueueState {
  return { ...state, uploads: state.uploads.filter((u) => u.id !== uploadId) };
}

/** Returns derived buckets for UI rendering. */
export function deriveWorkflowQueueBuckets(state: WorkflowQueueState): {
  active: WorkflowQueueRun[];
  completed: WorkflowQueueRun[];
  recommended: WorkflowQueueUpload[];
} {
  const active = state.workflows.filter(
    (w) => w.status === "running" || w.status === "awaiting_input" || w.status === "queued",
  );
  const completed = state.workflows.filter(
    (w) => w.status === "complete" || w.status === "failed",
  );
  const recommended = state.uploads.filter((u) => !u.consumedBy);
  return { active, completed, recommended };
}

/** Convenience for label rendering. */
export const WORKFLOW_KIND_LABEL: Record<WorkflowKind, string> = {
  migration: "Migration ingest",
  documents: "Doc RAG",
  schema: "Schema mapping",
  work_order: "Work order",
};
