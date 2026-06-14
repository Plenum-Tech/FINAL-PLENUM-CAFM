"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { useSchemaMappingStatus } from "@/features/ai/chat-api";
import type { SchemaReviewFocus } from "@/features/ai/pipeline/schema/review-focus";
import SchemaContent from "@/features/ai/pipeline/schema/schema-content";

export type DeepAgentSchemaContext = {
  schemaMappingIds: string[];
  labels: string[];
};

type Props = {
  context: DeepAgentSchemaContext;
  onDismiss?: () => void;
  /** Rendered inside orchestrator right rail (~420px) — same layout as Migration ingest. */
  embeddedRail?: boolean;
};

export function DeepAgentSchemaPanel({ context, onDismiss, embeddedRail = true }: Props) {
  const queryClient = useQueryClient();
  const ids = context.schemaMappingIds;
  const [selectedSessionId, setSelectedSessionId] = useState(() => ids[0] ?? "");

  useEffect(() => {
    if (!ids.length) {
      setSelectedSessionId("");
      return;
    }
    if (!ids.includes(selectedSessionId)) {
      setSelectedSessionId(ids[0] ?? "");
    }
  }, [ids, selectedSessionId]);

  const selectedIdx = ids.indexOf(selectedSessionId);
  const label =
    (selectedIdx >= 0 ? context.labels[selectedIdx] : null) ??
    selectedSessionId.slice(0, 8);
  const [reviewFocus, setReviewFocus] = useState<SchemaReviewFocus | null>(null);
  const [highlightTerms, setHighlightTerms] = useState<string[]>([]);
  const [forcePollUntil, setForcePollUntil] = useState(0);

  const { data: session, isLoading, refetch } = useSchemaMappingStatus(selectedSessionId, {
    enabled: !!selectedSessionId,
    refetchInterval: 3000,
    forceUntil: forcePollUntil,
  });

  useEffect(() => {
    if (!selectedSessionId) return;
    const st = String(session?.status ?? "").toLowerCase();
    const terminal =
      st === "complete" ||
      st === "failed" ||
      st === "ddl_failed" ||
      st === "error" ||
      st === "cancelled" ||
      st === "canceled";
    if (terminal) {
      setForcePollUntil(0);
      return;
    }
    if (st === "step_paused" || st === "awaiting_review") {
      setForcePollUntil(0);
      return;
    }
    if (
      st === "running" ||
      st === "processing" ||
      st === "ingest" ||
      st === "advancing" ||
      st === "pending" ||
      !st
    ) {
      setForcePollUntil(Date.now() + 5 * 60_000);
    }
  }, [selectedSessionId, session?.status]);

  function handleRefresh() {
    setForcePollUntil(Date.now() + 60_000);
    void refetch();
    void queryClient.invalidateQueries({
      queryKey: ["schema-mapping", "status", selectedSessionId],
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 px-3 py-2.5 bg-gradient-to-r from-emerald-50/80 to-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <FileSpreadsheet size={13} className="text-emerald-600 shrink-0" />
              Schema mapping
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{label}</p>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Same gates as standalone Schema Mapper — Fiix ingest tables, pre-semantic, field mapping,
              hierarchy, artifacts (like Migration ingest for CSV/Excel).
            </p>
            {highlightTerms.length > 0 ? (
              <p className="text-[10px] text-amber-800 mt-1 truncate">
                Focus: {highlightTerms.join(", ")}
              </p>
            ) : null}
          </div>
        </div>
        {ids.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Schema mapping runs">
            {ids.map((id, idx) => {
              const active = id === selectedSessionId;
              const tabLabel = context.labels[idx]?.trim() || `Fiix map ${idx + 1}`;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={id}
                  onClick={() => setSelectedSessionId(id)}
                  className={`max-w-[9rem] truncate rounded-md px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                    active
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                  }`}
                >
                  {tabLabel}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {ids.length > 1 ? (
          <p className="text-[10px] text-slate-500 mb-2">
            {ids.length} schema sessions — select a tab per run.
          </p>
        ) : null}
        {isLoading && !session ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-xs gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading schema mapping status…
          </div>
        ) : selectedSessionId ? (
          <SchemaContent
            session={session}
            sessionId={selectedSessionId}
            onRefresh={handleRefresh}
            onReset={onDismiss ?? handleRefresh}
            reviewFocus={reviewFocus}
            onReviewFocusChange={setReviewFocus}
            showCompletedHistory={false}
            embeddedRail={embeddedRail}
            drivePipelineSteps={embeddedRail}
            onFieldFocus={(terms) => setHighlightTerms(terms)}
          />
        ) : (
          <p className="text-xs text-muted-foreground px-2">No schema mapping session.</p>
        )}
      </div>
    </div>
  );
}
