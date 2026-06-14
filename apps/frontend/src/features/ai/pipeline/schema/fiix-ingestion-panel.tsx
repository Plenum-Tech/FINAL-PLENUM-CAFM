"use client";
import { CheckCircle, XCircle, Download, RefreshCw, AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui";
import type { FiixIngestionStatusResponse } from "../../chat-api";
import { coerceStringArray, formatShortId } from "../../lib/coerce";

interface Props {
  ingestion: FiixIngestionStatusResponse | null | undefined;
  isLoading?: boolean;
  onRetry?: () => void;
}

const NODE_STEPS: { key: string; label: string; statusKey: FiixIngestionStatusResponse["status"] }[] = [
  { key: "fetch",       label: "Fetching all Fiix records",     statusKey: "fetching" },
  { key: "preprocess",  label: "Preprocessing & normalising",   statusKey: "preprocessing" },
  { key: "write",       label: "Writing to target schema",      statusKey: "writing" },
];

function nodeState(
  stepStatus: FiixIngestionStatusResponse["status"],
  currentStatus: FiixIngestionStatusResponse["status"],
): "pending" | "running" | "done" | "error" {
  const order: FiixIngestionStatusResponse["status"][] = [
    "pending", "fetching", "preprocessing", "writing", "complete", "failed",
  ];
  const stepIdx = order.indexOf(stepStatus);
  const currIdx = order.indexOf(currentStatus);
  if (currentStatus === "failed") {
    if (currIdx >= stepIdx) return currIdx === stepIdx ? "error" : "done";
    return "pending";
  }
  if (currIdx > stepIdx) return "done";
  if (currIdx === stepIdx) return "running";
  return "pending";
}

function NodeRow({
  label,
  state,
}: {
  label: string;
  state: "pending" | "running" | "done" | "error";
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
        {state === "done" && <CheckCircle size={18} className="text-green-500" />}
        {state === "running" && <Spinner size="sm" />}
        {state === "error" && <XCircle size={18} className="text-red-500" />}
        {state === "pending" && <div className="w-4 h-4 rounded-full border-2 border-slate-200" />}
      </div>
      <span
        className={`text-sm font-medium ${
          state === "done"
            ? "text-slate-700"
            : state === "running"
            ? "text-indigo-700"
            : state === "error"
            ? "text-red-600"
            : "text-slate-400"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

export default function FiixIngestionPanel({ ingestion, isLoading, onRetry }: Props) {
  if (isLoading && !ingestion) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
        <Spinner size="sm" />
        Starting ingestion…
      </div>
    );
  }

  if (!ingestion) return null;

  const status = ingestion.status;
  const isComplete = status === "complete";
  const isFailed = status === "failed";
  const isRunning = !isComplete && !isFailed;
  const fetchErrors = coerceStringArray(ingestion.fetch_errors);
  const writeErrors = coerceStringArray(ingestion.write_errors);

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 flex flex-col items-center text-center gap-3">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
            isComplete ? "bg-green-50" : isFailed ? "bg-red-50" : "bg-indigo-50"
          }`}
        >
          {isComplete && <CheckCircle size={28} className="text-green-500" />}
          {isFailed && <XCircle size={28} className="text-red-500" />}
          {isRunning && <Download size={28} className="text-indigo-500" />}
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {isComplete
              ? "Fiix data ingestion complete"
              : isFailed
              ? "Ingestion failed"
              : "Syncing data from Fiix…"}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {isComplete
              ? `${ingestion.total_records_written ?? 0} records written to target schema`
              : isFailed
              ? ingestion.error_message ?? "An error occurred during ingestion"
              : "Fetching, preprocessing, and writing all Fiix records to the new schema"}
          </p>
        </div>
      </div>

      {/* Pipeline steps */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-3 divide-y divide-slate-100">
        {NODE_STEPS.map((step) => (
          <NodeRow
            key={step.key}
            label={step.label}
            state={nodeState(step.statusKey, status)}
          />
        ))}
      </div>

      {/* Stats when complete */}
      {isComplete && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-500 tracking-widest">INGESTION STATS</span>
          </div>
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Records fetched",      value: ingestion.total_records_fetched },
                { label: "Records preprocessed", value: ingestion.total_records_preprocessed },
                { label: "Records written",      value: ingestion.total_records_written },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center text-center p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-2xl font-bold text-slate-900 font-mono">
                    {value ?? "—"}
                  </span>
                  <span className="text-xs text-slate-500 mt-1">{label}</span>
                </div>
              ))}
            </div>

            {/* Per-table breakdown */}
            {ingestion.write_results && Object.keys(ingestion.write_results).length > 0 && (
              <div className="rounded-lg border border-slate-200 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-slate-600">
                      <th className="px-3 py-2 font-semibold">table</th>
                      <th className="px-3 py-2 font-semibold text-right">inserted</th>
                      <th className="px-3 py-2 font-semibold text-right">skipped</th>
                      <th className="px-3 py-2 font-semibold text-right">errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(ingestion.write_results).map(([table, row]) => (
                      <tr key={table} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-slate-800">{table}</td>
                        <td className="px-3 py-2 font-mono text-green-700 text-right">{row.inserted}</td>
                        <td className="px-3 py-2 font-mono text-slate-500 text-right">{row.skipped}</td>
                        <td className="px-3 py-2 font-mono text-right">
                          {row.errors > 0 ? (
                            <span className="text-red-600">{row.errors}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Write errors */}
            {writeErrors.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertCircle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-800 space-y-1">
                  {writeErrors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error state */}
      {isFailed && ingestion.error_message && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-4">
          <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-red-800">Error</div>
            <div className="text-xs text-red-700 mt-1 font-mono">{ingestion.error_message}</div>
          </div>
        </div>
      )}

      {/* Fetch errors during run */}
      {fetchErrors.length > 0 && !isFailed && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <AlertCircle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800">
            {fetchErrors.length} object(s) had fetch errors — others continued.
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>
          Job: <code className="font-mono">{formatShortId(ingestion.ingestion_id)}</code>
        </span>
        {ingestion.completed_at && (
          <span>Completed: {new Date(ingestion.completed_at).toLocaleString()}</span>
        )}
        {isFailed && onRetry && (
          <button
            onClick={onRetry}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
