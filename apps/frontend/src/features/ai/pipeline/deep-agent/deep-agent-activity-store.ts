/**
 * Per-session Activity Log persistence (push-back #2 — persisted + reconstructable).
 *
 * Live events from the orchestrator hook are derived from in-memory state
 * and vanish on refresh. The spec requires that historical conversations
 * reconstruct their activity log: when a user opens a chat from Saved
 * Spaces they should see the same Trigger / Outcome / Status / Agent
 * handoffs / Approvals / Escalations as the moment they happened.
 *
 * Storage key: ``plenum_activity_log_v1:${sessionId}`` (cap 200 events / session)
 *
 * Append-only semantics with id-based dedupe so emitting the same event
 * twice (e.g. a poll-driven re-derivation) is a no-op.
 */
import type { ActivityLogEvent } from "./deep-agent-activity-events";

const KEY_PREFIX = "plenum_activity_log_v1";
const MAX_EVENTS_PER_SESSION = 200;

function key(sessionId: string): string {
  return `${KEY_PREFIX}:${sessionId}`;
}

export function loadActivityEvents(sessionId: string): ActivityLogEvent[] {
  if (typeof window === "undefined" || !sessionId) return [];
  try {
    const raw = window.localStorage.getItem(key(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActivityLogEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistActivityEvents(sessionId: string, events: ActivityLogEvent[]): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const sorted = [...events].sort((a, b) => a.at - b.at);
    const tail = sorted.slice(-MAX_EVENTS_PER_SESSION);
    window.localStorage.setItem(key(sessionId), JSON.stringify(tail));
  } catch {
    /* quota / SSR */
  }
}

/**
 * Merge live + persisted events. Live events with the same id replace their
 * persisted counterpart (so a "running" tool_call upgrades to "complete"
 * when the next derivation runs). Events keep their earliest ``at`` so the
 * activity feed stays chronological even when a later derivation re-emits.
 */
export function mergeActivityEvents(
  persisted: ActivityLogEvent[],
  live: ActivityLogEvent[],
): ActivityLogEvent[] {
  const byId = new Map<string, ActivityLogEvent>();
  for (const e of persisted) byId.set(e.id, e);
  for (const e of live) {
    const prior = byId.get(e.id);
    if (prior) {
      byId.set(e.id, { ...prior, ...e, at: Math.min(prior.at, e.at) });
    } else {
      byId.set(e.id, e);
    }
  }
  return [...byId.values()].sort((a, b) => a.at - b.at);
}
