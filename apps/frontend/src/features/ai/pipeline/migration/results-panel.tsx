"use client";
import { CheckCircle, Download, RotateCcw, BarChart3, Database } from "lucide-react";
import type { MigrationStatusResponse } from "../../chat-api";
import { migrationFullExportUrl } from "../../chat-api";

interface Props {
  migration: MigrationStatusResponse;
  onReset: () => void;
}

export default function ResultsPanel({ migration, onReset }: Props) {
  const totalMapped =
    migration.t1_mapped_count + migration.t2_auto_count + migration.t2_human_count;
  // Coverage can exceed 100% when the user adds new columns (T1_new_table /
  // T1_manual) that weren't in the source's `total_fields` denominator —
  // 29 mapped / 25 source fields = 116%. Clamp so the bar stays sane and
  // never reads as if the system is operating above the source's field count.
  const coveragePct =
    migration.total_fields > 0
      ? Math.min(100, Math.round((totalMapped / migration.total_fields) * 100))
      : 0;

  const downloads: { label: string; url: string | null; ext: string }[] = [
    { label: "JSON mapping",   url: migration.output_json_url,       ext: "json" },
    { label: "CSV report",     url: migration.output_csv_url,        ext: "csv" },
    { label: "SQL DDL",        url: migration.output_sql_url,        ext: "sql" },
    { label: "Migration PDF",  url: migration.migration_report_url,  ext: "pdf" },
  ];

  return (
    <div className="max-w-2xl">
      {/* Success header */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-8 flex flex-col items-center text-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center">
          <CheckCircle size={32} className="text-green-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Migration complete</h2>
          <p className="text-sm text-slate-500 mt-1">
            {migration.cmms_name} data has been mapped and ingested into Plenum CAFM.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={16} className="text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-700">Mapping summary</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label: "T1 auto-mapped",   value: migration.t1_mapped_count,  color: "text-green-600" },
            { label: "T2 auto-mapped",   value: migration.t2_auto_count,    color: "text-indigo-600" },
            { label: "Human reviewed",   value: migration.t2_human_count,   color: "text-purple-600" },
            { label: "Unmapped",         value: migration.unmapped_count,   color: "text-slate-500" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
              <span className="text-sm text-slate-600">{label}</span>
              <span className={`font-mono font-bold ${color}`}>{value}</span>
            </div>
          ))}
        </div>

        {/* Coverage bar */}
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-slate-600">Coverage</span>
            <span className="font-mono font-bold text-indigo-600">{coveragePct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                coveragePct >= 80 ? "bg-green-500" : coveragePct >= 60 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${coveragePct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Download links */}
      {downloads.some((d) => d.url) && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 mb-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Download size={14} className="text-indigo-600" />
            Downloads
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {downloads.filter((d) => d.url).map(({ label, url, ext }) => (
              <a
                key={ext}
                href={url!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Download size={14} className="text-indigo-500" />
                {label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Full target-table export — existing rows + the rows this migration added */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-sm p-5 mb-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
          <Database size={14} className="text-emerald-600" />
          Full table data (old + new)
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Each target table in full — your existing rows plus the rows this migration added.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(["csv", "json", "sql"] as const).map((fmt) => (
            <a
              key={fmt}
              href={migrationFullExportUrl(migration.migration_id, fmt)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm text-slate-700 hover:bg-emerald-50 transition-colors"
            >
              <Download size={14} className="text-emerald-500" />
              {fmt === "csv" ? "CSV (zip)" : fmt.toUpperCase()}
            </a>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-400 mb-5">
        <span>ID: <code className="font-mono">{migration.migration_id.slice(0, 8)}…</code></span>
        {migration.completed_at && (
          <span>Completed: {new Date(migration.completed_at).toLocaleString()}</span>
        )}
      </div>

      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
      >
        <RotateCcw size={14} />
        New migration
      </button>
    </div>
  );
}
