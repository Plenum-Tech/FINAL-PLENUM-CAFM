"use client";

import { AlertCircle, ArrowRight, CheckCircle2, ClipboardList, History, Wrench } from "lucide-react";

/** Frozen snapshot of a completed work-order creation — durable timeline event. */
export type CompletedWorkOrderSnapshot = {
  workOrderId: string;
  title?: string | null;
  priority?: string | null;
  assetName?: string | null;
  locationName?: string | null;
  status?: string | null;
  capturedAt: number;
  isError?: boolean;
  errorMessage?: string | null;
};

export function WorkOrderCompletionCard({
  snapshot,
  onOpenWorkOrders,
}: {
  snapshot: CompletedWorkOrderSnapshot;
  onOpenWorkOrders: () => void;
}) {
  const isError = !!snapshot.isError;

  const Icon = isError ? AlertCircle : CheckCircle2;
  const accent = isError
    ? { ring: "ring-red-200", iconCls: "text-red-600", dot: "bg-red-500", chip: "bg-red-50 text-red-700" }
    : { ring: "ring-blue-200", iconCls: "text-blue-600", dot: "bg-blue-500", chip: "bg-blue-50 text-blue-700" };

  const headline = isError
    ? "Work order failed"
    : "Work order created";

  return (
    <div className="flex gap-3.5 items-start animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div
        aria-hidden
        className="shrink-0 h-7 w-7 rounded-full bg-slate-50 flex items-center justify-center mt-0.5"
      >
        <Icon size={14} className={accent.iconCls} />
      </div>
      <div className={`flex-1 rounded-2xl bg-white ring-1 ${accent.ring} shadow-sm p-4 space-y-3`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex h-1.5 w-1.5 rounded-full ${accent.dot}`} />
              <h3 className="text-sm font-semibold text-slate-900 tracking-tight">{headline}</h3>
              {snapshot.status ? (
                <span
                  className={`text-[10px] font-medium uppercase tracking-wider rounded-full px-1.5 py-0.5 ${accent.chip}`}
                >
                  {snapshot.status}
                </span>
              ) : null}
            </div>
            {snapshot.title ? (
              <p className="mt-1 text-[13px] text-slate-700 truncate" title={snapshot.title}>
                <Wrench size={12} className="inline -mt-0.5 mr-1 text-slate-400" />
                {snapshot.title}
              </p>
            ) : null}
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span className="font-mono">{snapshot.workOrderId.slice(0, 12)}…</span>
              {snapshot.assetName ? (
                <>
                  <span className="text-slate-300">·</span>
                  <span>Asset: {snapshot.assetName}</span>
                </>
              ) : null}
              {snapshot.locationName ? (
                <>
                  <span className="text-slate-300">·</span>
                  <span>Location: {snapshot.locationName}</span>
                </>
              ) : null}
              {snapshot.priority ? (
                <>
                  <span className="text-slate-300">·</span>
                  <span>Priority: {snapshot.priority}</span>
                </>
              ) : null}
            </div>
            {snapshot.capturedAt ? (
              <p className="mt-0.5 text-[11px] text-slate-400">
                Created{" "}
                <time dateTime={new Date(snapshot.capturedAt).toISOString()}>
                  {new Date(snapshot.capturedAt).toLocaleString(undefined, {
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

        {isError && snapshot.errorMessage ? (
          <div className="rounded-lg bg-red-50/60 px-3 py-2 text-xs text-red-800">
            {snapshot.errorMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onOpenWorkOrders}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <ClipboardList size={12} />
            Open work orders
          </button>
          <button
            type="button"
            onClick={onOpenWorkOrders}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <History size={12} />
            View history
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
