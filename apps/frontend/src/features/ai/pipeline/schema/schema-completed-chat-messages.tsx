"use client";

import type { ReactNode } from "react";
import type { SchemaReviewFocus } from "./review-focus";
import SchemaStepPause from "./schema-step-pause";
import {
  SCHEMA_GATE_LABELS,
  type SchemaGateSnapshot,
  type SchemaNodeSnapshot,
} from "./schema-snapshot-utils";
import SchemaGatePreSemantic from "./gates/schema-gate-pre-semantic";
import SchemaGateFieldMapping from "./gates/schema-gate-field-mapping";
import SchemaGateHierarchy from "./gates/schema-gate-hierarchy";
import SchemaGateArtifacts from "./gates/schema-gate-artifacts";
import type {
  SchemaFieldMappingGatePayload,
  SchemaGateArtifactsPayload,
  SchemaHierarchyGatePayload,
  SchemaPreSemanticGatePayload,
} from "../../chat-api";

export function SchemaCompletedNodeMessage({
  snapshot,
  sessionId,
  reviewFocus,
  onReviewFocusChange,
}: {
  snapshot: SchemaNodeSnapshot;
  sessionId: string;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
}) {
  return (
    <div id={`center-node-schema-${snapshot.nodeId}`}>
      <SchemaStepPause
        sessionId={sessionId}
        stepKey={snapshot.stepKey}
        payload={snapshot.payload}
        onAdvanced={() => {}}
        reviewFocus={reviewFocus}
        onReviewFocusChange={onReviewFocusChange}
        readOnly
        completedLabel={snapshot.nodeName ?? undefined}
      />
    </div>
  );
}

export function SchemaCompletedGateMessage({
  snapshot,
  sessionId,
  reviewFocus,
  onReviewFocusChange,
  artifactUrlFallbacks,
}: {
  snapshot: SchemaGateSnapshot;
  sessionId: string;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
  artifactUrlFallbacks?: {
    output_json_url?: string | null;
    output_csv_url?: string | null;
    output_sql_url?: string | null;
  };
}) {
  const noop = () => {};

  let panel: ReactNode = null;
  switch (snapshot.gateType) {
    case "pre_semantic":
      panel = (
        <SchemaGatePreSemantic
          sessionId={sessionId}
          payload={snapshot.payload as SchemaPreSemanticGatePayload}
          onSubmitted={noop}
          reviewFocus={reviewFocus}
          onReviewFocusChange={onReviewFocusChange}
          readOnly
        />
      );
      break;
    case "field_mapping":
      panel = (
        <SchemaGateFieldMapping
          sessionId={sessionId}
          payload={snapshot.payload as SchemaFieldMappingGatePayload}
          onSubmitted={noop}
          reviewFocus={reviewFocus}
          onReviewFocusChange={onReviewFocusChange}
          readOnly
        />
      );
      break;
    case "hierarchy":
      panel = (
        <SchemaGateHierarchy
          sessionId={sessionId}
          payload={snapshot.payload as SchemaHierarchyGatePayload}
          onSubmitted={noop}
          readOnly
        />
      );
      break;
    case "artifacts_review":
      panel = (
        <SchemaGateArtifacts
          sessionId={sessionId}
          payload={snapshot.payload as SchemaGateArtifactsPayload}
          onSubmitted={noop}
          readOnly
          artifactUrlFallbacks={artifactUrlFallbacks}
        />
      );
      break;
  }

  return (
    <div id={`center-gate-schema-${snapshot.gateType}`} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {SCHEMA_GATE_LABELS[snapshot.gateType] ?? snapshot.gateType} — Complete
          </h2>
          <p className="text-sm text-slate-500">Review your submitted decisions below.</p>
        </div>
      </div>
      {panel}
    </div>
  );
}
