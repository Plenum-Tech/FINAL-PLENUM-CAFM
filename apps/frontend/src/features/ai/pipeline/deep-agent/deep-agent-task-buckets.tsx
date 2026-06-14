"use client";

import { ArrowRight, BookOpen, CheckCircle2, Database, FileSpreadsheet, Layers, ListChecks, PauseCircle, PlayCircle, Sparkles, Wrench } from "lucide-react";

import { cn } from "@/utils/cn";

import type { CompletedDocumentsSnapshot } from "./deep-agent-documents-completion-card";
import type { CompletedMigrationSnapshot } from "./deep-agent-migration-completion-card";
import type { CompletedSchemaSnapshot } from "./deep-agent-schema-completion-card";
import type { CompletedWorkOrderSnapshot } from "./deep-agent-work-order-completion-card";
import type { PinnedRun } from "./deep-agent-pinned-runs";
import type { QueuedTrack } from "./use-intent-clarification";

/**
 * Surfaces the four task buckets the spec mandates the orchestrator surface:
 *   - Active   (running, awaiting input, paused)
 *   - Recommended (workflows available but not yet started)
 *   - Queued   (future actions deferred for later)
 *   - Completed (already finished, durable until the user clears them)
 *
 * The component is purely presentational — all data comes from existing
 * orchestrator state (migration/doc/schema contexts + completion snapshots +
 * intent-clarification queue). No new persistence layer is added.
 */
export type ActiveTaskKind = "migration" | "documents" | "schema" | "work_order";

export type ActiveTaskItem = {
  id: string;
  kind: ActiveTaskKind;
  title: string;
  detail?: string;
  status: "running" | "awaiting_input" | "paused";
  onOpen?: () => void;
};

export type CompletedTaskItem =
  | { kind: "migration"; snapshot: CompletedMigrationSnapshot; onOpen?: () => void }
  | { kind: "documents"; snapshot: CompletedDocumentsSnapshot }
  | { kind: "schema"; snapshot: CompletedSchemaSnapshot; onOpen?: () => void }
  | { kind: "work_order"; snapshot: CompletedWorkOrderSnapshot };

export type DeepAgentTaskBuckets = {
  active: ActiveTaskItem[];
  recommended: PinnedRun[];
  queued: QueuedTrack | null;
  completed: CompletedTaskItem[];
};

type Props = {
  buckets: DeepAgentTaskBuckets;
  onRunRecommended?: (pin: PinnedRun) => void;
  onContinueQueued?: () => void;
  onDismissQueued?: () => void;
};

function ActiveTaskRow({ item }: { item: ActiveTaskItem }) {
  const statusChip =
    item.status === "awaiting_input"
      ? { label: "Awaiting input", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
      : item.status === "paused"
        ? { label: "Paused", cls: "bg-slate-100 text-slate-700 ring-slate-200" }
        : { label: "Running", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" };
  const Icon =
    item.kind === "migration"
      ? FileSpreadsheet
      : item.kind === "documents"
        ? BookOpen
        : item.kind === "schema"
          ? Layers
          : Wrench;
  const StatusIcon = item.status === "awaiting_input" ? PauseCircle : PlayCircle;
  return (
    <div className="flex items-start gap-2.5 rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5">
      <div className="shrink-0 mt-0.5 text-slate-500">
        <Icon size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-medium text-slate-800 truncate">{item.title}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-0.5 text-[10px] font-medium",
              statusChip.cls,
            )}
          >
            <StatusIcon size={10} />
            {statusChip.label}
          </span>
        </div>
        {item.detail ? (
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{item.detail}</p>
        ) : null}
      </div>
      {item.onOpen ? (
        <button
          type="button"
          onClick={item.onOpen}
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 transition-colors"
        >
          Open
          <ArrowRight size={11} />
        </button>
      ) : null}
    </div>
  );
}

