"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader, XCircle, RotateCcw } from "lucide-react";
import {
  useSchemaMappingAdvance,
  type SchemaMappingStatusResponse,
  SchemaPreSemanticGatePayload,
  SchemaFieldMappingGatePayload,
  SchemaHierarchyGatePayload,
  SchemaGateArtifactsPayload,
} from "../../chat-api";
import type { SchemaReviewFocus } from "./review-focus";
import SchemaResultsPanel from "./schema-results-panel";
import SchemaStepPause from "./schema-step-pause";
import { scrollElementStartIntoScrollParent } from "../pipeline-scroll";
import FiixIngestionPanel from "./fiix-ingestion-panel";
import type { FiixIngestionStatusResponse } from "../../chat-api";
import SchemaGatePreSemantic from "./gates/schema-gate-pre-semantic";
import SchemaGateFieldMapping from "./gates/schema-gate-field-mapping";
import SchemaGateHierarchy from "./gates/schema-gate-hierarchy";
import SchemaGateArtifacts from "./gates/schema-gate-artifacts";
import { SchemaPipelineHistory } from "./schema-pipeline-history";
import SchemaComparisonBanner, { resolveSchemaComparison } from "./schema-comparison-banner";
import {
  getSemanticPausePayload,
  isNodeSemanticMappingComplete,
  isSchemaEffectivelyComplete,
  isSemanticMappingStepKey,
  isSchemaStepPauseBlockingFieldMapping,
  requiresFieldMappingLatch,
  requiresSemanticMappingLatch,
  shouldOrchestratorAutoAdvanceSchemaStep,
} from "./schema-gate-state";
import { normalizeStepKeyForHistory } from "./schema-snapshot-utils";
import {
  buildSchemaFieldMappingPayloadFromSession,
  countSchemaFieldMappingReviewItems,
} from "./schema-gate-state";

interface Props {
  session: SchemaMappingStatusResponse | null | undefined;
  sessionId: string;
  onRefresh: () => void;
  onReset: () => void;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
  ingestion?: FiixIngestionStatusResponse | null;
  ingestionLoading?: boolean;
  onStartIngestion?: () => void;
  showCompletedHistory?: boolean;
  onFieldFocus?: (terms: string[]) => void;
  /** Orchestrator right rail — compact layout matching Migration ingest. */
  embeddedRail?: boolean;
  /** Auto-call /advance on non-HITL step_paused (mirrors migration rail). */
  drivePipelineSteps?: boolean;
}

type SchemaGateType = "pre_semantic" | "field_mapping" | "hierarchy" | "artifacts_review";

const SCHEMA_NODE_META: Record<
  number,
  { title: string; stepKey?: string; gateType?: SchemaGateType }
> = {
  0: { title: "Canonical Schema", stepKey: "step_0_canonical" },
  1: { title: "Schema Ingestion", stepKey: "step_1_ingest" },
  2: { title: "Deterministic Mapping", stepKey: "step_2_deterministic" },
  3: { title: "Pre-Semantic Review", gateType: "pre_semantic" },
  4: { title: "Semantic Mapping", stepKey: "step_3_semantic" },
  5: { title: "Field Mapping Review", gateType: "field_mapping" },
  6: { title: "Hierarchy Detection", stepKey: "step_5_hierarchy" },
  7: { title: "Hierarchy Verification", gateType: "hierarchy" },
  8: { title: "Output Generation", stepKey: "step_7_output" },
  9: { title: "Artifacts Review", gateType: "artifacts_review" },
  10: { title: "Write to Database", stepKey: "step_8_write" },
};

const NODE_TITLES = Object.fromEntries(
  Object.entries(SCHEMA_NODE_META).map(([id, m]) => [Number(id), m.title]),
) as Record<number, string>;

const STEP_KEY_TITLES = Object.fromEntries(
  Object.values(SCHEMA_NODE_META)
    .filter((m) => m.stepKey)
    .map((m) => [m.stepKey!, m.title]),
) as Record<string, string>;

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

