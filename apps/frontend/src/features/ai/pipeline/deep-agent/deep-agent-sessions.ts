import {
  migrateLegacySessionMeta,
  type SavedSpaceId,
  type SpaceTag,
} from "./deep-agent-spaces";
import type { DeepAgentTurn } from "./use-deep-agent-orchestrator";

export const DEEP_AGENT_SESSIONS_LIST_KEY = "plenum_deep_agent_sessions_v2";

export type DeepAgentSessionMeta = {
  id: string;
  title: string;
  updatedAt: number;
  /** Effective LHS bucket (override ?? primary). Kept for storage compat. */
  space?: SavedSpaceId;
  /** Dominant space from accumulated signals (latest turn wins ties). */
  primarySpace?: SavedSpaceId;
  /** Other spaces touched in this session (shown in their lists with badge). */
  secondarySpaces?: SavedSpaceId[];
  classificationConfidence?: number;
  spaceWeights?: Partial<Record<SavedSpaceId, number>>;
  /** Future sub-space tags (pm_schedule, uncategorized, …). */
  spaceTags?: SpaceTag[];
  /** FM manual bucket; survives auto re-tagging. */
  userOverrideSpace?: SavedSpaceId;
  /** WP-3: assignment to a customer-named space (parallel to built-in spaces). */
  customSpaceId?: string;
  /** Short preview: `{Type} · {id}` max 36 chars from last artifact tool output. */
  artifactHint?: string;
  /** Full document IDs indexed in this session (Doc RAG / row match). */
  documentIds?: string[];
  /** Migration IDs started in this session (Excel/CSV → DB). Persisted so the
   *  migration flow survives session reloads, like documentIds. */
  migrationIds?: string[];
  /**
   * Business-entity IDs touched in this session (Feature 2.5).
   * Populated from completion snapshots / tool outputs as available.
   */
  workOrderIds?: string[];
  assetIds?: string[];
  vendorIds?: string[];
  locationIds?: string[];
  /** Per-space artifact tally from tool outputs (not session count). */
  artifactCounts?: Partial<Record<SavedSpaceId, number>>;
  lastDomain?: string;
  lastRouteIntent?: string;
  migratedFromV1?: boolean;
};

export function sessionTitleFromTurns(turns: DeepAgentTurn[]): string {
  const firstUser = turns.find((t) => t.role === "user");
  if (!firstUser?.text?.trim()) return "New chat";
  const t = firstUser.text.trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

const LEGACY_SESSIONS_KEY = "plenum_deep_agent_sessions_v1";

export function loadDeepAgentSessions(): DeepAgentSessionMeta[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = window.localStorage.getItem(DEEP_AGENT_SESSIONS_LIST_KEY);
    const fromLegacy = !raw;
    if (!raw) raw = window.localStorage.getItem(LEGACY_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DeepAgentSessionMeta[];
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map((s) => migrateLegacySessionMeta(s));
    if (fromLegacy && migrated.length) {
      persistDeepAgentSessions(migrated);
    }
    return migrated;
  } catch {
    return [];
  }
}

export function persistDeepAgentSessions(sessions: DeepAgentSessionMeta[]) {
  if (typeof window === "undefined") return;
  try {
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    window.localStorage.setItem(DEEP_AGENT_SESSIONS_LIST_KEY, JSON.stringify(sorted.slice(0, 40)));
  } catch {
    /* ignore */
  }
}

export function upsertDeepAgentSession(
  sessions: DeepAgentSessionMeta[],
  meta: DeepAgentSessionMeta,
): DeepAgentSessionMeta[] {
  const next = sessions.filter((s) => s.id !== meta.id);
  next.push(meta);
  return next;
}

export function ensureSessionInList(
  sessions: DeepAgentSessionMeta[],
  sessionId: string,
  defaultSpace: SavedSpaceId = "general",
): DeepAgentSessionMeta[] {
  if (sessions.some((s) => s.id === sessionId)) return sessions;
  return [
    ...sessions,
    {
      id: sessionId,
      title: "New chat",
      updatedAt: Date.now(),
      primarySpace: defaultSpace,
      space: defaultSpace,
      secondarySpaces: [],
      classificationConfidence: 0,
    },
  ];
}
