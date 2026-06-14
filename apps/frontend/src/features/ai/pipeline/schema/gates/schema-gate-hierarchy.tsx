"use client";
import { useState } from "react";
import {
  CheckCircle, XCircle, GitBranch, ArrowRight, ChevronDown, ChevronUp,
  AlertTriangle, Layers, RotateCcw,
} from "lucide-react";
import {
  useSchemaMappingGateHierarchy,
  type SchemaHierarchyGatePayload,
  type SchemaDetectedFk,
  type SchemaHierarchyDecision,
} from "../../../chat-api";
import { sortTableNames } from "../schema-table-sort";

interface Props {
  sessionId: string;
  payload: SchemaHierarchyGatePayload;
  onSubmitted: () => void;
  readOnly?: boolean;
}

type FKDecision = "approve" | "reject";

function ActionBtn({ label, icon, active, activeColor, onClick }: {
  label: string; icon: React.ReactNode; active: boolean; activeColor: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
        active ? `${activeColor} text-white` : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {icon}{label}
    </button>
  );
}

export default function SchemaGateHierarchy({ sessionId, payload, onSubmitted, readOnly = false }: Props) {
  const fks: SchemaDetectedFk[] = payload.detected_fks ?? [];
  const hierarchyLevels = payload.hierarchy_levels ?? {};

  const [decisions, setDecisions] = useState<FKDecision[]>(
    fks.map((fk) => ((fk.confidence ?? 1) >= 0.7 ? "approve" : "reject"))
  );
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { mutate: submitGate, isPending } = useSchemaMappingGateHierarchy({
    onSuccess: () => onSubmitted(),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Submission failed"),
  });

  function setDecision(idx: number, val: FKDecision) {
    setDecisions((prev) => prev.map((d, i) => (i === idx ? val : d)));
  }

  function handleSubmit() {
    const approved: SchemaHierarchyDecision[] = [];
    const rejected: SchemaHierarchyDecision[] = [];

    fks.forEach((fk, idx) => {
      const decision: SchemaHierarchyDecision = {
        source_table: fk.source_table,
        source_column: fk.source_column,
        target_table: fk.target_table,
        target_column: fk.target_column ?? "",
        confirmed: decisions[idx] === "approve",
      };
      if (decisions[idx] === "approve") {
        approved.push(decision);
      } else {
        rejected.push(decision);
      }
    });

    submitGate({
      schemaMappingId: sessionId,
      body: { approved_hierarchies: approved, rejected_hierarchies: rejected },
    });
  }

  const approvedCount = decisions.filter((d) => d === "approve").length;
  const rejectedCount = decisions.filter((d) => d === "reject").length;
  const lowConfCount = fks.filter((fk) => (fk.confidence ?? 1) < 0.7).length;

  // Group by source_table
  const byTable: Record<string, { fk: SchemaDetectedFk; idx: number }[]> = {};
  fks.forEach((fk, idx) => {
    if (!byTable[fk.source_table]) byTable[fk.source_table] = [];
    byTable[fk.source_table].push({ fk, idx });
  });

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
          <GitBranch size={20} className="text-purple-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Hierarchy Verification</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Review detected FK relationships and hierarchy structure. Approve correct links or reject incorrect ones.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "FK relationships", value: fks.length,       color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "Low confidence",   value: lowConfCount,     color: lowConfCount > 0 ? "text-amber-600" : "text-green-600", bg: lowConfCount > 0 ? "bg-amber-50" : "bg-green-50" },
          { label: "Approved",         value: approvedCount,    color: "text-green-700",  bg: "bg-green-50" },
          { label: "Rejected",         value: rejectedCount,    color: "text-red-700",    bg: "bg-red-50" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`rounded-xl border border-slate-200 shadow-sm p-3 ${bg}`}>
            <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Hierarchy levels */}
      {Object.keys(hierarchyLevels).length > 0 && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} className="text-purple-500" />
            <span className="text-sm font-semibold text-slate-700">Hierarchy structure</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(hierarchyLevels)
              .sort(([, a], [, b]) => a - b)
              .map(([table], i, arr) => (
                <span key={table} className="flex items-center gap-1">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-purple-100 text-purple-700">
                    {table}
                  </span>
                  {i < arr.length - 1 && <ArrowRight size={14} className="text-slate-400" />}
                </span>
              ))}
          </div>
          {payload.structure && (
            <p className="text-xs font-mono text-slate-500 mt-2">{payload.structure}</p>
          )}
        </div>
      )}

      {/* FK relationships */}
      <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <GitBranch size={14} className="text-indigo-500" />
        Foreign key relationships
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{fks.length}</span>
      </h3>

      {fks.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 text-center text-slate-500 text-sm mb-5">
          No foreign key relationships detected.
        </div>
      ) : (
        <div className="space-y-3 mb-5">
          {sortTableNames(Object.keys(byTable)).map((sourceTable) => {
            const entries = byTable[sourceTable] ?? [];
            return (
              <SourceTableGroup
                key={sourceTable}
                sourceTable={sourceTable}
                entries={entries}
                decisions={decisions}
                onSetDecision={setDecision}
              />
            );
          })}
        </div>
      )}

      {/* Reviewer notes */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Reviewer notes <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <textarea
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          rows={2}
          placeholder="Any corrections or comments about the detected hierarchy…"
          value={reviewerNotes}
          onChange={(e) => setReviewerNotes(e.target.value)}
        />
      </div>

      {error && !readOnly && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!readOnly ? (
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white text-base font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <CheckCircle size={18} />
              Confirm hierarchy ({approvedCount} approved, {rejectedCount} rejected)
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function SourceTableGroup({
  sourceTable, entries, decisions, onSetDecision,
}: {
  sourceTable: string;
  entries: { fk: SchemaDetectedFk; idx: number }[];
  decisions: FKDecision[];
  onSetDecision: (idx: number, val: FKDecision) => void;
}) {
  const [open, setOpen] = useState(true);
  const approvedCount = entries.filter((e) => decisions[e.idx] === "approve").length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-800 text-sm font-mono">{sourceTable}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            {entries.length} FK{entries.length > 1 ? "s" : ""}
          </span>
          {approvedCount === entries.length && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">All approved</span>
          )}
        </div>
        {open ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {entries.map(({ fk, idx }) => {
            const dec = decisions[idx] ?? "approve";
            const conf = fk.confidence ?? 1;
            const confPct = Math.round(conf * 100);
            const isLowConf = conf < 0.7;
            const isSelfRef = fk.source_table === fk.target_table;

            return (
              <div
                key={idx}
                className={`px-5 py-3.5 transition-colors ${dec === "approve" ? "bg-green-50/30" : "bg-red-50/30"} ${isSelfRef ? "border-l-2 border-violet-400" : ""} ${isLowConf && !isSelfRef ? "border-l-2 border-amber-400" : ""}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <code className="text-xs font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                        {fk.source_column}
                      </code>
                      <ArrowRight size={12} className="text-slate-400 shrink-0" />
                      <span className="font-mono text-xs font-semibold text-indigo-700">{fk.target_table}</span>
                      {fk.target_column && (
                        <code className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">.{fk.target_column}</code>
                      )}
                      {fk.relationship_type && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 uppercase font-mono">
                          {fk.relationship_type}
                        </span>
                      )}
                      <span className={`text-xs font-mono ${confPct >= 90 ? "text-green-600" : confPct >= 70 ? "text-amber-600" : "text-red-500"}`}>
                        {confPct}%
                      </span>
                    </div>
                    {fk.reasoning && <p className="text-xs text-slate-400 mb-1">{fk.reasoning}</p>}
                    {isSelfRef && (
                      <div className="flex items-center gap-1.5 text-xs text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg mb-1 w-fit">
                        <RotateCcw size={11} />Self-referential — parent/child within same table
                      </div>
                    )}
                    {isLowConf && !isSelfRef && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg mb-1 w-fit">
                        <AlertTriangle size={11} />Low confidence — review carefully
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <ActionBtn label="Approve" icon={<CheckCircle size={11} />} active={dec === "approve"} activeColor="bg-green-600" onClick={() => onSetDecision(idx, "approve")} />
                    <ActionBtn label="Reject"  icon={<XCircle size={11} />}     active={dec === "reject"}  activeColor="bg-red-600"   onClick={() => onSetDecision(idx, "reject")} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