function CompletedTaskRow({ item }: { item: CompletedTaskItem }) {
  if (item.kind === "migration") {
    const { snapshot } = item;
    const title = snapshot.fileNames?.[0] ?? snapshot.cmms_name ?? "Migration";
    const detail = [
      snapshot.status,
      typeof snapshot.t1_mapped_count === "number" ? `${snapshot.t1_mapped_count} T1` : null,
      typeof snapshot.unmapped_count === "number" ? `${snapshot.unmapped_count} unmapped` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="flex items-start gap-2.5 rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5">
        <div className="shrink-0 mt-0.5 text-emerald-600">
          <CheckCircle2 size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-slate-800 truncate">{title}</div>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{detail}</p>
        </div>
        {item.onOpen ? (
          <button
            type="button"
            onClick={item.onOpen}
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-200 transition-colors"
          >
            Review
            <ArrowRight size={11} />
          </button>
        ) : null}
      </div>
    );
  }
  if (item.kind === "documents") {
    const { snapshot } = item;
    const title =
      snapshot.fileNames?.[0] ??
      (snapshot.totalDocs === 1 ? "1 document" : `${snapshot.totalDocs} documents`);
    const detail = [
      `${snapshot.indexedCount} indexed`,
      snapshot.errorCount ? `${snapshot.errorCount} errors` : null,
      snapshot.totalPages ? `${snapshot.totalPages} pages` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="flex items-start gap-2.5 rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5">
        <div className="shrink-0 mt-0.5 text-rose-600">
          <CheckCircle2 size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-slate-800 truncate">{title}</div>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{detail}</p>
        </div>
      </div>
    );
  }
  if (item.kind === "schema") {
    const { snapshot } = item;
    return (
      <div className="flex items-start gap-2.5 rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5">
        <div className="shrink-0 mt-0.5 text-emerald-600">
          <CheckCircle2 size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-slate-800 truncate">
            {snapshot.label ?? "Schema mapping"}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
            {snapshot.schemaMappingId.slice(0, 8)}
          </p>
        </div>
        {item.onOpen ? (
          <button
            type="button"
            onClick={item.onOpen}
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-200 transition-colors"
          >
            Review
            <ArrowRight size={11} />
          </button>
        ) : null}
      </div>
    );
  }
  // work_order
  const { snapshot } = item;
  return (
    <div className="flex items-start gap-2.5 rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5">
      <div className="shrink-0 mt-0.5 text-indigo-600">
        <CheckCircle2 size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-slate-800 truncate">{snapshot.title ?? "Work order"}</div>
        <p className="text-[10px] text-slate-500 mt-0.5 truncate">
          {[snapshot.workOrderId, snapshot.priority, snapshot.status].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

function BucketSection({
  title,
  count,
  children,
  emptyHint,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  emptyHint: string;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 tabular-nums">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-[11px] text-slate-400 px-3 py-2 rounded-lg bg-slate-50/50">{emptyHint}</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </section>
  );
}

export function DeepAgentTaskBucketsPanel({
  buckets,
  onRunRecommended,
  onContinueQueued,
  onDismissQueued,
}: Props) {
  const { active, recommended, queued, completed } = buckets;
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-gradient-to-b from-amber-50/30 to-white shadow-sm">
      <div className="shrink-0 flex items-center gap-2 border-b border-amber-100/70 px-4 py-2.5">
        <ListChecks size={15} className="text-amber-700" />
        <div>
          <div className="text-sm font-semibold text-slate-800">Tasks</div>
          <p className="text-[10px] text-slate-500">
            Everything in flight, recommended, queued, and recently completed.
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 max-w-3xl mx-auto w-full">
        <BucketSection
          title="Active"
          count={active.length}
          emptyHint="Nothing running. Send a message or run a pinned action to start a workflow."
        >
          {active.map((item) => (
            <ActiveTaskRow key={item.id} item={item} />
          ))}
        </BucketSection>

        <BucketSection
          title="Recommended"
          count={recommended.length}
          emptyHint="No recommendations yet. Upload files or describe what you need and the orchestrator will surface options here."
        >
          {recommended.map((pin) => (
            <button
              key={pin.id}
              type="button"
              onClick={() => onRunRecommended?.(pin)}
              className="flex w-full items-start gap-2.5 rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5 text-left hover:ring-slate-300 transition-colors"
            >
              <div className="shrink-0 mt-0.5 text-amber-600">
                <Sparkles size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-slate-800 truncate">{pin.label}</div>
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{pin.prompt}</p>
              </div>
              <ArrowRight size={12} className="shrink-0 mt-1 text-slate-400" />
            </button>
          ))}
        </BucketSection>

        <BucketSection
          title="Queued"
          count={queued ? 1 : 0}
          emptyHint="Nothing queued for later."
        >
          {queued ? (
            <div className="flex items-start gap-2.5 rounded-lg ring-1 ring-amber-200 bg-amber-50/50 px-3 py-2.5">
              <div className="shrink-0 mt-0.5 text-amber-700">
                <Database size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-slate-800 truncate">
                  Next track: {queued.intent.replace(/_/g, " ")}
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                  {queued.fileNames.length
                    ? queued.fileNames.slice(0, 3).join(", ")
                    : "Files removed — re-attach to continue"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {onContinueQueued ? (
                  <button
                    type="button"
                    onClick={onContinueQueued}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 transition-colors"
                  >
                    Continue
                    <ArrowRight size={11} />
                  </button>
                ) : null}
                {onDismissQueued ? (
                  <button
                    type="button"
                    onClick={onDismissQueued}
                    className="text-[10px] font-medium text-slate-500 hover:text-slate-700 px-2"
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </BucketSection>

        <BucketSection
          title="Completed"
          count={completed.length}
          emptyHint="No completed tasks yet for this session."
        >
          {completed.map((item, idx) => (
            <CompletedTaskRow key={`${item.kind}-${idx}`} item={item} />
          ))}
        </BucketSection>
      </div>
    </div>
  );
}
