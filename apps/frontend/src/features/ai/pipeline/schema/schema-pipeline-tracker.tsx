"use client";
import { useMemo, useState } from "react";
import {
  CheckCircle, Circle, AlertCircle, GitMerge, Loader,
  ChevronDown, ChevronRight,
} from "lucide-react";
import type { SchemaMappingStatusResponse } from "../../chat-api";
import { resolveSchemaMappingStats } from "./schema-mapping-stats";
import {
  isNodeSemanticMappingComplete,
  isSemanticMappingStepKey,
} from "./schema-gate-state";

interface Step {
  label: string;
  sublabel: string;
  isGate: boolean;
  gateKey?: string;
  stepKey?: string;
  nodeNum?: number;
  logNodeId?: number;
}

// STEPS kept for state computation only — not rendered directly
const STEPS: Step[] = [
  { label: "Canonical Schema",       sublabel: "Node 0", isGate: false, nodeNum: 0,  stepKey: "step_0_canonical",     logNodeId: 0  },
  { label: "Schema Ingestion",       sublabel: "Node 1", isGate: false, nodeNum: 1,  stepKey: "step_1_ingest",        logNodeId: 1  },
  { label: "Deterministic Mapping",  sublabel: "Node 2", isGate: false, nodeNum: 2,  stepKey: "step_2_deterministic", logNodeId: 2  },
  { label: "Pre-Semantic Review",    sublabel: "Gate 0", isGate: true,  gateKey: "pre_semantic",                      logNodeId: 3  },
  { label: "Semantic Mapping",       sublabel: "Node 3", isGate: false, nodeNum: 3,  stepKey: "step_3_semantic",      logNodeId: 4  },
  { label: "Field Mapping Review",   sublabel: "Gate 1", isGate: true,  gateKey: "field_mapping",                     logNodeId: 5  },
  { label: "Hierarchy Detection",    sublabel: "Node 5", isGate: false, nodeNum: 5,  stepKey: "step_5_hierarchy",     logNodeId: 6  },
  { label: "Hierarchy Verification", sublabel: "Gate 2", isGate: true,  gateKey: "hierarchy",                         logNodeId: 7  },
  { label: "Output Generation",      sublabel: "Node 7", isGate: false, nodeNum: 7,  stepKey: "step_7_output",        logNodeId: 8  },
  { label: "Artifacts Review",       sublabel: "Gate 4", isGate: true,  gateKey: "artifacts_review",                  logNodeId: 9  },
  { label: "Write to Database",      sublabel: "Node 10",isGate: false, nodeNum: 10,                                  logNodeId: 10 },
];

type StepState = "waiting" | "running" | "paused" | "active" | "complete" | "error";

function normalizeSchemaGateType(v: string | null | undefined) {
  if (!v) return null;
  if (v === "pre_semantic" || v === "field_mapping" || v === "hierarchy" || v === "artifacts_review") return v;
  const s = v.toLowerCase();
  if (s.includes("pre") && s.includes("semantic")) return "pre_semantic";
  if (s.includes("human") && s.includes("review")) return "field_mapping";
  if (s.includes("field") && s.includes("map")) return "field_mapping";
  if (s.includes("verify") && s.includes("hier")) return "hierarchy";
  if (s.includes("hier")) return "hierarchy";
  if (s.includes("artifact")) return "artifacts_review";
  return v;
}

