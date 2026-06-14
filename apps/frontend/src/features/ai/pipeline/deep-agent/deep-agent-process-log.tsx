"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, ScrollText, Terminal, Wrench, XCircle } from "lucide-react";

import { cn } from "@/utils/cn";

import { DeepAgentApprovalErrorPanel } from "./deep-agent-approval-error";
import { DeepAgentApprovalPanel } from "./deep-agent-approval-panel";
import { DeepAgentHitlGate } from "./deep-agent-hitl-gate";
import type { ApprovalSuggestionInsight, ApprovalToolError } from "./approval-suggestion-parse";
import { savedSpaceForTool, spaceDef, type SavedSpaceId } from "./deep-agent-spaces";

export type DeepAgentProcessLogEntry = {
  id: string;
  at: string;
  step: number;
  phase: "started" | "completed";
  tool: string;
  toolLabel: string;
  status: "running" | "success" | "error";
  title: string;
  detail: string;
  input?: Record<string, unknown>;
  output?: string;
  durationMs?: number;
  /** Optional flow tag (auto-derived from tool when omitted). */
  spaceTag?: SavedSpaceId;
};

/** Shape accepted by appendProcessLog (id/at/step are filled in by the store). */
export type DeepAgentProcessLogInput = Omit<DeepAgentProcessLogEntry, "id" | "at" | "step"> & {
  id?: string;
};

const SPACE_TAG_COLORS: Partial<Record<SavedSpaceId, string>> = {
  work_orders: "bg-blue-100 text-blue-800",
  documents: "bg-violet-100 text-violet-800",
  udr: "bg-cyan-100 text-cyan-800",
  migration: "bg-emerald-100 text-emerald-800",
  schema: "bg-amber-100 text-amber-800",
  compliance: "bg-indigo-100 text-indigo-800",
  general: "bg-slate-100 text-slate-700",
};

function logStatusIcon(status: DeepAgentProcessLogEntry["status"], dark: boolean) {
  if (status === "running") {
    return (
      <Loader2
        size={14}
        className={cn("shrink-0 mt-0.5 animate-spin", dark ? "text-violet-400" : "text-indigo-600")}
      />
    );
  }
  if (status === "success") {
    return (
      <CheckCircle2
        size={14}
        className={cn("shrink-0 mt-0.5", dark ? "text-emerald-400" : "text-emerald-600")}
      />
    );
  }
  return <XCircle size={14} className={cn("shrink-0 mt-0.5", dark ? "text-red-400" : "text-red-500")} />;
}

function SpaceTagBadge({ spaceId, dark }: { spaceId: SavedSpaceId; dark: boolean }) {
  const label = spaceDef(spaceId).shortLabel;
  const tone = SPACE_TAG_COLORS[spaceId] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shrink-0",
        dark ? "bg-slate-700 text-slate-200" : tone,
      )}
    >
      {label}
    </span>
  );
}

function resolveSpaceTag(entry: DeepAgentProcessLogEntry): SavedSpaceId {
  return entry.spaceTag ?? savedSpaceForTool(entry.tool) ?? "general";
}

function logLevel(entry: DeepAgentProcessLogEntry): { label: string; cls: string } {
  if (entry.phase === "started" || entry.status === "running") return { label: "RUN", cls: "text-indigo-500" };
  if (entry.status === "error") return { label: "ERROR", cls: "text-red-500" };
  return { label: "OK", cls: "text-emerald-600" };
}

function fmtLogTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

