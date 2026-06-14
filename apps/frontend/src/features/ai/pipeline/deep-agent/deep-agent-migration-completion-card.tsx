"use client";

import { ArrowRight, CheckCircle2, FileSpreadsheet, Layers, History, AlertCircle } from "lucide-react";

/**
 * Frozen snapshot of a completed migration — the durable timeline event for
 * the chat. Stored per-session in sessionStorage so the card survives panel
 * unmount / page refresh / session restoration. Trimmed down from the full
 * MigrationStatusResponse so we don't bloat storage with node logs.
 */
export type CompletedMigrationSnapshot = {
  migration_id: string;
  status: string;
  cmms_name?: string;
  t1_mapped_count?: number;
  t2_auto_count?: number;
  t2_human_count?: number;
  unmapped_count?: number;
  total_fields?: number;
  progress_pct?: number;
  pending_gate_type?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  output_json_url?: string | null;
  output_csv_url?: string | null;
  output_sql_url?: string | null;
  fileNames: string[];
  capturedAt: number;
};

/**
 * Chat-stream bubble for a completed migration. Pure render — no dismiss
 * state; the shell stores the snapshots, the card just displays one.
 *
 *  • Open the migration panel (review details / outputs)
 *  • Continue to the queued next task (only on the most recent completion)
 *  • View history (same panel, history tab)
 */
export function MigrationCompletionCard({
  migration,
  fileNames,
  hasNextTask,
  onOpenDetails,
  onOpenHistory,
  onContinueNext,
}: {
  migration: CompletedMigrationSnapshot;
  fileNames: string[];
  hasNextTask: boolean;
  onOpenDetails: () => void;
  onOpenHistory?: () => void;
  onContinueNext: () => void;
}) {
  const status = (migration.status ?? "").toLowerCase();
  const isError = status === "failed" || status === "ddl_failed";
  const isComplete = status === "complete";
  const accent = isError
    ? { ring: "ring-red-200", dot: "bg-red-500", icon: AlertCircle, iconCls: "text-red-600", chip: "bg-red-50 text-red-700" }
    : { ring: "ring-emerald-200", dot: "bg-emerald-500", icon: CheckCircle2, iconCls: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700" };
  const Icon = accent.icon;

  const headline = isError
    ? "Migration stopped"
    : isComplete
      ? "Migration completed"
      : "Migration update";

  const totalRows = migration.t1_mapped_count != null && migration.unmapped_count != null
    ? migration.t1_mapped_count + (migration.t2_auto_count ?? 0) + (migration.t2_human_count ?? 0) + migration.unmapped_count
    : null;

  return (
    <div className="flex gap-3.5 items-start animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div
        aria-hidden
        className="shrink-0 h-7 w-7 rounded-full bg-slate-50 flex items-center justify-center mt-0.5"
      >
        <Icon size={14} className={accent.iconCls} />
      </div>
      <div className={`flex-1 rounded-2xl bg-white ring-1 ${accent.ring} shadow-sm p-4 space-y-3.5`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-1.5 w-1.5 rounded-full ${accent.dot}`} />
              <h3 className="text-sm font-semibold text-slate-900 tracking-tight">{headline}</h3>
              <span
                className={`text-[10px] font-medium uppercase tracking-wider rounded-full px-1.5 py-0.5 ${accent.chip}`}
              >
                {status || "complete"}
              </span>
            </div>
            {fileNames.length ? (
              <p className="mt-1 text-[13px] text-slate-700 truncate" title={fileNames.join(", ")}>
                <FileSpreadsheet size={12} className="inline -mt-0.5 mr-1 text-slate-400" />
                {fileNames.join(" · ")}
              </p>
            ) : null}
            {migration.capturedAt ? (
              <p className="mt-0.5 text-[11px] text-slate-400">
                Completed{" "}
                <time dateTime={new Date(migration.capturedAt).toISOString()}>
                  {new Date(migration.capturedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </p>
            ) : null}
          </div>
        </div>

        {(migration.t1_mapped_count != null || migration.unmapped_count != null) && !isError ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {migration.t1_mapped_count != null ? (
              <Stat label="T1 mapped" value={migration.t1_mapped_count} />
            ) : null}
            {migration.t2_auto_count != null ? (
              <Stat label="T2 auto" value={migration.t2_auto_count} />
            ) : null}
            {migration.t2_human_count != null ? (
              <Stat label="T2 reviewed" value={migration.t2_human_count} />
            ) : null}
            {totalRows != null ? <Stat label="Total fields" value={totalRows} /> : null}
          </div>
        ) : null}

        {isError && migration.error_message ? (
          <div className="rounded-lg bg-red-50/60 px-3 py-2 text-xs text-red-800">
            {migration.error_message}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Layers size={12} />
            Open migration details
          </button>
          {onOpenHistory ? (
            <button
              type="button"
              onClick={onOpenHistory}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <History size={12} />
              View history
            </button>
          ) : null}
          {hasNextTask ? (
            <button
              type="button"
              onClick={onContinueNext}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
            >
              Continue to next task
              <ArrowRight size={12} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50/80 px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800 tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
