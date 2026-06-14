"use client";

import { ArrowRight, Layers, Loader2, PauseCircle, PlayCircle } from "lucide-react";

import { useSchemaMappingStatus } from "@/features/ai/chat-api";
import { isSchemaEffectivelyComplete } from "@/features/ai/pipeline/schema/schema-gate-state";

/**
 * Persistent banner for an in-flight schema mapping job (e.g. Fiix → plenum_cafm).
 * Polls /status every 3s; hides when the session is effectively complete or
 * failed (the dedicated SchemaResultsPanel takes over once you open the panel).
 */
export function ActiveSchemaCard({
  schemaMappingId,
  label,
  onResume,
}: {
  schemaMappingId: string;
  label?: string;
  onResume: () => void;
}) {
  const { data: session } = useSchemaMappingStatus(schemaMappingId, {
    enabled: !!schemaMappingId,
    refetchInterval: 3000,
  });
  if (!session) return null;

  const status = String(session.status ?? "").toLowerCase();
  const terminal =
    status === "complete" ||
    status === "failed" ||
    status === "ddl_failed" ||
    status === "cancelled";
  if (terminal) return null;
  if (isSchemaEffectivelyComplete(session)) return null;

  const awaitingUser = status === "step_paused" || !!session.pending_gate_type;
  // Schema mapping normally reports a real progress_pct (we've seen 88.8…%
  // returned mid-flight). Only fall through to a node-count derivation when
  // the server hasn't computed one yet; never show a forced 0%.
  const nodes = session.nodes ?? [];
  const completedNodes = nodes.filter(
    (n) => String(n.status ?? "").toLowerCase() === "complete",
  ).length;
  const totalNodes = nodes.length;
  const serverPct =
    typeof session.progress_pct === "number" && session.progress_pct > 0
      ? Math.round(session.progress_pct)
      : null;
  const derivedPct =
    totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : null;
  const progress = serverPct ?? derivedPct;
  const stepBadge =
    totalNodes > 0
      ? `Step ${Math.max(1, Math.min(totalNodes, completedNodes + (status === "complete" ? 0 : 1)))} of ${totalNodes}`
      : session.current_node
        ? `Node ${session.current_node}`
        : null;

  const stepLabel = (() => {
    if (session.pending_gate_type) {
      const map: Record<string, string> = {
        pre_semantic: "Pre-semantic review",
        field_mapping: "Field mapping review",
        hierarchy: "Hierarchy confirmation",
        artifacts: "Artifacts review",
      };
      return (
        map[String(session.pending_gate_type).toLowerCase()] ??
        `Gate: ${session.pending_gate_type}`
      );
    }
    if (session.current_node) {
      return `Node ${session.current_node}`;
    }
    return "Mapping in progress";
  })();

  const statusChip = awaitingUser
    ? { label: "Awaiting action", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
    : status === "running"
      ? { label: "Running", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
      : { label: status || "Active", cls: "bg-slate-100 text-slate-700 ring-slate-200" };

  const Icon = awaitingUser ? PauseCircle : Loader2;
  const iconCls = awaitingUser ? "text-amber-600" : "text-emerald-600 animate-spin";

  const headline = label || session.external_cmms_name || "Schema mapping";

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div
          aria-hidden
          className="shrink-0 h-8 w-8 rounded-full bg-emerald-50 flex items-center justify-center mt-0.5"
        >
          <Icon size={15} className={iconCls} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Active schema mapping
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-0.5 text-[10px] font-medium ${statusChip.cls}`}
            >
              {statusChip.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-slate-900 tracking-tight">
            {headline}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <Layers size={11} className="text-slate-400" />
            <span className="truncate">{stepLabel}</span>
            {stepBadge ? (
              <>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{stepBadge}</span>
              </>
            ) : null}
            {progress != null ? (
              <>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{progress}%</span>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onResume}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
        >
          <PlayCircle size={13} />
          {awaitingUser ? "Resume mapping" : "Open schema"}
          <ArrowRight size={12} />
        </button>
      </div>
      {progress != null ? (
        <div aria-hidden className="h-1 w-full bg-slate-100">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
