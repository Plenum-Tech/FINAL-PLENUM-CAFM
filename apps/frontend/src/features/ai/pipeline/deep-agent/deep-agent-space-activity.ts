/**
 * Per-space activity feed (Feature 2.3).
 *
 * Reads completion-snapshot localStorage keys already written by the
 * orchestrator-shell (per session) and aggregates them across the sessions
 * that belong to a given space. No new persistence layer.
 *
 * Keys consumed:
 *   plenum-orch-completed-migrations:{sessionId}    CompletedMigrationSnapshot[]
 *   plenum-orch-completed-documents:{sessionId}     CompletedDocumentsSnapshot[]
 *   plenum-orch-completed-schema:{sessionId}        CompletedSchemaSnapshot[]
 *   plenum-orch-completed-work-orders:{sessionId}   CompletedWorkOrderSnapshot[]
 */
import type { DeepAgentSessionMeta } from "./deep-agent-sessions";
import { effectiveSpace, type SavedSpaceId } from "./deep-agent-spaces";

export type SpaceActivityKind =
  | "session_started"
  | "migration_completed"
  | "documents_completed"
  | "schema_completed"
  | "work_order_completed";

export type SpaceActivityEvent = {
  id: string;
  kind: SpaceActivityKind;
  at: number;
  title: string;
  detail?: string;
  sessionId?: string;
};

type CapturedAt = { capturedAt: number };

function safeReadArray<T extends CapturedAt>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is T => !!s && typeof s === "object" && typeof (s as { capturedAt?: unknown }).capturedAt === "number",
    );
  } catch {
    return [];
  }
}

function sessionsForSpace(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
): DeepAgentSessionMeta[] {
  return sessions.filter((s) => {
    if (effectiveSpace(s) === spaceId) return true;
    const secondary = s.secondarySpaces ?? [];
    return secondary.includes(spaceId);
  });
}

export function loadSpaceActivityEvents(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
  limit = 12,
): SpaceActivityEvent[] {
  const eligible = sessionsForSpace(sessions, spaceId);
  const events: SpaceActivityEvent[] = [];

  for (const session of eligible) {
    // Chat sessions are surfaced in the "Historical chats" section of the
    // space — emitting them here too produces a duplicate "Recent activity"
    // row for the same chat, which is what the screenshot showed.
    // We keep only the *workflow* events on the timeline so each container
    // has distinct content.

    const migrations = safeReadArray<{
      capturedAt: number;
      migration_id: string;
      cmms_name?: string;
      status?: string;
      fileNames?: string[];
    }>(`plenum-orch-completed-migrations:${session.id}`);
    for (const snap of migrations) {
      events.push({
        id: `migration:${snap.migration_id}`,
        kind: "migration_completed",
        at: snap.capturedAt,
        title: snap.fileNames?.[0] ?? snap.cmms_name ?? "Migration",
        detail: snap.status,
        sessionId: session.id,
      });
    }

    const docBatches = safeReadArray<{
      capturedAt: number;
      documentIds: string[];
      fileNames?: string[];
      indexedCount: number;
      errorCount: number;
    }>(`plenum-orch-completed-documents:${session.id}`);
    for (const snap of docBatches) {
      events.push({
        id: `docs:${snap.documentIds.join(",")}`,
        kind: "documents_completed",
        at: snap.capturedAt,
        title:
          snap.fileNames?.[0] ??
          `${snap.documentIds.length} document${snap.documentIds.length === 1 ? "" : "s"}`,
        detail:
          snap.errorCount > 0
            ? `${snap.indexedCount} indexed · ${snap.errorCount} errors`
            : `${snap.indexedCount} indexed`,
        sessionId: session.id,
      });
    }

    const schemas = safeReadArray<{
      capturedAt: number;
      schemaMappingId: string;
      label?: string;
      status?: string;
      external_cmms_name?: string;
    }>(`plenum-orch-completed-schema:${session.id}`);
    for (const snap of schemas) {
      events.push({
        id: `schema:${snap.schemaMappingId}`,
        kind: "schema_completed",
        at: snap.capturedAt,
        title: snap.label ?? snap.external_cmms_name ?? "Schema mapping",
        detail: snap.status,
        sessionId: session.id,
      });
    }

    const workOrders = safeReadArray<{
      capturedAt: number;
      workOrderId: string;
      title?: string | null;
      priority?: string | null;
      status?: string | null;
      isError?: boolean;
    }>(`plenum-orch-completed-work-orders:${session.id}`);
    for (const snap of workOrders) {
      if (snap.isError) continue;
      events.push({
        id: `wo:${snap.workOrderId}`,
        kind: "work_order_completed",
        at: snap.capturedAt,
        title: snap.title ?? snap.workOrderId,
        detail: [snap.priority, snap.status].filter(Boolean).join(" · "),
        sessionId: session.id,
      });
    }
  }

  events.sort((a, b) => b.at - a.at);
  return events.slice(0, limit);
}
