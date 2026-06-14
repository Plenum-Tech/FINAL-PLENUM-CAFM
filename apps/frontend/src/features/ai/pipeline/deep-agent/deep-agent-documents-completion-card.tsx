"use client";

import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, FileText, Layers, History } from "lucide-react";

/** Frozen snapshot of a document-indexing batch — durable timeline event. */
export type CompletedDocumentsSnapshot = {
  /** Document IDs that were indexed in this batch (used to reopen the panel). */
  documentIds: string[];
  fileNames: string[];
  /** Aggregate counts at capture time. */
  totalDocs: number;
  indexedCount: number;
  errorCount: number;
  totalPages: number;
  totalChunks: number;
  capturedAt: number;
};

export function DocumentsCompletionCard({
  snapshot,
  onOpenDocuments,
  onOpenMatchSchema,
}: {
  snapshot: CompletedDocumentsSnapshot;
  onOpenDocuments: () => void;
  onOpenMatchSchema?: () => void;
}) {
  const allOk = snapshot.errorCount === 0;
  const headline = allOk
    ? snapshot.indexedCount > 1
      ? `${snapshot.indexedCount} documents indexed`
      : "Document indexed"
    : `${snapshot.indexedCount} indexed · ${snapshot.errorCount} error${snapshot.errorCount === 1 ? "" : "s"}`;

  const Icon = allOk ? CheckCircle2 : AlertCircle;
  const accent = allOk
    ? { ring: "ring-emerald-200", iconCls: "text-emerald-600", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" }
    : { ring: "ring-amber-200", iconCls: "text-amber-600", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700" };

  const previewFiles = snapshot.fileNames.slice(0, 3);
  const remainingFiles = Math.max(0, snapshot.fileNames.length - previewFiles.length);

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
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex h-1.5 w-1.5 rounded-full ${accent.dot}`} />
              <h3 className="text-sm font-semibold text-slate-900 tracking-tight">{headline}</h3>
              <span
                className={`text-[10px] font-medium uppercase tracking-wider rounded-full px-1.5 py-0.5 ${accent.chip}`}
              >
                {allOk ? "indexed" : "partial"}
              </span>
            </div>
            {previewFiles.length ? (
              <p
                className="mt-1 text-[13px] text-slate-700 truncate"
                title={snapshot.fileNames.join(", ")}
              >
                <FileText size={12} className="inline -mt-0.5 mr-1 text-slate-400" />
                {previewFiles.join(" · ")}
                {remainingFiles ? (
                  <span className="text-slate-400"> · +{remainingFiles} more</span>
                ) : null}
              </p>
            ) : null}
            {snapshot.capturedAt ? (
              <p className="mt-0.5 text-[11px] text-slate-400">
                Indexed{" "}
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Documents" value={snapshot.totalDocs} />
          <Stat label="Indexed" value={snapshot.indexedCount} />
          {snapshot.totalPages > 0 ? <Stat label="Pages" value={snapshot.totalPages} /> : null}
          {snapshot.totalChunks > 0 ? <Stat label="Chunks" value={snapshot.totalChunks} /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onOpenDocuments}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <BookOpen size={12} />
            Open documents
          </button>
          {onOpenMatchSchema ? (
            <button
              type="button"
              onClick={onOpenMatchSchema}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Layers size={12} />
              Match to CMMS rows
              <ArrowRight size={12} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenDocuments}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <History size={12} />
            View library
          </button>
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
