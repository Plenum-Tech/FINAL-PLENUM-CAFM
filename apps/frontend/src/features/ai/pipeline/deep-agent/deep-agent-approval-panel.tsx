"use client";

import { CheckCircle2, Clock, History, ShieldCheck, UserCheck } from "lucide-react";

import { cn } from "@/utils/cn";

import {
  formatApprovalStep,
  type ApprovalSuggestionInsight,
} from "./approval-suggestion-parse";

function confidenceBadge(confidence?: string, label?: string) {
  const text = label || confidence;
  if (!text) return null;
  const lower = text.toLowerCase();
  const tone =
    lower.includes("high")
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : lower.includes("partial")
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border", tone)}>
      {text}
    </span>
  );
}

function stepStatusClass(status?: string) {
  const s = (status ?? "").toLowerCase();
  if (s === "approved" || s === "completed") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (s === "rejected") return "text-red-700 bg-red-50 border-red-200";
  if (s === "pending" || s === "awaiting") return "text-amber-800 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

export function DeepAgentApprovalPanel(props: {
  insight: ApprovalSuggestionInsight;
  className?: string;
  onApprove?: () => void;
  onReject?: () => void;
  busy?: boolean;
}) {
  const { insight } = props;
  const isChainView = insight.sourceTool === "get_approval_chain";
  const isPostCreate =
    insight.sourceTool === "create_work_order" ||
    insight.sourceTool === "create_intelligent_work_order";

  return (
    <div
      className={cn(
        "rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white shadow-sm overflow-hidden",
        props.className,
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3 border-b border-indigo-100 bg-white/70">
        <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
          <ShieldCheck size={18} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {isChainView
                ? "Approval chain status"
                : isPostCreate
                  ? "Approval suggestion (work order created)"
                  : "Suggested approval chain"}
            </h3>
            {confidenceBadge(insight.confidence, insight.confidenceLabel)}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            From <span className="font-mono text-indigo-700">{insight.sourceTool}</span>
            {insight.workOrderId ? (
              <>
                {" "}
                · WO <span className="font-mono">{insight.workOrderId}</span>
              </>
            ) : null}
          </p>
          {(insight.matchScore != null || insight.riskScore != null) && !isChainView ? (
            <p className="text-[11px] text-slate-600 mt-1">
              {insight.matchScore != null ? `${insight.matchScore}% history match` : null}
              {insight.matchScore != null && insight.riskScore != null ? " · " : null}
              {insight.riskScore != null ? `risk ${insight.riskScore}/125` : null}
            </p>
          ) : null}
        </div>
      </div>

      {insight.recommendedSummary && !isChainView ? (
        <div className="px-4 py-2.5 border-b border-indigo-50">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 mb-1">
            Recommended path
          </div>
          <p className="text-sm text-slate-800 leading-snug">{insight.recommendedSummary}</p>
        </div>
      ) : null}

      {insight.steps.length > 0 ? (
        <div className="px-4 py-3 border-b border-indigo-50 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 flex items-center gap-1">
            <UserCheck size={12} />
            {isChainView ? "Steps" : "Approvers"}
          </div>
          <ol className="space-y-1.5">
            {insight.steps.map((step, i) => (
              <li
                key={`${step.request_id ?? step.email ?? i}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-slate-800 truncate">{formatApprovalStep(step)}</span>
                {step.status ? (
                  <span
                    className={cn(
                      "shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize",
                      stepStatusClass(step.status),
                    )}
                  >
                    {step.status}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">
                    #{i + 1}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {insight.previousProcesses.length > 0 ? (
        <div className="px-4 py-3 border-b border-indigo-50">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 flex items-center gap-1 mb-2">
            <History size={12} />
            Similar past approvals
          </div>
          <ul className="space-y-2">
            {insight.previousProcesses.slice(0, 3).map((proc) => (
              <li
                key={proc.work_order_id ?? proc.chain_summary}
                className="text-xs rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <div className="font-mono text-indigo-700 font-medium">
                  {proc.work_order_id ?? "—"}
                  {proc.match_score != null ? (
                    <span className="text-slate-500 font-sans ml-1">({proc.match_score}% match)</span>
                  ) : null}
                </div>
                <p className="text-slate-700 mt-0.5 leading-snug">{proc.chain_summary ?? "—"}</p>
                <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-muted-foreground">
                  {proc.final_status ? (
                    <span className="inline-flex items-center gap-0.5">
                      <CheckCircle2 size={10} />
                      {proc.final_status}
                    </span>
                  ) : null}
                  {proc.total_approval_hours != null ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Clock size={10} />
                      {proc.total_approval_hours}h end-to-end
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insight.message ? (
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Agent summary
          </div>
          <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
            {insight.message}
          </pre>
        </div>
      ) : null}

      {props.onApprove || props.onReject ? (
        <div className="px-4 py-3 border-t border-indigo-100 flex flex-wrap gap-2 bg-white/80">
          {props.onApprove ? (
            <button
              type="button"
              disabled={props.busy}
              onClick={props.onApprove}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <CheckCircle2 size={14} />
              Approve chain
            </button>
          ) : null}
          {props.onReject ? (
            <button
              type="button"
              disabled={props.busy}
              onClick={props.onReject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              Reject suggestion
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
