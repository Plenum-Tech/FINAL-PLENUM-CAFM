"use client";

import { useMemo, useState } from "react";
import { Bot, CheckCircle2, Loader2, ScrollText, User, Wrench, XCircle } from "lucide-react";

import { ChatMarkdown } from "@/components/chat-markdown";
import {
  DOMAIN_LABELS,
  type ToolCallRecord,
  type ToolInfo,
} from "@/features/ai/deep-agents-api";
import { cn } from "@/utils/cn";

import { DeepAgentApprovalErrorPanel } from "./deep-agent-approval-error";
import { DeepAgentApprovalPanel } from "./deep-agent-approval-panel";
import { DeepAgentHitlGate } from "./deep-agent-hitl-gate";
import type { DeepAgentProcessLogEntry } from "./deep-agent-process-log";
import type { ApprovalSuggestionInsight, ApprovalToolError } from "./approval-suggestion-parse";
import type { DeepAgentTurn } from "./use-deep-agent-orchestrator";

type Filter = "all" | "messages" | "tools" | "gates";

type ActivityItem =
  | { kind: "message"; at: string; id: string; turn: DeepAgentTurn }
  | { kind: "tool"; at: string; id: string; entry: DeepAgentProcessLogEntry }
  | { kind: "live"; at: string; id: string; label: string; domain: string };

function sortKey(at: string, tie: number) {
  return `${at}#${String(tie).padStart(6, "0")}`;
}

function summarizeJson(value: unknown, max = 320): string {
  if (value == null) return "—";
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(value);
  }
}

