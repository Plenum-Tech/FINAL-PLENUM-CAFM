"use client";

import { useQuery } from "@tanstack/react-query";

import { DeepAgentsApiError, deepAgentsApi } from "@/features/ai/deep-agents-api";
import { cn } from "@/utils/cn";

function StatusPill({
  label,
  ok,
  pending,
  active,
  onClick,
}: {
  label: string;
  ok: boolean;
  pending?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors",
    ok && "bg-emerald-50 text-emerald-800 border-emerald-200",
    pending && !ok && "bg-amber-50 text-amber-900 border-amber-200",
    !ok && !pending && "bg-slate-50 text-slate-600 border-slate-200",
    active && "ring-2 ring-indigo-400 ring-offset-1",
    onClick && "cursor-pointer hover:opacity-90",
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {label}
      </button>
    );
  }
  return <span className={className}>{label}</span>;
}

export function DeepAgentWorkspaceStatus({
  sessionId,
  migrationIds,
  enabled,
  schemaPanelActive,
  onOpenSchemaPanel,
}: {
  sessionId: string;
  migrationIds?: string[];
  enabled: boolean;
  schemaPanelActive?: boolean;
  onOpenSchemaPanel?: () => void;
}) {
  const migrationKey = (migrationIds ?? []).join(",");
  const { data } = useQuery({
    queryKey: ["deep-agent-workspace", sessionId, migrationKey],
    queryFn: async () => {
      try {
        return await deepAgentsApi.getWorkspaceStatus(sessionId, migrationIds);
      } catch (err) {
        if (err instanceof DeepAgentsApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: enabled && !!sessionId,
    refetchInterval: (query) => (query.state.data ? 3000 : false),
    retry: false,
  });

  if (!data) return null;

  const hasSchemaJob = Boolean(
    data.active_schema_mapping_id?.trim() || (data.schema_mapping_ids?.length ?? 0) > 0,
  );

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Pipeline</span>
      <StatusPill label="Ingestion" ok={data.ingestion_complete} pending={!data.ingestion_complete} />
      <StatusPill label="Mapping" ok={data.mapping_status === "complete"} pending={data.mapping_pending} />
      <StatusPill label="Hierarchy" ok={data.hierarchy_status === "complete"} pending={data.hierarchy_pending} />
      {hasSchemaJob && onOpenSchemaPanel ? (
        <StatusPill
          label="Schema mapper"
          ok={false}
          pending={data.pending_schema_gate_confirm ?? true}
          active={schemaPanelActive}
          onClick={onOpenSchemaPanel}
        />
      ) : null}
      {data.wo_candidate_detected ? <StatusPill label="WO candidate" ok={false} pending /> : null}
      {data.active_batch_id ? (
        <span className="text-[10px] text-muted-foreground font-mono">
          batch {data.active_batch_id.slice(0, 8)}…
        </span>
      ) : null}
    </div>
  );
}
