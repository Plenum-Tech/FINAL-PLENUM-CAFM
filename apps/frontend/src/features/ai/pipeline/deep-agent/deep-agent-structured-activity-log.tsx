"use client";

import { AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronRight, GitMerge, MessageSquare, ScrollText, ShieldAlert, Sparkles, Wrench } from "lucide-react";

import { cn } from "@/utils/cn";

import type {
  ActivityLogEvent,
  ActivityLogStatus,
  ActivityInlineAction,
  ActivityLogEventKind,
} from "./deep-agent-activity-events";

type Props = {
  events: ActivityLogEvent[];
  /** Called when the user clicks an inline action — the parent decides what to do. */
  onAction?: (event: ActivityLogEvent, action: ActivityInlineAction) => void;
  variant?: "rail" | "full";
};

function StatusBadge({ status }: { status: ActivityLogStatus }) {
  const map: Record<ActivityLogStatus, { label: string; cls: string }> = {
    running: { label: "Running", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
    awaiting_approval: { label: "Awaiting approval", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    complete: { label: "Complete", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    escalated: { label: "Escalated", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    informational: { label: "Trigger", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  };
  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-0.5 text-[10px] font-medium",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}

function KindIcon({ kind }: { kind: ActivityLogEventKind }) {
  switch (kind) {
    case "user_trigger":
      return <MessageSquare size={13} className="text-slate-500" />;
    case "agent_handoff":
      return <GitMerge size={13} className="text-violet-600" />;
    case "tool_call":
      return <Wrench size={13} className="text-indigo-600" />;
    case "approval_pending":
      return <ShieldAlert size={13} className="text-amber-700" />;
    case "approval_decided":
      return <CheckCircle2 size={13} className="text-emerald-600" />;
    case "escalation":
      return <AlertTriangle size={13} className="text-rose-600" />;
    case "workflow_complete":
      return <CheckCircle2 size={13} className="text-emerald-600" />;
    default:
      return <Bot size={13} className="text-slate-500" />;
  }
}

function ConfidenceBar({ value, label }: { value?: number; label?: string }) {
  if (typeof value !== "number") {
    if (label) {
      return (
        <span className="text-[10px] text-slate-500">
          Confidence <span className="font-medium uppercase">{label}</span>
        </span>
      );
    }
    return null;
  }
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85
      ? "bg-emerald-500"
      : value >= 0.6
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 rounded-full bg-slate-200 overflow-hidden">
        <div className={cn("h-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-medium text-slate-600 tabular-nums">{pct}%</span>
      {label ? <span className="text-[10px] text-slate-400 uppercase">{label}</span> : null}
    </div>
  );
}

function ActionRow({
  event,
  actions,
  onAction,
}: {
  event: ActivityLogEvent;
  actions: ActivityInlineAction[];
  onAction?: (event: ActivityLogEvent, action: ActivityInlineAction) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {actions.map((action) => {
        const isPrimary = action.kind === "approve" || action.kind === "open";
        const isDanger = action.kind === "escalate";
        return (
          <button
            key={`${event.id}:${action.kind}:${action.label}`}
            type="button"
            onClick={() => onAction?.(event, action)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
              isPrimary
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : isDanger
                  ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            {action.label}
            {isPrimary ? <ArrowRight size={11} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function EventRow({
  event,
  onAction,
}: {
  event: ActivityLogEvent;
  onAction?: (event: ActivityLogEvent, action: ActivityInlineAction) => void;
}) {
  const dateLabel = event.at ? new Date(event.at).toLocaleTimeString("en-GB", { hour12: false }) : "";
  return (
    <div className="rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          <KindIcon kind={event.kind} />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-slate-400 tabular-nums">{dateLabel}</span>
            <StatusBadge status={event.status} />
          </div>
          {event.trigger ? (
            <div className="text-[11px]">
              <span className="text-slate-400">Trigger: </span>
              <span className="font-medium text-slate-800 break-words">{event.trigger}</span>
            </div>
          ) : null}
          {event.outcome ? (
            <div className="text-[11px]">
              <span className="text-slate-400">Outcome: </span>
              <span className="text-slate-700 break-words">{event.outcome}</span>
            </div>
          ) : null}
          {event.agents && event.agents.length > 0 ? (
            <div className="text-[10px] text-slate-500 flex items-center gap-0.5 flex-wrap">
              <span className="text-slate-400 mr-1">Actions:</span>
              {event.agents.map((agent, idx) => (
                <span key={`${event.id}-agent-${idx}`} className="inline-flex items-center gap-0.5">
                  <span className="rounded bg-violet-50 text-violet-700 px-1.5 py-0.5 font-medium">
                    {agent}
                  </span>
                  {idx < event.agents!.length - 1 ? <ChevronRight size={9} className="text-slate-300" /> : null}
                </span>
              ))}
            </div>
          ) : null}
          {(typeof event.confidence === "number" || event.confidenceLabel) ? (
            <ConfidenceBar value={event.confidence} label={event.confidenceLabel} />
          ) : null}
          {event.detail && event.detail !== event.outcome ? (
            <p className="text-[10px] text-slate-500">{event.detail}</p>
          ) : null}
          {event.actions && event.actions.length > 0 ? (
            <div className="pt-0.5">
              <ActionRow event={event} actions={event.actions} onAction={onAction} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DeepAgentStructuredActivityLog({ events, onAction, variant = "full" }: Props) {
  const sorted = [...events].sort((a, b) => b.at - a.at);
  return (
    <div className={cn("flex h-full min-h-0 flex-col rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden", variant === "rail" ? "" : "")}>
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-100">
        <div className="flex items-center gap-1.5">
          <ScrollText size={14} className="text-violet-600" />
          <span className="text-sm font-semibold text-slate-800">Activity Log</span>
          <Sparkles size={11} className="text-amber-500" />
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Trigger · Outcome · Status · Agents · Confidence · Pending approvals · Escalations.
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {sorted.length === 0 ? (
          <p className="text-[11px] text-muted-foreground px-1 py-2">
            No structured events yet. Send a message, upload a file, or run a pinned action.
          </p>
        ) : (
          sorted.map((event) => (
            <EventRow key={event.id} event={event} onAction={onAction} />
          ))
        )}
      </div>
    </div>
  );
}

/** Compact in-chat card surfaced when the most-recent unresolved event needs the user. */
export function DeepAgentInlineActivityCard({
  event,
  onAction,
}: {
  event: ActivityLogEvent;
  onAction?: (event: ActivityLogEvent, action: ActivityInlineAction) => void;
}) {
  const accent =
    event.status === "escalated"
      ? "border-rose-200 bg-rose-50/40"
      : event.status === "awaiting_approval"
        ? "border-amber-200 bg-amber-50/40"
        : "border-slate-200 bg-white";
  return (
    <div className={cn("rounded-2xl ring-1 shadow-sm overflow-hidden", accent)}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className="shrink-0 mt-0.5">
          <KindIcon kind={event.kind} />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Activity
            </span>
            <StatusBadge status={event.status} />
          </div>
          {event.trigger ? (
            <div className="text-[12px]">
              <span className="text-slate-400">Trigger: </span>
              <span className="font-medium text-slate-800">{event.trigger}</span>
            </div>
          ) : null}
          {event.outcome ? (
            <div className="text-[12px]">
              <span className="text-slate-400">Outcome: </span>
              <span className="text-slate-700">{event.outcome}</span>
            </div>
          ) : null}
          {(typeof event.confidence === "number" || event.confidenceLabel) ? (
            <ConfidenceBar value={event.confidence} label={event.confidenceLabel} />
          ) : null}
          {event.actions && event.actions.length > 0 ? (
            <div className="pt-0.5">
              <ActionRow event={event} actions={event.actions} onAction={onAction} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
