"use client";

import { ArrowRight, BookOpen, Bot, CheckCircle2, FileSpreadsheet, Layers, PauseCircle, PlayCircle, Sparkles, Wrench } from "lucide-react";

import { cn } from "@/utils/cn";

import {
  deriveWorkflowQueueBuckets,
  WORKFLOW_KIND_LABEL,
  type WorkflowKind,
  type WorkflowQueueState,
  type WorkflowQueueRun,
  type WorkflowQueueUpload,
} from "./deep-agent-workflow-queue";

/**
 * Workflow-queue snapshot rendered as a conversation artifact (push-back #1
 * follow-up). The orchestrator emits this card directly into the chat stream
 * — Active workflows, Next recommended workflows, recently Completed — so
 * the user never has to leave chat to see what's in flight.
 *
 * The component is purely presentational and stateless. The parent decides
 * placement (end-of-stream / after-last-user-turn / etc.) and provides the
 * actions wired to the queue state.
 */
type Props = {
  queue: WorkflowQueueState;
  /** Open the workflow run's panel (Edit mappings, Resume, etc.). */
  onOpenWorkflow?: (run: WorkflowQueueRun) => void;
  /** Start the workflow implied by an unconsumed upload. */
  onStartRecommended?: (upload: WorkflowQueueUpload) => void;
  /** Dismiss an upload the user no longer wants to act on. */
  onDismissUpload?: (upload: WorkflowQueueUpload) => void;
};

function workflowIcon(kind: WorkflowKind) {
  if (kind === "migration") return <FileSpreadsheet size={13} className="text-emerald-600" />;
  if (kind === "documents") return <BookOpen size={13} className="text-violet-600" />;
  if (kind === "schema") return <Layers size={13} className="text-amber-600" />;
  return <Wrench size={13} className="text-blue-600" />;
}

function StatusChip({ status }: { status: WorkflowQueueRun["status"] }) {
  const map = {
    running: { label: "Running", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
    awaiting_input: {
      label: "Awaiting input",
      cls: "bg-amber-50 text-amber-700 ring-amber-200",
    },
    queued: { label: "Queued", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
    complete: { label: "Complete", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    failed: { label: "Failed", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  } as const;
  const m = map[status] ?? map.queued;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-0.5 text-[10px] font-medium",
        m.cls,
      )}
    >
      {status === "running" || status === "queued" ? <PlayCircle size={10} /> : null}
      {status === "awaiting_input" ? <PauseCircle size={10} /> : null}
      {status === "complete" ? <CheckCircle2 size={10} /> : null}
      {m.label}
    </span>
  );
}

function RunRow({
  run,
  onOpen,
}: {
  run: WorkflowQueueRun;
  onOpen?: (run: WorkflowQueueRun) => void;
}) {
  // Compose the "Pre-semantic review · Step 5 of 9 · 44%" line from the
  // structured fields. Falls back to ``detail`` when none are populated.
  const progressParts: string[] = [];
  if (run.gateLabel) progressParts.push(run.gateLabel);
  if (typeof run.step === "number") {
    progressParts.push(
      typeof run.totalSteps === "number"
        ? `Step ${run.step} of ${run.totalSteps}`
        : `Step ${run.step}`,
    );
  }
  if (typeof run.progressPct === "number") progressParts.push(`${run.progressPct}%`);
  const progressLine = progressParts.length > 0 ? progressParts.join(" · ") : run.detail ?? "";
  const showProgressBar = typeof run.progressPct === "number" && run.status !== "complete";

  return (
    <div className="rounded-lg ring-1 ring-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="shrink-0">{workflowIcon(run.kind)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-medium text-slate-800 truncate">{run.title}</span>
            <StatusChip status={run.status} />
          </div>
          {progressLine ? (
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">{progressLine}</p>
          ) : null}
        </div>
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(run)}
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 transition-colors"
          >
            {run.status === "awaiting_input"
              ? "Resume"
              : run.status === "complete" || run.status === "failed"
                ? "Review"
                : "Open"}
            <ArrowRight size={11} />
          </button>
        ) : null}
      </div>
      {showProgressBar ? (
        <div aria-hidden className="h-1 w-full bg-slate-100">
          <div
            className={cn(
              "h-full transition-[width] duration-500",
              run.status === "awaiting_input" ? "bg-amber-500" : "bg-indigo-500",
            )}
            style={{ width: `${Math.max(0, Math.min(100, run.progressPct ?? 0))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function UploadRow({
  upload,
  onStart,
  onDismiss,
}: {
  upload: WorkflowQueueUpload;
  onStart?: (upload: WorkflowQueueUpload) => void;
  onDismiss?: (upload: WorkflowQueueUpload) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg ring-1 ring-amber-200 bg-amber-50/60">
      <Sparkles size={12} className="text-amber-700 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-slate-800 truncate">
          {WORKFLOW_KIND_LABEL[upload.intendedKind]} · {upload.filename}
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Next recommended workflow from your upload
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1">
        {onStart ? (
          <button
            type="button"
            onClick={() => onStart(upload)}
            className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-slate-800 transition-colors"
          >
            Start
            <ArrowRight size={11} />
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={() => onDismiss(upload)}
            className="text-[10px] text-slate-500 hover:text-slate-700 px-2"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function DeepAgentQueueChatCard({
  queue,
  onOpenWorkflow,
  onStartRecommended,
  onDismissUpload,
}: Props) {
  const { active, completed, recommended } = deriveWorkflowQueueBuckets(queue);
  const recentCompleted = completed.slice(-3).reverse(); // most-recent first, cap 3
  const hasContent = active.length > 0 || recommended.length > 0 || recentCompleted.length > 0;
  if (!hasContent) return null;
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
        <div
          aria-hidden
          className="shrink-0 h-6 w-6 rounded-full bg-indigo-50 flex items-center justify-center"
        >
          <Bot size={12} className="text-indigo-600" />
        </div>
        <div className="text-[11px] font-medium text-slate-700">
          Workflow queue — current state for this conversation
        </div>
      </div>
      <div className="p-3 space-y-2">
        {active.length > 0 ? (
          <section>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-indigo-700 mb-1.5">
              Active task{active.length === 1 ? "" : "s"}
            </div>
            <div className="space-y-1.5">
              {active.map((run) => (
                <RunRow key={run.id} run={run} onOpen={onOpenWorkflow} />
              ))}
            </div>
          </section>
        ) : null}
        {recommended.length > 0 ? (
          <section>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-800 mb-1.5">
              Next recommended task{recommended.length === 1 ? "" : "s"}
            </div>
            <div className="space-y-1.5">
              {recommended.map((upload) => (
                <UploadRow
                  key={upload.id}
                  upload={upload}
                  onStart={onStartRecommended}
                  onDismiss={onDismissUpload}
                />
              ))}
            </div>
          </section>
        ) : null}
        {recentCompleted.length > 0 ? (
          <section>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">
              Completed
            </div>
            <div className="space-y-1.5">
              {recentCompleted.map((run) => (
                <RunRow key={run.id} run={run} onOpen={onOpenWorkflow} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
