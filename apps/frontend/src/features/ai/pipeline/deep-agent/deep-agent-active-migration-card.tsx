"use client";

import { ArrowRight, FileSpreadsheet, Loader2, PauseCircle, PlayCircle, X } from "lucide-react";

import type { MigrationStatusResponse } from "@/features/ai/chat-api";

const NODE_LABELS: Record<number, string> = {
  1: "File ingestion",
  2: "Deterministic mapping",
  3: "Pre-semantic review",
  4: "Semantic mapping",
  5: "Field mapping review",
  6: "Data preprocessing",
  7: "Hierarchy detection",
  8: "Hierarchy confirmation",
  9: "Data artifacts",
};

const GATE_LABELS: Record<string, string> = {
  pre_semantic: "Pre-semantic review",
  field_mapping: "Field mapping review",
  hierarchy: "Hierarchy confirmation",
  final_confirmation: "Final confirmation",
};

/**
 * Compute a trustworthy progress for an active migration.
 *
 * The migration backend currently leaves `progress_pct` at 0 even when nodes
 * are progressing, so trust order is:
 *   1. nodes[].status === "complete" / nodes.length  (most reliable)
 *   2. current_step / total nodes                    (when nodes[] is empty)
 *   3. server-reported progress_pct                  (only if it's > 0)
 *
 * Returns null when no signal is available — the card hides the percent in
 * that case rather than showing a misleading 0%.
 */
function computeMigrationProgress(migration: MigrationStatusResponse): {
  pct: number | null;
  completed: number;
  total: number;
} {
  const nodes = migration.nodes ?? [];
  const total = nodes.length;
  const completed = nodes.filter(
    (n) => String(n.status ?? "").toLowerCase() === "complete",
  ).length;

  if (total > 0) {
    return { pct: Math.round((completed / total) * 100), completed, total };
  }

  if (typeof migration.current_step === "number" && migration.current_step > 0) {
    // Without a node list we can't know the total, so we can't render a
    // meaningful percent. Surface the step number instead.
    return { pct: null, completed: 0, total: 0 };
  }

  if (typeof migration.progress_pct === "number" && migration.progress_pct > 0) {
    return {
      pct: Math.round(migration.progress_pct),
      completed: 0,
      total: 0,
    };
  }

  return { pct: null, completed: 0, total: 0 };
}

/**
 * Persistent banner that keeps an active migration visible inside the chat tab.
 * Renders only while the migration is non-terminal — flips off when status
 * reaches complete/failed/cancelled (the completion summary card takes over).
 */
export function ActiveMigrationCard({
  migration,
  fileNames,
  onResume,
  onDismiss,
}: {
  migration: MigrationStatusResponse;
  fileNames: string[];
  onResume: () => void;
  onDismiss?: () => void;
}) {
  const status = (migration.status ?? "").toLowerCase();
  const awaitingUser = status === "step_paused" || !!migration.pending_gate_type;
  const { pct: progress, completed, total } = computeMigrationProgress(migration);

  const stepLabel = (() => {
    if (migration.pending_gate_type && GATE_LABELS[migration.pending_gate_type]) {
      return GATE_LABELS[migration.pending_gate_type];
    }
    const step = migration.current_step ?? 0;
    return NODE_LABELS[step] ?? (step ? `Node ${step}` : "In progress");
  })();

  // Step indicator — shown alongside or in place of the percentage. When we
  // have the node count, "Step N of M" is more honest than a derived percent;
  // when only current_step is known, just show "Step N".
  const stepBadge = (() => {
    if (total > 0) {
      const stepNum = Math.max(1, Math.min(total, completed + (status === "complete" ? 0 : 1)));
      return `Step ${stepNum} of ${total}`;
    }
    if (migration.current_step) return `Step ${migration.current_step}`;
    return null;
  })();

  const statusChip = awaitingUser
    ? { label: "Awaiting action", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
    : status === "running"
      ? { label: "Running", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" }
      : { label: status || "Active", cls: "bg-slate-100 text-slate-700 ring-slate-200" };

  const Icon = awaitingUser ? PauseCircle : Loader2;
  const iconCls = awaitingUser ? "text-amber-600" : "text-indigo-600 animate-spin";

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div
          aria-hidden
          className="shrink-0 h-8 w-8 rounded-full bg-slate-50 flex items-center justify-center mt-0.5"
        >
          <Icon size={15} className={iconCls} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Active migration
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-0.5 text-[10px] font-medium ${statusChip.cls}`}
            >
              {statusChip.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-900 tracking-tight">
              {fileNames[0] ?? migration.cmms_name ?? "Migration"}
            </span>
            {fileNames.length > 1 ? (
              <span className="text-[11px] text-slate-400">
                +{fileNames.length - 1} more
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <FileSpreadsheet size={11} className="text-slate-400" />
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
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
          >
            <PlayCircle size={13} />
            {awaitingUser ? "Resume migration" : "Open workflow"}
            <ArrowRight size={12} />
          </button>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Hide card"
              className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </div>
      {progress != null ? (
        <div aria-hidden className="h-1 w-full bg-slate-100">
          <div
            className="h-full bg-indigo-500 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
