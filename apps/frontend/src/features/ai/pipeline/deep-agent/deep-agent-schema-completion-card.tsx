"use client";

import { AlertCircle, ArrowRight, CheckCircle2, Database, FileDown, Layers, History } from "lucide-react";

/** Frozen snapshot of a completed schema mapping session — durable timeline event. */
export type CompletedSchemaSnapshot = {
  schemaMappingId: string;
  label?: string;
  status: string;
  external_cmms_name?: string;
  newSchemaName?: string | null;
  tier1Mapped?: number | null;
  tier2AutoMapped?: number | null;
  tier2Flagged?: number | null;
  unmapped?: number | null;
  totalFields?: number | null;
  coveragePct?: number | null;
  outputJsonUrl?: string | null;
  outputCsvUrl?: string | null;
  outputSqlUrl?: string | null;
  errorMessage?: string | null;
  capturedAt: number;
};

export function SchemaCompletionCard({
  snapshot,
  onOpenSchema,
}: {
  snapshot: CompletedSchemaSnapshot;
  onOpenSchema: () => void;
}) {
  const status = (snapshot.status ?? "").toLowerCase();
  const isError =
    status === "failed" || status === "ddl_failed" || status === "cancelled";

  const Icon = isError ? AlertCircle : CheckCircle2;
  const accent = isError
    ? { ring: "ring-red-200", iconCls: "text-red-600", dot: "bg-red-500", chip: "bg-red-50 text-red-700" }
    : { ring: "ring-emerald-200", iconCls: "text-emerald-600", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" };

  const headline = isError
    ? "Schema mapping stopped"
    : "Schema mapping completed";

  const headerName =
    snapshot.label ||
    snapshot.external_cmms_name ||
    snapshot.newSchemaName ||
    snapshot.schemaMappingId.slice(0, 8);

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
                {status || "complete"}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-slate-700 truncate" title={headerName}>
              <Database size={12} className="inline -mt-0.5 mr-1 text-slate-400" />
              {headerName}
            </p>
            {snapshot.newSchemaName && snapshot.newSchemaName !== headerName ? (
              <p className="mt-0.5 text-[11px] text-slate-500 font-mono truncate">
                → {snapshot.newSchemaName}
              </p>
            ) : null}
            {snapshot.capturedAt ? (
              <p className="mt-0.5 text-[11px] text-slate-400">
                Completed{" "}
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

        {!isError && hasStats(snapshot) ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {snapshot.tier1Mapped != null ? <Stat label="T1 mapped" value={snapshot.tier1Mapped} /> : null}
            {snapshot.tier2AutoMapped != null ? <Stat label="T2 auto" value={snapshot.tier2AutoMapped} /> : null}
            {snapshot.unmapped != null ? <Stat label="Unmapped" value={snapshot.unmapped} /> : null}
            {snapshot.totalFields != null ? <Stat label="Total fields" value={snapshot.totalFields} /> : null}
          </div>
        ) : null}

        {snapshot.coveragePct != null && !isError ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-600">
            <span className="text-slate-400">Coverage</span>
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(0, Math.min(100, snapshot.coveragePct))}%` }}
              />
            </div>
            <span className="tabular-nums font-medium">{Math.round(snapshot.coveragePct)}%</span>
          </div>
        ) : null}

        {isError && snapshot.errorMessage ? (
          <div className="rounded-lg bg-red-50/60 px-3 py-2 text-xs text-red-800">
            {snapshot.errorMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onOpenSchema}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Layers size={12} />
            Open schema mapping
          </button>
          {!isError ? (
            <a
              href={snapshot.outputJsonUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                snapshot.outputJsonUrl
                  ? "text-slate-600 hover:bg-slate-100"
                  : "text-slate-300 pointer-events-none"
              }`}
              aria-disabled={!snapshot.outputJsonUrl}
            >
              <FileDown size={12} />
              Download JSON
            </a>
          ) : null}
          <button
            type="button"
            onClick={onOpenSchema}
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

function hasStats(s: CompletedSchemaSnapshot) {
  return (
    s.tier1Mapped != null ||
    s.tier2AutoMapped != null ||
    s.unmapped != null ||
    s.totalFields != null
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
