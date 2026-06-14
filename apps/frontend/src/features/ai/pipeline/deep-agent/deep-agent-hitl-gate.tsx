"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";

import type { MappingApprovalField } from "@/features/ai/deep-agents-api";

export function DeepAgentHitlGate(props: {
  payload: Record<string, unknown>;
  busy?: boolean;
  onApproveMapping: (decision: { approved: boolean; corrections?: Record<string, string> }) => void;
  onConfirmRollback: (decision: { confirmed: boolean }) => void;
  onGenericDecision?: (decision: Record<string, unknown>) => void;
}) {
  const gateType = String(props.payload.type ?? props.payload.gate ?? "unknown");

  if (gateType === "mapping_approval") {
    return (
      <MappingApprovalGate
        payload={props.payload}
        busy={props.busy}
        onSubmit={props.onApproveMapping}
      />
    );
  }

  if (gateType === "rollback_confirmation") {
    return (
      <RollbackConfirmationGate
        payload={props.payload}
        busy={props.busy}
        onSubmit={props.onConfirmRollback}
      />
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <GateHeader
        title="Human review required"
        message={String(props.payload.message ?? "The workflow is paused until you respond.")}
      />
      <pre className="mt-3 text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 p-3">
        {JSON.stringify(props.payload, null, 2)}
      </pre>
      {props.onGenericDecision ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onGenericDecision?.({ approved: true })}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            <CheckCircle size={16} />
            Approve & continue
          </button>
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onGenericDecision?.({ approved: false })}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-medium disabled:opacity-50"
          >
            <XCircle size={16} />
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GateHeader(props: { title: string; message: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
        <AlertTriangle size={18} className="text-amber-700" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900">{props.title}</div>
        <p className="mt-1 text-sm text-slate-600 leading-relaxed">{props.message}</p>
      </div>
    </div>
  );
}

function MappingApprovalGate(props: {
  payload: Record<string, unknown>;
  busy?: boolean;
  onSubmit: (decision: { approved: boolean; corrections?: Record<string, string> }) => void;
}) {
  const lowFields = useMemo(() => {
    const raw = props.payload.low_confidence_fields;
    return Array.isArray(raw) ? (raw as MappingApprovalField[]) : [];
  }, [props.payload]);

  const [corrections, setCorrections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of lowFields) {
      const src = String(f.source_field ?? "");
      const canon = String(f.canonical_field ?? "");
      if (src) init[src] = canon;
    }
    return init;
  });

  const message = String(
    props.payload.message ??
      "Some field mappings need your review before the import can continue.",
  );

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-4">
      <GateHeader title="Field mapping approval" message={message} />

      {lowFields.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Low-confidence fields ({lowFields.length})
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {lowFields.map((f) => {
              const src = String(f.source_field ?? "—");
              const conf =
                typeof f.confidence === "number"
                  ? `${Math.round(f.confidence * 100)}%`
                  : "—";
              return (
                <div key={src} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2.5 items-center">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">Source</div>
                    <div className="text-sm font-mono text-slate-800">{src}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">Canonical field</div>
                    <input
                      type="text"
                      value={corrections[src] ?? ""}
                      onChange={(e) =>
                        setCorrections((prev) => ({ ...prev, [src]: e.target.value }))
                      }
                      className="mt-0.5 w-full h-8 rounded-md border border-slate-200 px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      disabled={props.busy}
                    />
                  </div>
                  <div className="text-xs font-semibold text-amber-700 sm:text-right">{conf}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {typeof props.payload.instructions === "string" && props.payload.instructions ? (
        <p className="text-xs text-slate-500">{props.payload.instructions}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.busy}
          onClick={() => props.onSubmit({ approved: true, corrections })}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          <CheckCircle size={16} />
          Approve mappings
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() => props.onSubmit({ approved: false })}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          <XCircle size={16} className="text-slate-500" />
          Reject
        </button>
      </div>
    </div>
  );
}

function RollbackConfirmationGate(props: {
  payload: Record<string, unknown>;
  busy?: boolean;
  onSubmit: (decision: { confirmed: boolean }) => void;
}) {
  const message = String(
    props.payload.message ??
      "This will permanently delete all rows imported by this migration.",
  );
  const migrationId = String(props.payload.migration_id ?? "—");
  const reason = String(props.payload.reason ?? "");

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-4">
      <GateHeader title="Confirm migration rollback" message={message} />
      <div className="rounded-lg border border-red-100 bg-white px-3 py-2 text-xs text-slate-600 space-y-1">
        <div>
          <span className="font-semibold text-slate-700">Migration ID: </span>
          <span className="font-mono">{migrationId}</span>
        </div>
        {reason ? (
          <div>
            <span className="font-semibold text-slate-700">Reason: </span>
            {reason}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.busy}
          onClick={() => props.onSubmit({ confirmed: true })}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
        >
          Confirm rollback
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() => props.onSubmit({ confirmed: false })}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