/** Logs tab — same stream rendered as a compact, monospace debug/python-logger view. */
function ProcessLogsStream({ entries, dark }: { entries: DeepAgentProcessLogEntry[]; dark: boolean }) {
  if (entries.length === 0) {
    return (
      <p className={cn("text-xs px-1 py-2", dark ? "text-slate-400" : "text-muted-foreground")}>
        No log lines yet. Run a flow to stream processing/debug output here.
      </p>
    );
  }
  return (
    <div
      className={cn(
        "rounded-lg border p-2 font-mono text-[10px] leading-relaxed space-y-1",
        dark ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {entries.map((e) => {
        const lvl = logLevel(e);
        return (
          <div key={e.id} className="whitespace-pre-wrap break-all">
            <span className={dark ? "text-slate-500" : "text-slate-400"}>{fmtLogTime(e.at)}</span>{" "}
            <span className="text-slate-400">#{e.step}</span>{" "}
            <span className={cn("font-semibold", lvl.cls)}>[{lvl.label}]</span>{" "}
            <span className={dark ? "text-violet-300" : "text-violet-700"}>{e.tool}</span>
            {" — "}
            <span>{e.detail || e.title}</span>
            {e.durationMs != null ? <span className="text-slate-400"> ({e.durationMs}ms)</span> : null}
            {e.output ? (
              <div
                className={cn(
                  "mt-0.5 pl-3 border-l",
                  dark ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500",
                )}
              >
                {e.output}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function DeepAgentProcessLogPanel({
  entries,
  loading,
  variant = "light",
  interruptPayload,
  approvalInsight,
  approvalToolError,
  busy,
  resuming,
  onSubmitHitl,
  onApprovalApprove,
  onApprovalReject,
}: {
  entries: DeepAgentProcessLogEntry[];
  loading?: boolean;
  variant?: "light" | "dark";
  interruptPayload?: Record<string, unknown> | null;
  approvalInsight?: ApprovalSuggestionInsight | null;
  approvalToolError?: ApprovalToolError | null;
  busy?: boolean;
  resuming?: boolean;
  onSubmitHitl?: (decision: Record<string, unknown>) => void | Promise<void>;
  onApprovalApprove?: () => void;
  onApprovalReject?: () => void;
}) {
  const dark = variant === "dark";
  const [tab, setTab] = useState<"tools" | "logs">("tools");
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at) || b.step - a.step);
  const completed = sorted.filter((e) => e.phase === "completed").length;
  const showGate = !!interruptPayload && onSubmitHitl;
  const showApproval = approvalInsight || approvalToolError;

  const tabBtnCls = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
      active
        ? dark
          ? "bg-slate-700 text-slate-100"
          : "bg-white text-slate-900 shadow-sm"
        : dark
          ? "text-slate-400 hover:text-slate-200"
          : "text-slate-500 hover:text-slate-700",
    );

  return (
    <aside
      aria-label="Orchestrator process log"
      className={cn(
        "flex h-full min-h-0 flex-col",
        dark ? "rounded-2xl border border-slate-700/60 bg-slate-900/70" : "",
      )}
    >
      <div className={cn("shrink-0 px-3 pt-2 pb-3", dark ? "border-b border-slate-700/60" : "")}>
        <div className="flex items-center justify-between gap-2">
          <div
            className={cn(
              "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider",
              dark ? "text-slate-300" : "text-slate-500",
            )}
          >
            <ScrollText size={12} />
            Process log
          </div>
          {sorted.length > 0 ? (
            <span
              className={cn(
                "text-[10px] font-medium tabular-nums",
                dark ? "text-slate-400" : "text-slate-400",
              )}
            >
              {completed} step{completed === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "mt-2 inline-flex gap-0.5 rounded-lg p-0.5",
            dark ? "bg-slate-800/60" : "bg-slate-100/60",
          )}
        >
          <button type="button" className={tabBtnCls(tab === "tools")} onClick={() => setTab("tools")}>
            <Wrench size={11} />
            Tools
          </button>
          <button type="button" className={tabBtnCls(tab === "logs")} onClick={() => setTab("logs")}>
            <Terminal size={11} />
            Logs
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-2">
        {(loading || busy || resuming) ? (
          <div
            className={cn(
              "rounded-lg px-3 py-2 flex items-center gap-2 text-xs",
              dark ? "bg-violet-950/40 text-violet-200" : "bg-slate-100/60 text-slate-600",
            )}
          >
            <Loader2 size={13} className="animate-spin shrink-0" />
            {resuming ? "Resuming workflow…" : "Orchestrator running…"}
          </div>
        ) : null}

        {tab === "logs" ? (
          <ProcessLogsStream entries={sorted} dark={dark} />
        ) : sorted.length === 0 && !loading && !busy ? (
          <p
            className={cn(
              "text-xs px-1 py-2 leading-relaxed",
              dark ? "text-slate-400" : "text-muted-foreground",
            )}
          >
            Send a message to see tagged tool steps (work orders, migration, doc RAG, UDR, schema).
          </p>
        ) : (
          sorted.map((entry) => {
            const spaceId = resolveSpaceTag(entry);
            return (
              <div
                key={entry.id}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-xs transition-colors",
                  dark && entry.phase === "started" && "bg-violet-950/30",
                  dark && entry.phase === "completed" && entry.status === "success" && "bg-emerald-950/25",
                  dark && entry.phase === "completed" && entry.status === "error" && "bg-red-950/30",
                  !dark && entry.phase === "started" && "bg-slate-50/60",
                  !dark && entry.phase === "completed" && entry.status === "success" && "bg-slate-50/40",
                  !dark && entry.phase === "completed" && entry.status === "error" && "bg-red-50/50",
                )}
              >
                <div className="flex items-start gap-2">
                  {logStatusIcon(entry.status, dark)}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SpaceTagBadge spaceId={spaceId} dark={dark} />
                      <span className={cn("font-mono text-[10px]", dark ? "text-slate-500" : "text-slate-500")}>
                        #{entry.step}
                      </span>
                      <span className={cn("font-semibold", dark ? "text-slate-100" : "text-slate-800")}>
                        {entry.title}
                      </span>
                      {entry.durationMs != null ? (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-mono",
                            dark ? "bg-slate-800 text-slate-300" : "bg-slate-200/80 text-slate-600",
                          )}
                        >
                          {entry.durationMs}ms
                        </span>
                      ) : null}
                    </div>
                    <p className={cn("mt-1 leading-snug", dark ? "text-slate-300" : "text-slate-600")}>
                      {entry.detail}
                    </p>
                    <p className={cn("mt-0.5 text-[10px] font-mono", dark ? "text-slate-500" : "text-muted-foreground")}>
                      {entry.tool}
                    </p>
                    {entry.input && Object.keys(entry.input).length > 0 ? (
                      <details className="mt-2">
                        <summary
                          className={cn(
                            "cursor-pointer text-[10px] font-medium",
                            dark ? "text-violet-300" : "text-violet-700",
                          )}
                        >
                          Request
                        </summary>
                        <pre
                          className={cn(
                            "mt-1 max-h-36 overflow-auto rounded-md border p-2 text-[10px] font-mono whitespace-pre-wrap break-all",
                            dark
                              ? "border-slate-700 bg-slate-950 text-slate-300"
                              : "border-slate-200 bg-white",
                          )}
                        >
                          {JSON.stringify(entry.input, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                    {entry.output ? (
                      <details className="mt-2">
                        <summary
                          className={cn(
                            "cursor-pointer text-[10px] font-medium",
                            dark ? "text-violet-300" : "text-violet-700",
                          )}
                        >
                          Response
                        </summary>
                        <pre
                          className={cn(
                            "mt-1 max-h-48 overflow-auto rounded-md border p-2 text-[10px] font-mono whitespace-pre-wrap break-all",
                            dark
                              ? "border-slate-700 bg-slate-950 text-slate-300"
                              : "border-slate-200 bg-white",
                          )}
                        >
                          {entry.output}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {showGate ? (
          <div className="rounded-xl border border-amber-200 overflow-hidden">
            <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
              <SpaceTagBadge spaceId="migration" dark={false} />
              <span className="text-[11px] font-medium text-amber-900">Human gate</span>
            </div>
            <DeepAgentHitlGate
              payload={interruptPayload!}
              busy={busy}
              onApproveMapping={(d) => void onSubmitHitl!(d)}
              onConfirmRollback={(d) => void onSubmitHitl!(d)}
              onGenericDecision={(d) => void onSubmitHitl!(d)}
            />
          </div>
        ) : null}

        {showApproval ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <SpaceTagBadge spaceId="work_orders" dark={false} />
              <span className="text-[11px] font-medium text-slate-700">Approval</span>
            </div>
            {approvalToolError ? <DeepAgentApprovalErrorPanel error={approvalToolError} /> : null}
            {approvalInsight && !approvalToolError ? (
              <DeepAgentApprovalPanel
                insight={approvalInsight}
                onApprove={onApprovalApprove}
                onReject={onApprovalReject}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