function getStepState(step: Step, session: SchemaMappingStatusResponse): StepState {
  const { status, current_node, pending_gate_type, pending_gate_payload } = session;
  const normalizedGateType = normalizeSchemaGateType(pending_gate_type);
  const semanticDone = isNodeSemanticMappingComplete(session);

  if (status === "error" || status === "ddl_failed") return "error";
  if (status === "complete") return "complete";

  const pendingIsFieldMapping =
    normalizedGateType === "field_mapping" && !!pending_gate_payload && !semanticDone;

  if (
    pending_gate_payload &&
    normalizedGateType &&
    step.isGate &&
    step.gateKey === normalizedGateType &&
    !pendingIsFieldMapping
  ) {
    return "active";
  }

  if (
    status === "step_paused" &&
    step.stepKey &&
    (step.stepKey === pending_gate_type ||
      (isSemanticMappingStepKey(pending_gate_type) && isSemanticMappingStepKey(step.stepKey)))
  ) {
    return "paused";
  }

  const node = current_node ?? 0;

  if (!semanticDone && step.stepKey && isSemanticMappingStepKey(step.stepKey) && node >= 4) {
    if (status === "running" || status === "awaiting_review" || status === "step_paused") {
      return "paused";
    }
  }

  if (step.isGate) {
    const gatePassedNode: Record<string, number> = {
      pre_semantic: 3,
      field_mapping: 5,
      hierarchy: 7,
      artifacts_review: 9,
    };
    const passedAt = gatePassedNode[step.gateKey ?? ""] ?? 999;
    if (node > passedAt) return "complete";
    return "waiting";
  }

  const n = step.nodeNum ?? 999;
  if (node > n) return "complete";
  if (node === n && status === "running") return "running";
  return "waiting";
}

// ── Phase definitions ──────────────────────────────────────────────────────────

type PhaseState = "waiting" | "running" | "gate" | "complete" | "error";

interface Phase {
  id: string;
  label: string;
  sublabel: string;
  stepIndices: number[];
  isHitlGate: boolean;
}

const PHASES: Phase[] = [
  { id: "ingestion",    label: "Ingestion",           sublabel: "Canonical schema & source parsing",    stepIndices: [0, 1],    isHitlGate: false },
  { id: "mapping",      label: "Field Mapping",        sublabel: "Deterministic & semantic analysis",    stepIndices: [2, 3, 4], isHitlGate: false },
  { id: "field-review", label: "Field Review",         sublabel: "Review low-confidence mappings",       stepIndices: [5],       isHitlGate: true  },
  { id: "hierarchy",    label: "Hierarchy Analysis",   sublabel: "FK detection & verification",          stepIndices: [6, 7],    isHitlGate: false },
  { id: "output",       label: "Output Generation",    sublabel: "Schema artifacts & export",            stepIndices: [8],       isHitlGate: false },
  { id: "artifacts",    label: "Artifacts Review",     sublabel: "Review artifacts & confirm schema",    stepIndices: [9],       isHitlGate: true  },
  { id: "write",        label: "Write to Database",    sublabel: "Create schema & write records",        stepIndices: [10],      isHitlGate: false },
];

function getPhaseState(phase: Phase, session: SchemaMappingStatusResponse): PhaseState {
  if (session.status === "error" || session.status === "ddl_failed") return "error";
  const stepStates = phase.stepIndices.map((i) => getStepState(STEPS[i], session));
  if (stepStates.every((s) => s === "complete")) return "complete";
  if (stepStates.some((s) => s === "active")) return "gate";
  if (stepStates.some((s) => s === "running" || s === "paused")) return "running";
  return "waiting";
}

function PhaseIcon({ state, isHitlGate }: { state: PhaseState; isHitlGate: boolean }) {
  if (state === "complete") return <CheckCircle size={18} className="text-green-500" />;
  if (state === "error")    return <AlertCircle size={18} className="text-red-500" />;
  if (state === "running")  return <Loader size={18} className="text-indigo-500 animate-spin" />;
  if (state === "gate")     return isHitlGate
    ? <GitMerge size={18} className="text-amber-500" />
    : <GitMerge size={18} className="text-blue-500" />;
  return <Circle size={18} className="text-slate-300" />;
}

interface Props {
  session: SchemaMappingStatusResponse;
}

