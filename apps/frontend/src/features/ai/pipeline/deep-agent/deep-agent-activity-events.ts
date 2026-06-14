/**
 * Structured Activity Log events (push-back #2 + #5).
 *
 * The flat ``DeepAgentActivityLog`` shows a chronological tool/message stream.
 * This module aggregates the same orchestrator state into spec-shaped
 * ``ActivityLogEvent`` entries — Trigger / Outcome / Status / Agent handoffs /
 * Tool execution / Confidence / Pending approvals / Escalations / Inline
 * actions — matching the requirements doc.
 *
 * Pure data layer. No React. Consumers render the events in whichever surface
 * they need (chat-inline card, dedicated tab, right-rail panel).
 */
import type { ToolCallRecord } from "@/features/ai/deep-agents-api";

import type { ApprovalSuggestionInsight, ApprovalToolError } from "./approval-suggestion-parse";
import type { CompletedDocumentsSnapshot } from "./deep-agent-documents-completion-card";
import type { CompletedMigrationSnapshot } from "./deep-agent-migration-completion-card";
import type { DeepAgentProcessLogEntry } from "./deep-agent-process-log";
import type { CompletedSchemaSnapshot } from "./deep-agent-schema-completion-card";
import type { DeepAgentTurn } from "./use-deep-agent-orchestrator";
import type { CompletedWorkOrderSnapshot } from "./deep-agent-work-order-completion-card";

export type ActivityLogEventKind =
  | "user_trigger"
  | "agent_handoff"
  | "tool_call"
  | "approval_pending"
  | "approval_decided"
  | "escalation"
  | "workflow_complete";

export type ActivityLogStatus =
  | "running"
  | "awaiting_approval"
  | "complete"
  | "escalated"
  | "informational";

export type ActivityInlineAction = {
  kind: "approve" | "modify" | "escalate" | "open" | "dismiss";
  label: string;
  /** Marker the UI uses to wire its onClick — events are pure data. */
  intent?: string;
};

export type ActivityLogEvent = {
  id: string;
  at: number;
  kind: ActivityLogEventKind;
  /** What initiated the event (user prompt, scheduled scan, tool output). */
  trigger?: string;
  /** What happened or is happening as a result. */
  outcome?: string;
  status: ActivityLogStatus;
  /** Ordered chain of agents that have touched this event. */
  agents?: string[];
  /** Tool name if this event was driven by a tool call. */
  toolName?: string;
  /** Confidence score 0–1 if available (approvals, mappings, classifier). */
  confidence?: number;
  /** Optional sub-label for the confidence (e.g. "high" / "medium" / "low"). */
  confidenceLabel?: string;
  /** Inline actions the UI should render as buttons. */
  actions?: ActivityInlineAction[];
  /** Free-text detail / one-liner shown under the title. */
  detail?: string;
  /** Session this event belongs to (for cross-session feeds). */
  sessionId?: string;
};

export type ActivitySource = {
  sessionId: string;
  turns: DeepAgentTurn[];
  processLog: DeepAgentProcessLogEntry[];
  toolCalls: ToolCallRecord[];
  activeDomain?: string;
  lastRouteIntent?: string;
  interruptPayload?: Record<string, unknown> | null;
  approvalInsight?: ApprovalSuggestionInsight | null;
  approvalToolError?: ApprovalToolError | null;
  completedMigrations?: CompletedMigrationSnapshot[];
  completedDocBatches?: CompletedDocumentsSnapshot[];
  completedSchema?: CompletedSchemaSnapshot[];
  completedWorkOrders?: CompletedWorkOrderSnapshot[];
};