function SchemaFlowLayout({
  activeKey,
  history,
  children,
  embeddedRail = false,
}: {
  activeKey: string;
  history: ReactNode | null;
  children: ReactNode;
  embeddedRail?: boolean;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  const lastScrollKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeKey || lastScrollKeyRef.current === activeKey) return;
    lastScrollKeyRef.current = activeKey;
    const t = window.setTimeout(() => {
      requestAnimationFrame(() => {
        if (activeRef.current) scrollElementStartIntoScrollParent(activeRef.current);
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [activeKey]);

  return (
    <div className={embeddedRail ? "w-full min-w-0" : "w-full max-w-6xl"}>
      {history}
      <div ref={activeRef} id="schema-active-step" className="scroll-mt-6">
        {children}
      </div>
    </div>
  );
}

export default function SchemaContent({
  session,
  sessionId,
  onRefresh,
  onReset,
  reviewFocus,
  onReviewFocusChange,
  ingestion,
  ingestionLoading,
  onStartIngestion,
  showCompletedHistory = true,
  onFieldFocus,
  embeddedRail = false,
  drivePipelineSteps = false,
}: Props) {
  const [semanticMappingDismissed, setSemanticMappingDismissed] = useState(false);
  const [fieldMappingGateDismissed, setFieldMappingGateDismissed] = useState(false);
  const [autoAdvanceError, setAutoAdvanceError] = useState<string | null>(null);
  const lastAutoAdvanceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setSemanticMappingDismissed(false);
    setFieldMappingGateDismissed(false);
    lastAutoAdvanceKeyRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!session || semanticMappingDismissed) return;
    if (isNodeSemanticMappingComplete(session)) setSemanticMappingDismissed(true);
  }, [session, semanticMappingDismissed]);

  const pendingGateTypeRaw =
    typeof session?.pending_gate_type === "string" ? session.pending_gate_type : null;
  const statusRaw = session?.status ?? null;
  const normalizedPausedStepKey = pendingGateTypeRaw
    ? normalizeStepKeyForHistory(pendingGateTypeRaw)
    : null;
  const shouldAutoAdvanceNode2 =
    statusRaw === "step_paused" && normalizedPausedStepKey === "step_2_deterministic";
  const shouldAutoAdvanceHierarchyDetection =
    statusRaw === "step_paused" &&
    (normalizedPausedStepKey === "step_5_hierarchy" ||
      normalizedPausedStepKey === "step_6_hierarchy");

  const shouldOrchestratorAutoAdvanceStepPause =
    drivePipelineSteps &&
    statusRaw === "step_paused" &&
    !!pendingGateTypeRaw &&
    !isSchemaStepPauseBlockingFieldMapping(session, semanticMappingDismissed) &&
    shouldOrchestratorAutoAdvanceSchemaStep(pendingGateTypeRaw, semanticMappingDismissed) &&
    !shouldAutoAdvanceNode2 &&
    !shouldAutoAdvanceHierarchyDetection;

  const { mutate: autoAdvanceSchema, isPending: isAutoAdvancing } = useSchemaMappingAdvance({
    onSuccess: () => {
      setAutoAdvanceError(null);
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to continue pipeline";
      setAutoAdvanceError(msg);
    },
  });

  useEffect(() => {
    if (!shouldAutoAdvanceNode2 && !shouldAutoAdvanceHierarchyDetection && !shouldOrchestratorAutoAdvanceStepPause) {
      return;
    }
    const dedupeKey = `${sessionId}:${pendingGateTypeRaw ?? ""}:${statusRaw ?? ""}`;
    if (lastAutoAdvanceKeyRef.current === dedupeKey) return;
    lastAutoAdvanceKeyRef.current = dedupeKey;
    setAutoAdvanceError(null);
    autoAdvanceSchema({ schemaMappingId: sessionId });
  }, [
    shouldAutoAdvanceNode2,
    shouldAutoAdvanceHierarchyDetection,
    shouldOrchestratorAutoAdvanceStepPause,
    sessionId,
    pendingGateTypeRaw,
    statusRaw,
    autoAdvanceSchema,
  ]);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader size={20} className="animate-spin" />
          <span className="text-sm">Loading schema mapping status…</span>
        </div>
      </div>
    );
  }

  const status = String(session.status ?? "").toLowerCase();
  const { pending_gate_type, pending_gate_payload } = session;
  const normalizedGateType = normalizeSchemaGateType(pending_gate_type ?? null);
  const activeScrollKey = `${status}:${pending_gate_type ?? ""}:${normalizedGateType ?? ""}`;

  const handleGateSubmitted = () => {
    if (normalizedGateType === "field_mapping") setFieldMappingGateDismissed(true);
    if (normalizedGateType === "pre_semantic") setSemanticMappingDismissed(false);
    onRefresh();
  };

  const handleSemanticContinued = () => {
    setSemanticMappingDismissed(true);
    onRefresh();
  };

  const semanticLatchActive = requiresSemanticMappingLatch(session, semanticMappingDismissed);
  const fieldMappingLatchActive = requiresFieldMappingLatch(
    session,
    fieldMappingGateDismissed,
    semanticMappingDismissed,
  );

  const historyPanel = showCompletedHistory ? (
    <SchemaPipelineHistory
      session={session}
      sessionId={sessionId}
      reviewFocus={reviewFocus}
      onReviewFocusChange={onReviewFocusChange}
    />
  ) : null;

  const comparisonBanner =
    resolveSchemaComparison(session) != null ? (
      <SchemaComparisonBanner session={session} className="mb-4" />
    ) : null;

  const wrapActive = (panel: ReactNode) => (
    <SchemaFlowLayout activeKey={activeScrollKey} history={historyPanel} embeddedRail={embeddedRail}>
      {comparisonBanner}
      {autoAdvanceError ? (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {autoAdvanceError}
        </div>
      ) : null}
      {panel}
    </SchemaFlowLayout>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (status === "error" || status === "ddl_failed") {
    return wrapActive(
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <XCircle size={20} className="text-red-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Schema mapping {status === "ddl_failed" ? "DDL error" : "failed"}
            </h2>
            {session.error_message && (
              <pre className="text-sm text-red-700 bg-red-50 rounded-lg p-4 mt-2 overflow-auto whitespace-pre-wrap">
                {session.error_message}
              </pre>
            )}
            <button
              onClick={onReset}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              <RotateCcw size={14} />
              New schema mapping
            </button>
          </div>
        </div>
      </div>,
    );
  }

  // ── Complete ───────────────────────────────────────────────────────────────
  // Treat the session as complete when the backend says so OR when the terminal
  // node has finished and the artifacts are written (the backend sometimes
  // leaves the overall status as "running" with current_node stuck on a gate
  // even after Output Generation + Write to Database have completed).
  if (status === "complete" || isSchemaEffectivelyComplete(session)) {
    const ingestionActive = !!ingestion;
    const ingestionRunning =
      ingestionActive && ingestion!.status !== "complete" && ingestion!.status !== "failed";

    return (
      <div className={embeddedRail ? "w-full min-w-0 space-y-6" : "max-w-4xl space-y-6"}>
        {historyPanel}
        <SchemaComparisonBanner session={session} />
        <SchemaResultsPanel
          session={session}
          onReset={onReset}
          onStartIngestion={onStartIngestion}
          ingestionRunning={ingestionRunning || ingestionLoading}
        />
        {ingestionActive && (
          <FiixIngestionPanel ingestion={ingestion} isLoading={ingestionLoading && !ingestion} />
        )}
      </div>
    );
  }

  // ── 1. Semantic Mapping (node 4) — editable table/column review (Feature 4) ─
  if (semanticLatchActive) {
    const semanticStepKey =
      status === "step_paused" &&
      typeof pending_gate_type === "string" &&
      isSemanticMappingStepKey(pending_gate_type)
        ? normalizeStepKeyForHistory(pending_gate_type)
        : "step_3_semantic";
    const pausePayload = getSemanticPausePayload(session);
    const fieldMappingPayload = buildSchemaFieldMappingPayloadFromSession(session);
    const reviewCount = fieldMappingPayload ? countSchemaFieldMappingReviewItems(fieldMappingPayload) : 0;
    if (fieldMappingPayload && reviewCount > 0) {
      return wrapActive(
        <SchemaGateFieldMapping
          sessionId={sessionId}
          payload={fieldMappingPayload}
          onSubmitted={() => {
            setSemanticMappingDismissed(true);
            handleGateSubmitted();
          }}
          reviewFocus={reviewFocus}
          onReviewFocusChange={onReviewFocusChange}
        />,
      );
    }
    return wrapActive(
      <SchemaStepPause
        sessionId={sessionId}
        stepKey={semanticStepKey}
        payload={pausePayload}
        onAdvanced={handleSemanticContinued}
        reviewFocus={reviewFocus}
        onReviewFocusChange={onReviewFocusChange}
        embeddedRail={embeddedRail}
        onFieldFocus={onFieldFocus}
      />,
    );
  }

  // ── 2. Pre-Semantic Review gate (node 3) ───────────────────────────────────
  if (pending_gate_payload && normalizedGateType === "pre_semantic") {
    return wrapActive(
      <SchemaGatePreSemantic
        sessionId={sessionId}
        payload={pending_gate_payload as SchemaPreSemanticGatePayload}
        onSubmitted={handleGateSubmitted}
        reviewFocus={reviewFocus}
        onReviewFocusChange={onReviewFocusChange}
      />,
    );
  }

  // ── 3. Step pause — user reviews output, then Continue → /advance ─────────
  if (
    isSchemaStepPauseBlockingFieldMapping(session, semanticMappingDismissed) &&
    typeof pending_gate_type === "string" &&
    pending_gate_payload
  ) {
    const stepKey = normalizeStepKeyForHistory(pending_gate_type);
    return wrapActive(
      <SchemaStepPause
        sessionId={sessionId}
        stepKey={stepKey}
        payload={(pending_gate_payload ?? {}) as Record<string, unknown>}
        onAdvanced={
          isSemanticMappingStepKey(pending_gate_type) ? handleSemanticContinued : onRefresh
        }
        reviewFocus={reviewFocus}
        onReviewFocusChange={onReviewFocusChange}
        embeddedRail={embeddedRail}
        onFieldFocus={onFieldFocus}
      />,
    );
  }

  // ── 4. HITL gates (strict pipeline order after semantic) ───────────────────
  if (
    pending_gate_payload &&
    normalizedGateType === "field_mapping" &&
    (fieldMappingLatchActive || status === "awaiting_review")
  ) {
    return wrapActive(
      <SchemaGateFieldMapping
        sessionId={sessionId}
        payload={pending_gate_payload as SchemaFieldMappingGatePayload}
        onSubmitted={handleGateSubmitted}
        reviewFocus={reviewFocus}
        onReviewFocusChange={onReviewFocusChange}
      />,
    );
  }

  if (pending_gate_payload && normalizedGateType === "hierarchy") {
    return wrapActive(
      <SchemaGateHierarchy
        sessionId={sessionId}
        payload={pending_gate_payload as SchemaHierarchyGatePayload}
        onSubmitted={handleGateSubmitted}
      />,
    );
  }

  if (pending_gate_payload && normalizedGateType === "artifacts_review") {
    return wrapActive(
      <SchemaGateArtifacts
        sessionId={sessionId}
        payload={pending_gate_payload as SchemaGateArtifactsPayload}
        onSubmitted={handleGateSubmitted}
        artifactUrlFallbacks={{
          output_json_url: session?.output_json_url,
          output_csv_url: session?.output_csv_url,
          output_sql_url: session?.output_sql_url,
        }}
      />,
    );
  }

  // ── 5. Gate payload loading (awaiting_review before UI is ready) ───────────
  if (status === "awaiting_review" && pending_gate_type) {
    return wrapActive(
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-800 mb-2">
          Waiting for review:{" "}
          <code className="font-mono text-indigo-600">{pending_gate_type}</code>
        </h2>
        <p className="text-sm text-slate-500">Loading review UI…</p>
        <Loader size={18} className="animate-spin text-indigo-500 mt-4" />
      </div>,
    );
  }

  // ── 6. Running — poll until next step_paused or gate ───────────────────────
  const displayCurrentNode = (() => {
    if ((session.current_node ?? 0) > 0) return session.current_node ?? 0;
    const runningNode = (session.nodes ?? []).find((n) =>
      String(n.status ?? "").toLowerCase().includes("running"),
    );
    if (runningNode) return runningNode.node_id;
    const lastWithLogs = [...(session.nodes ?? [])].reverse().find((n) => (n.logs?.length ?? 0) > 0);
    if (lastWithLogs) return lastWithLogs.node_id;
    return session.current_node ?? 0;
  })();

  const pendingStepKey =
    typeof pending_gate_type === "string" && pending_gate_type.startsWith("step_")
      ? normalizeStepKeyForHistory(pending_gate_type)
      : null;
  const runningLabel =
    pendingStepKey && STEP_KEY_TITLES[pendingStepKey]
      ? `Finishing ${STEP_KEY_TITLES[pendingStepKey]}…`
      : NODE_TITLES[displayCurrentNode] ??
        `Node ${displayCurrentNode} · ${Math.round(session.progress_pct ?? 0)}% complete`;

  return wrapActive(
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col items-center text-center gap-4 ${
        embeddedRail ? "p-5" : "p-8"
      }`}
    >
      <div
        className={`rounded-2xl bg-emerald-50 flex items-center justify-center ${
          embeddedRail ? "w-11 h-11" : "w-14 h-14"
        }`}
      >
        <Loader
          size={embeddedRail ? 22 : 28}
          className={`text-emerald-600 animate-spin ${isAutoAdvancing ? "" : ""}`}
        />
      </div>
      <div>
        <h2 className={`font-semibold text-slate-800 ${embeddedRail ? "text-sm" : "text-lg"}`}>
          {isAutoAdvancing ? "Advancing pipeline…" : "Schema mapping running…"}
        </h2>
        <p className={`text-slate-500 mt-1 ${embeddedRail ? "text-xs" : "text-sm"}`}>{runningLabel}</p>
      </div>
      <div className="w-full max-w-sm h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${session.progress_pct ?? 0}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">
        Ingest tables and gates appear here when the pipeline pauses — same as Migration ingest.
      </p>
    </div>,
  );
}