export function DeepAgentActivityLog(props: {
  turns: DeepAgentTurn[];
  processLog: DeepAgentProcessLogEntry[];
  toolCalls: ToolCallRecord[];
  toolsCatalog?: ToolInfo[];
  liveEvents?: Array<{ id: string; label: string; domain: string; status: "running" | "done" }>;
  interruptPayload: Record<string, unknown> | null;
  approvalInsight: ApprovalSuggestionInsight | null;
  approvalToolError: ApprovalToolError | null;
  busy?: boolean;
  resuming?: boolean;
  onSubmitHitl: (decision: Record<string, unknown>) => void | Promise<void>;
  onApprovalApprove?: (insight: ApprovalSuggestionInsight) => void;
  onApprovalReject?: (insight: ApprovalSuggestionInsight) => void;
  variant?: "light" | "dark";
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const dark = props.variant === "dark";

  const toolsByName = useMemo(() => {
    const m = new Map<string, ToolInfo>();
    for (const t of props.toolsCatalog ?? []) m.set(t.name, t);
    return m;
  }, [props.toolsCatalog]);

  const timeline = useMemo(() => {
    const items: ActivityItem[] = [];

    for (const turn of props.turns) {
      if (turn.id === "greeting") continue;
      items.push({
        kind: "message",
        at: turn.at ?? new Date(0).toISOString(),
        id: `msg-${turn.id}`,
        turn,
      });
    }

    for (const entry of props.processLog) {
      if (entry.phase === "started") continue;
      items.push({
        kind: "tool",
        at: entry.at,
        id: entry.id,
        entry,
      });
    }

    for (const live of props.liveEvents ?? []) {
      if (live.status !== "running") continue;
      items.push({
        kind: "live",
        at: new Date().toISOString(),
        id: live.id,
        label: live.label,
        domain: live.domain,
      });
    }

    items.sort((a, b) => sortKey(a.at, 0).localeCompare(sortKey(b.at, 0)));
    return items;
  }, [props.turns, props.processLog, props.liveEvents]);

  const filtered = timeline.filter((item) => {
    if (filter === "all") return true;
    if (filter === "messages") return item.kind === "message";
    if (filter === "tools") return item.kind === "tool" || item.kind === "live";
    return false;
  });

  const showGateBlock =
    filter === "all" || filter === "gates" ? !!props.interruptPayload : false;
  const showApprovalBlock =
    (filter === "all" || filter === "gates") &&
    (props.approvalInsight || props.approvalToolError);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "messages", label: "Messages" },
    { id: "tools", label: "Tools" },
    { id: "gates", label: "Gates" },
  ];

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col rounded-2xl border",
        dark ? "border-slate-700/60 bg-slate-900/70" : "border-slate-200 bg-white shadow-sm",
      )}
    >
      <div className={cn("shrink-0 border-b px-4 py-3", dark ? "border-slate-700/60" : "border-slate-200")}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ScrollText size={16} className={dark ? "text-violet-400" : "text-violet-600"} />
          Activity log
        </div>
        <p className={cn("mt-1 text-[11px]", dark ? "text-slate-400" : "text-muted-foreground")}>
          Chat, tool calls, human gates, and approval actions in one timeline.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                filter === f.id
                  ? "bg-indigo-600 text-white"
                  : dark
                    ? "text-slate-400 hover:text-slate-200"
                    : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {(props.busy || props.resuming) && filter !== "gates" ? (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 flex items-center gap-2 text-xs",
              dark
                ? "border-violet-500/30 bg-violet-950/40 text-violet-200"
                : "border-violet-100 bg-violet-50/50 text-violet-800",
            )}
          >
            <Loader2 size={14} className="animate-spin shrink-0" />
            {props.resuming ? "Resuming workflow…" : "Orchestrator running…"}
          </div>
        ) : null}

        {showGateBlock ? (
          <div className="rounded-xl border border-amber-200 overflow-hidden">
            <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-[11px] font-medium text-amber-900">
              Awaiting human review
            </div>
            <DeepAgentHitlGate
              payload={props.interruptPayload!}
              busy={props.busy}
              onApproveMapping={(d) => void props.onSubmitHitl(d)}
              onConfirmRollback={(d) => void props.onSubmitHitl(d)}
              onGenericDecision={(d) => void props.onSubmitHitl(d)}
            />
          </div>
        ) : null}

        {showApprovalBlock ? (
          <div className="space-y-2">
            {props.approvalToolError ? (
              <DeepAgentApprovalErrorPanel error={props.approvalToolError} />
            ) : null}
            {props.approvalInsight && !props.approvalToolError ? (
              <DeepAgentApprovalPanel
                insight={props.approvalInsight}
                onApprove={
                  props.onApprovalApprove
                    ? () => props.onApprovalApprove!(props.approvalInsight!)
                    : undefined
                }
                onReject={
                  props.onApprovalReject
                    ? () => props.onApprovalReject!(props.approvalInsight!)
                    : undefined
                }
              />
            ) : null}
          </div>
        ) : null}

        {filter !== "gates" && filtered.length === 0 && !props.busy ? (
          <p className={cn("text-xs px-1", dark ? "text-slate-500" : "text-muted-foreground")}>
            No activity yet — send a message to start the orchestrator.
          </p>
        ) : null}

        {filter !== "gates"
          ? filtered.map((item) => {
              if (item.kind === "message") {
                const isUser = item.turn.role === "user";
                const isError = item.turn.role === "error";
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      isError
                        ? "border-red-200 bg-red-50 text-red-800"
                        : isUser
                          ? "border-indigo-200 bg-indigo-50/60"
                          : dark
                            ? "border-slate-700 bg-slate-800/50 text-slate-200"
                            : "border-slate-200 bg-slate-50/80",
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                      {isUser ? <User size={11} /> : isError ? <XCircle size={11} /> : <Bot size={11} />}
                      {isUser ? "You" : isError ? "Error" : "Assistant"}
                    </div>
                    {isUser || isError ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{item.turn.text}</p>
                    ) : (
                      <div className="leading-relaxed prose prose-sm max-w-none dark:prose-invert">
                        <ChatMarkdown text={item.turn.text} />
                      </div>
                    )}
                  </div>
                );
              }

              if (item.kind === "live") {
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 flex items-center gap-2 text-xs",
                      dark ? "border-slate-600 bg-slate-800/40" : "border-slate-200 bg-white",
                    )}
                  >
                    <Loader2 size={14} className="animate-spin text-indigo-600 shrink-0" />
                    <span className="font-mono truncate">{item.label}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {DOMAIN_LABELS[item.domain] ?? item.domain}
                    </span>
                  </div>
                );
              }

              const e = item.entry;
              const domain = toolsByName.get(e.tool)?.domain ?? "unknown";
              const open = expanded.has(item.id);
              const matchedTool = props.toolCalls.find((tc) => tc.tool === e.tool);

              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border overflow-hidden text-xs",
                    dark ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-white",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/60"
                  >
                    {e.status === "running" ? (
                      <Loader2 size={14} className="animate-spin text-indigo-600 shrink-0 mt-0.5" />
                    ) : e.status === "success" ? (
                      <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Wrench size={11} className="text-muted-foreground shrink-0" />
                        <span className="font-mono font-medium truncate">{e.toolLabel || e.tool}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {DOMAIN_LABELS[domain] ?? domain}
                        </span>
                        {e.durationMs != null ? (
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {e.durationMs}ms
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{e.detail || e.title}</p>
                    </div>
                  </button>
                  {open ? (
                    <div className={cn("border-t px-3 py-2 space-y-2", dark ? "border-slate-700" : "border-slate-100")}>
                      {e.input ? (
                        <div>
                          <p className="text-[9px] font-semibold uppercase text-muted-foreground">Input</p>
                          <pre className="mt-0.5 text-[10px] whitespace-pre-wrap break-words max-h-28 overflow-y-auto rounded bg-slate-50 dark:bg-slate-950 p-2">
                            {summarizeJson(e.input, 600)}
                          </pre>
                        </div>
                      ) : null}
                      {(e.output || matchedTool?.output) ? (
                        <div>
                          <p className="text-[9px] font-semibold uppercase text-muted-foreground">Output</p>
                          <pre className="mt-0.5 text-[10px] whitespace-pre-wrap break-words max-h-36 overflow-y-auto rounded bg-slate-50 dark:bg-slate-950 p-2">
                            {e.output ?? summarizeJson(matchedTool?.output, 600)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          : null}
      </div>
    </aside>
  );
}
