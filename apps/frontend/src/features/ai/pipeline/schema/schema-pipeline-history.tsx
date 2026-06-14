"use client";

import type { SchemaReviewFocus } from "./review-focus";
import type { SchemaMappingStatusResponse } from "../../chat-api";
import {
  SchemaCompletedGateMessage,
  SchemaCompletedNodeMessage,
} from "./schema-completed-chat-messages";
import { useAccumulatedSchemaSnapshots } from "./schema-snapshot-utils";

export function SchemaPipelineHistory({
  session,
  sessionId,
  reviewFocus,
  onReviewFocusChange,
}: {
  session: SchemaMappingStatusResponse;
  sessionId: string;
  reviewFocus: SchemaReviewFocus | null;
  onReviewFocusChange: (focus: SchemaReviewFocus | null) => void;
}) {
  const { historyItems: items } = useAccumulatedSchemaSnapshots(session, sessionId);
  if (!items.length) return null;

  return (
    <div className="mb-8 pb-8 border-b border-slate-200 space-y-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        Completed steps — scroll up to review
      </div>
      {items.map((item) =>
        item.kind === "gate" ? (
          <SchemaCompletedGateMessage
            key={item.snapshot.id}
            snapshot={item.snapshot}
            sessionId={sessionId}
            reviewFocus={reviewFocus}
            onReviewFocusChange={onReviewFocusChange}
            artifactUrlFallbacks={{
              output_json_url: session.output_json_url,
              output_csv_url: session.output_csv_url,
              output_sql_url: session.output_sql_url,
            }}
          />
        ) : (
          <SchemaCompletedNodeMessage
            key={`node_${item.snapshot.nodeId}`}
            snapshot={item.snapshot}
            sessionId={sessionId}
            reviewFocus={reviewFocus}
            onReviewFocusChange={onReviewFocusChange}
          />
        ),
      )}
    </div>
  );
}