export default function SchemaPipelineTracker({ session }: Props) {
  const progressPct = Math.round(session.progress_pct ?? 0);
  const stats = useMemo(() => resolveSchemaMappingStats(session), [session]);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  function togglePhaseLogs(phaseId: string) {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Schema Mapper</p>
        <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">
          {session.external_cmms_name ?? "—"}
        </p>
      </div>

      <div className="mb-5">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Progress</span><span>{progressPct}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Phase timeline */}
      <ol className="relative space-y-1">
        {PHASES.map((phase, i) => {
          const state = getPhaseState(phase, session);

          // Collect logs from steps in this phase
          const phaseLogNodes = phase.stepIndices
            .map((idx) => STEPS[idx])
            .filter((step) => step.logNodeId !== undefined)
            .map((step) => ({
              label: step.label,
              nodeInfo: session.nodes?.find((n) => n.node_id === step.logNodeId),
            }))
            .filter(({ nodeInfo }) => nodeInfo && nodeInfo.logs && nodeInfo.logs.length > 0);

          const totalLogs = phaseLogNodes.reduce((sum, { nodeInfo }) => sum + (nodeInfo?.logs.length ?? 0), 0);
          const hasLogs = totalLogs > 0;
          const logsOpen = expandedPhases.has(phase.id);

          return (
            <li key={phase.id} className="relative">
              {i < PHASES.length - 1 && (
                <div className="absolute left-[17px] top-9 bottom-0 w-px bg-slate-200 z-0" />
              )}
              <div className={`relative z-10 flex gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                state === "gate"    ? "bg-amber-50 border border-amber-200" :
                state === "running" ? "bg-indigo-50 border border-indigo-200" :
                ""
              }`}>
                <div className="shrink-0 mt-0.5">
                  <PhaseIcon state={state} isHitlGate={phase.isHitlGate} />
                </div>
                <div className={`flex-1 min-w-0 ${state === "waiting" ? "opacity-40" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-xs font-semibold leading-tight ${
                      state === "gate"     ? "text-amber-800" :
                      state === "running"  ? "text-indigo-800" :
                      state === "complete" ? "text-slate-700" :
                      state === "error"    ? "text-red-700" :
                      "text-slate-500"
                    }`}>{phase.label}</p>
                    {state === "gate" && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        Review required
                      </span>
                    )}
                    {state === "running" && (
                      <span className="text-xs text-indigo-500 font-medium">Processing…</span>
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 ${
                    state === "gate"    ? "text-amber-600" :
                    state === "running" ? "text-indigo-500" :
                    "text-slate-400"
                  }`}>{phase.sublabel}</p>
                </div>

                {/* Log toggle */}
                {hasLogs && (
                  <button
                    onClick={() => togglePhaseLogs(phase.id)}
                    className="shrink-0 flex items-center gap-0.5 text-slate-400 hover:text-slate-600 transition-colors mt-0.5"
                    title={logsOpen ? "Hide logs" : `${totalLogs} log line${totalLogs === 1 ? "" : "s"}`}
                  >
                    {logsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="text-xs font-mono">{totalLogs}</span>
                  </button>
                )}
              </div>

              {/* Expanded logs */}
              {hasLogs && logsOpen && (
                <div className="mx-3 mb-1 rounded-md bg-slate-900 px-2.5 py-2 overflow-x-auto">
                  {phaseLogNodes.map(({ label, nodeInfo }) =>
                    nodeInfo && nodeInfo.logs.length > 0 ? (
                      <div key={label}>
                        {phaseLogNodes.length > 1 && (
                          <p className="text-[10px] font-mono text-slate-500 mt-1 mb-0.5 uppercase tracking-wider">
                            {label}
                          </p>
                        )}
                        {nodeInfo.logs.map((line, li) => (
                          <p key={li} className="text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap break-all">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Stats */}
      {stats && (
        <div className="mt-5 border-t border-slate-100 pt-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Stats</p>
          {([
            { label: "Tables",    value: stats.total_tables },
            { label: "Fields",    value: stats.total_fields },
            { label: "T1 mapped", value: stats.tier1_mapped },
            { label: "T2 mapped", value: stats.tier2_auto_mapped },
            { label: "Flagged",   value: stats.tier2_flagged },
            { label: "Unmapped",  value: stats.unmapped },
            { label: "FKs",       value: stats.detected_fk_count },
          ] as const).map(({ label, value }) =>
            value != null ? (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-slate-500">{label}</span>
                <span className="font-mono font-semibold text-slate-700">{value}</span>
              </div>
            ) : null
          )}
          {stats.mapping_coverage_pct != null && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Coverage</span>
              <span className="font-mono font-semibold text-slate-700">
                {Math.round(stats.mapping_coverage_pct)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