function parseTime(at?: string | number | null): number {
  if (typeof at === "number") return at;
  if (typeof at === "string") {
    const n = new Date(at).getTime();
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function confidenceFromInsight(insight: ApprovalSuggestionInsight): number | undefined {
  if (typeof insight.matchScore === "number") return Math.max(0, Math.min(1, insight.matchScore));
  if (typeof insight.confidence === "string") {
    const m = insight.confidence.toLowerCase();
    if (m === "high") return 0.95;
    if (m === "medium") return 0.7;
    if (m === "low") return 0.45;
  }
  return undefined;
}

/**
 * Build the structured event stream. The output is sorted oldest → newest so
 * the UI can render in chronological order; consumers pick the most recent
 * unresolved event for the chat-inline card.
 */
export function buildActivityLogEvents(source: ActivitySource): ActivityLogEvent[] {
  const events: ActivityLogEvent[] = [];
  const sessionId = source.sessionId;
  const agentsSeen: string[] = [];

  // ── User-triggered events ────────────────────────────────────────────────
  for (const turn of source.turns) {
    if (turn.role !== "user" || !turn.text?.trim()) continue;
    if (turn.id === "greeting") continue;
    events.push({
      id: `trigger:${turn.id}`,
      at: parseTime(turn.at),
      kind: "user_trigger",
      trigger: turn.text.trim().slice(0, 240),
      status: "informational",
      sessionId,
    });
  }

  // ── Tool execution + agent handoffs ──────────────────────────────────────
  for (const entry of source.processLog) {
    if (entry.phase === "started") continue;
    const matched = source.toolCalls.find((tc) => tc.tool === entry.tool);
    const out = (matched?.output ?? null) as Record<string, unknown> | null;
    const confidence =
      typeof out?.confidence === "number"
        ? Math.max(0, Math.min(1, out.confidence as number))
        : typeof out?.match_score === "number"
          ? Math.max(0, Math.min(1, out.match_score as number))
          : undefined;
    const agentLabel = entry.detail || entry.tool;
    if (agentLabel && !agentsSeen.includes(agentLabel)) {
      agentsSeen.push(agentLabel);
    }
    if (entry.status === "error") {
      events.push({
        id: `escalation:${entry.id}`,
        at: parseTime(entry.at),
        kind: "escalation",
        trigger: entry.tool,
        outcome: entry.detail || "Tool failed",
        status: "escalated",
        agents: [...agentsSeen],
        toolName: entry.tool,
        detail: entry.detail,
        actions: [
          { kind: "modify", label: "Inspect", intent: `process_log:${entry.id}` },
          { kind: "escalate", label: "Escalate", intent: `escalate:${entry.id}` },
        ],
        sessionId,
      });
      continue;
    }
    events.push({
      id: `tool:${entry.id}`,
      at: parseTime(entry.at),
      kind: "tool_call",
      trigger: entry.tool,
      outcome: entry.detail,
      status: "complete",
      agents: [...agentsSeen],
      toolName: entry.tool,
      confidence,
      sessionId,
    });
  }

  // ── HITL gate (interrupt payload) → approval_pending ─────────────────────
  if (source.interruptPayload) {
    const gateType =
      typeof source.interruptPayload.gate === "string"
        ? source.interruptPayload.gate
        : typeof source.interruptPayload.kind === "string"
          ? source.interruptPayload.kind
          : "review";
    events.push({
      id: `gate:${gateType}`,
      at: Date.now(),
      kind: "approval_pending",
      trigger: source.lastRouteIntent ?? source.activeDomain ?? "Workflow gate",
      outcome: `Awaiting decision: ${String(gateType).replace(/_/g, " ")}`,
      status: "awaiting_approval",
      agents: agentsSeen.length ? [...agentsSeen] : undefined,
      actions: [
        { kind: "approve", label: "Approve", intent: `gate_approve:${gateType}` },
        { kind: "modify", label: "Modify", intent: `gate_modify:${gateType}` },
        { kind: "escalate", label: "Escalate", intent: `gate_escalate:${gateType}` },
      ],
      sessionId,
    });
  }

  // ── Approval suggestion (workflow proposal) ──────────────────────────────
  if (source.approvalInsight) {
    const insight = source.approvalInsight;
    events.push({
      id: `approval:${insight.id}`,
      at: parseTime(insight.at),
      kind: "approval_pending",
      trigger: insight.sourceTool ?? "Suggestion",
      outcome: insight.recommendedSummary ?? insight.message ?? "Pending approval",
      status: "awaiting_approval",
      agents: agentsSeen.length ? [...agentsSeen] : undefined,
      toolName: insight.sourceTool,
      confidence: confidenceFromInsight(insight),
      confidenceLabel: insight.confidenceLabel ?? insight.confidence,
      actions: [
        { kind: "approve", label: "Approve", intent: `approval_approve:${insight.id}` },
        { kind: "modify", label: "Modify", intent: `approval_modify:${insight.id}` },
        { kind: "escalate", label: "Escalate", intent: `approval_escalate:${insight.id}` },
      ],
      detail: insight.message,
      sessionId,
    });
  }

  // ── Approval-tool error → escalation ─────────────────────────────────────
  if (source.approvalToolError) {
    const err = source.approvalToolError;
    events.push({
      id: `approval_err:${err.id}`,
      at: parseTime(err.at),
      kind: "escalation",
      trigger: err.sourceTool,
      outcome: err.message,
      status: "escalated",
      toolName: err.sourceTool,
      actions: [
        { kind: "modify", label: "Inspect", intent: `approval_err_view:${err.id}` },
        { kind: "dismiss", label: "Dismiss", intent: `approval_err_dismiss:${err.id}` },
      ],
      sessionId,
    });
  }

  // ── Completion snapshots → workflow_complete ─────────────────────────────
  for (const snap of source.completedMigrations ?? []) {
    events.push({
      id: `complete_migration:${snap.migration_id}`,
      at: snap.capturedAt,
      kind: "workflow_complete",
      trigger: snap.fileNames?.[0] ?? snap.cmms_name ?? "Migration",
      outcome:
        typeof snap.t1_mapped_count === "number"
          ? `Mapped ${snap.t1_mapped_count} T1 fields · ${snap.unmapped_count ?? 0} unmapped`
          : `Status ${snap.status}`,
      status: snap.status === "failed" || snap.status === "ddl_failed" ? "escalated" : "complete",
      detail: snap.error_message ?? undefined,
      actions: [{ kind: "open", label: "Review", intent: `open_migration:${snap.migration_id}` }],
      sessionId,
    });
  }
  for (const snap of source.completedDocBatches ?? []) {
    events.push({
      id: `complete_docs:${snap.documentIds.join(",")}`,
      at: snap.capturedAt,
      kind: "workflow_complete",
      trigger: snap.fileNames?.[0] ?? `${snap.totalDocs} documents`,
      outcome:
        snap.errorCount > 0
          ? `${snap.indexedCount} indexed · ${snap.errorCount} errors`
          : `${snap.indexedCount} indexed`,
      status: snap.errorCount > 0 ? "escalated" : "complete",
      sessionId,
    });
  }
  for (const snap of source.completedSchema ?? []) {
    events.push({
      id: `complete_schema:${snap.schemaMappingId}`,
      at: snap.capturedAt,
      kind: "workflow_complete",
      trigger: snap.label ?? snap.external_cmms_name ?? "Schema mapping",
      outcome: snap.status ?? "Complete",
      status:
        snap.status === "failed" || snap.status === "error" || snap.errorMessage
          ? "escalated"
          : "complete",
      confidence: typeof snap.coveragePct === "number" ? snap.coveragePct / 100 : undefined,
      detail: snap.errorMessage ?? undefined,
      sessionId,
    });
  }
  for (const snap of source.completedWorkOrders ?? []) {
    events.push({
      id: `complete_wo:${snap.workOrderId}`,
      at: snap.capturedAt,
      kind: "workflow_complete",
      trigger: snap.title ?? snap.workOrderId,
      outcome: [snap.priority, snap.status].filter(Boolean).join(" · ") || "Created",
      status: snap.isError ? "escalated" : "complete",
      detail: snap.errorMessage ?? undefined,
      sessionId,
    });
  }

  events.sort((a, b) => a.at - b.at);
  return events;
}

/** Most recent unresolved event — drives the chat-inline activity card. */
export function pickInlineActivityEvent(events: ActivityLogEvent[]): ActivityLogEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.status === "awaiting_approval" || ev.status === "escalated") return ev;
  }
  return null;
}
