"use client";

import { ArrowRight, BookOpen, CheckCircle2, FileText, Loader2, PlayCircle } from "lucide-react";

import { useDocList } from "@/features/ai/doc-rag-api";

/**
 * Persistent banner that keeps an in-flight document indexing job visible
 * inside the chat tab. Polls the doc list every 2s while at least one
 * tracked document is still extracting / processing.
 */
export function ActiveDocumentsCard({
  documentIds,
  fileNames,
  onResume,
}: {
  documentIds: string[];
  fileNames: string[];
  onResume: () => void;
}) {
  const tracked = new Set(documentIds);
  // Poll once the chat tab is rendered so the status pill stays live even when
  // the user has navigated away from the Documents panel.
  const { data: docs = [] } = useDocList({ refetchInterval: 2000 });
  const ours = docs.filter((d) => tracked.has(d.id));
  if (!ours.length) return null;

  // Aggregate state — show the busiest document first.
  const busy = ours.find((d) => d.status === "processing" || d.status === "extracting");
  const errored = ours.find((d) => d.status === "error");
  const primary = busy ?? errored ?? ours[0];
  const indexed = ours.filter((d) => d.status === "indexed").length;
  const allIndexed = indexed === ours.length;
  // Hide the card once everything's indexed — the completion-summary path
  // (or the user just navigating to docs) takes over.
  if (allIndexed && !errored) return null;

  const status = primary.status;
  const statusChip =
    status === "processing"
      ? { label: "Processing pages", cls: "bg-blue-50 text-blue-700 ring-blue-200" }
      : status === "extracting"
        ? { label: "Extracting & chunking", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
        : status === "error"
          ? { label: "Error", cls: "bg-red-50 text-red-700 ring-red-200" }
          : { label: "Indexed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" };

  const Icon = status === "indexed" ? CheckCircle2 : status === "error" ? FileText : Loader2;
  const iconCls =
    status === "indexed"
      ? "text-emerald-600"
      : status === "error"
        ? "text-red-600"
        : "text-rose-600 animate-spin";

  const progressPct =
    ours.length > 0 ? Math.round((indexed / ours.length) * 100) : 0;

  const fileLabel =
    fileNames.find((n) => n && n === primary.file_name) ??
    primary.file_name ??
    fileNames[0] ??
    "Document indexing";

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div
          aria-hidden
          className="shrink-0 h-8 w-8 rounded-full bg-rose-50 flex items-center justify-center mt-0.5"
        >
          <Icon size={15} className={iconCls} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Active document indexing
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-0.5 text-[10px] font-medium ${statusChip.cls}`}
            >
              {statusChip.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-900 tracking-tight truncate">
              {fileLabel}
            </span>
            {ours.length > 1 ? (
              <span className="shrink-0 text-[11px] text-slate-400">
                +{ours.length - 1} more
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <BookOpen size={11} className="text-slate-400" />
            <span className="tabular-nums">
              {indexed} / {ours.length} indexed · {progressPct}%
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onResume}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
        >
          <PlayCircle size={13} />
          Open documents
          <ArrowRight size={12} />
        </button>
      </div>
      <div aria-hidden className="h-1 w-full bg-slate-100">
        <div
          className="h-full bg-rose-500 transition-[width] duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
