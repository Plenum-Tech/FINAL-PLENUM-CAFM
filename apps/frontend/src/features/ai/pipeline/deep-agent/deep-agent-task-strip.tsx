"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ListChecks, PauseCircle, PlayCircle, Sparkles } from "lucide-react";

import { cn } from "@/utils/cn";

import type { ActiveTaskItem, CompletedTaskItem, DeepAgentTaskBuckets } from "./deep-agent-task-buckets";
import type { PinnedRun } from "./deep-agent-pinned-runs";

/**
 * Compact, chat-native task surface (Feature 1 spec push-back #1).
 *
 * The orchestrator is chat-first. Buckets render inline at the top of the
 * chat scroller so the user sees Active / Recommended / Queued / Completed
 * without leaving the conversation. The separate Tasks tab stays as a
 * fuller drill-down view but is secondary — this strip is the primary
 * surface.
 */
type Props = {
  buckets: DeepAgentTaskBuckets;
  onRunRecommended?: (pin: PinnedRun) => void;
  onContinueQueued?: () => void;
  onDismissQueued?: () => void;
  onOpenAll?: () => void;
};

function SectionToggle({
  label,
  count,
  expanded,
  onToggle,
  icon,
  accent,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  accent: string;
}) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-medium transition-colors",
        accent,
      )}
      aria-expanded={expanded}
    >
      {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      {icon}
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function ActiveRow({ item }: { item: ActiveTaskItem }) {
  const Icon = item.status === "awaiting_input" ? PauseCircle : PlayCircle;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Icon size={11} className={item.status === "awaiting_input" ? "text-amber-600" : "text-indigo-600"} />
      <span className="flex-1 min-w-0 truncate text-slate-700">{item.title}</span>
      {item.onOpen ? (
        <button
          type="button"
          onClick={item.onOpen}
          className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-200 transition-colors"
        >
          Open
          <ArrowRight size={10} />
        </button>
      ) : null}
    </div>
  );
}

function CompletedRow({ item }: { item: CompletedTaskItem }) {
  let title = "";
  let detail = "";
  if (item.kind === "migration") {
    title = item.snapshot.fileNames?.[0] ?? item.snapshot.cmms_name ?? "Migration";
    detail = item.snapshot.status ?? "complete";
  } else if (item.kind === "documents") {
    title =
      item.snapshot.fileNames?.[0] ??
      `${item.snapshot.totalDocs} document${item.snapshot.totalDocs === 1 ? "" : "s"}`;
    detail = `${item.snapshot.indexedCount} indexed`;
  } else if (item.kind === "schema") {
    title = item.snapshot.label ?? "Schema mapping";
    detail = item.snapshot.status ?? "complete";
  } else {
    title = item.snapshot.title ?? item.snapshot.workOrderId;
    detail = [item.snapshot.priority, item.snapshot.status].filter(Boolean).join(" · ") || "complete";
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
      <span className="flex-1 min-w-0 truncate text-slate-700">{title}</span>
      <span className="text-[10px] text-slate-400 shrink-0 truncate max-w-[8rem]">{detail}</span>
      {"onOpen" in item && item.onOpen ? (
        <button
          type="button"
          onClick={item.onOpen}
          className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-200 transition-colors"
        >
          Review
          <ArrowRight size={10} />
        </button>
      ) : null}
    </div>
  );
}

export function DeepAgentTaskBucketStrip({
  buckets,
  onRunRecommended,
  onContinueQueued,
  onDismissQueued,
  onOpenAll,
}: Props) {
  const { active, recommended, queued, completed } = buckets;
  const recentCompleted = completed.slice(0, 3);
  const totalCount = active.length + recommended.length + (queued ? 1 : 0) + completed.length;
  // Default collapsed for Active and Recommended so the sticky strip stays
  // compact. Users expand the section they want to drill into; Queued opens
  // when present (it's a single high-signal item); Completed stays collapsed.
  const [openActive, setOpenActive] = useState(false);
  const [openRecommended, setOpenRecommended] = useState(false);
  const [openQueued, setOpenQueued] = useState(!!queued);
  const [openCompleted, setOpenCompleted] = useState(false);

  if (totalCount === 0) return null;

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-b from-amber-50/70 to-white border-b border-amber-100/70">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
          <ListChecks size={11} />
          Tasks
          <span className="text-amber-600/80 normal-case tracking-normal font-medium">
            · {totalCount} in flight
          </span>
        </div>
        {onOpenAll ? (
          <button
            type="button"
            onClick={onOpenAll}
            className="text-[10px] text-slate-500 hover:text-slate-800 transition-colors"
          >
            View all →
          </button>
        ) : null}
      </div>
      <div className="px-3 py-2 flex flex-wrap items-center gap-1.5">
        <SectionToggle
          label="Active"
          count={active.length}
          expanded={openActive}
          onToggle={() => setOpenActive((v) => !v)}
          icon={<PlayCircle size={10} className="text-indigo-600" />}
          accent="bg-indigo-50 ring-indigo-200 text-indigo-700"
        />
        <SectionToggle
          label="Recommended"
          count={recommended.length}
          expanded={openRecommended}
          onToggle={() => setOpenRecommended((v) => !v)}
          icon={<Sparkles size={10} className="text-amber-700" />}
          accent="bg-amber-50 ring-amber-200 text-amber-800"
        />
        <SectionToggle
          label="Queued"
          count={queued ? 1 : 0}
          expanded={openQueued}
          onToggle={() => setOpenQueued((v) => !v)}
          icon={<PauseCircle size={10} className="text-slate-700" />}
          accent="bg-slate-50 ring-slate-200 text-slate-700"
        />
        <SectionToggle
          label="Completed"
          count={completed.length}
          expanded={openCompleted}
          onToggle={() => setOpenCompleted((v) => !v)}
          icon={<CheckCircle2 size={10} className="text-emerald-600" />}
          accent="bg-emerald-50 ring-emerald-200 text-emerald-700"
        />
      </div>

      {openActive && active.length > 0 ? (
        <div className="px-3 pb-2 space-y-1 border-t border-slate-100">
          <div className="pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            Active
          </div>
          {active.map((item) => (
            <ActiveRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}

      {openRecommended && recommended.length > 0 ? (
        <div className="px-3 pb-2 space-y-1 border-t border-slate-100">
          <div className="pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            Recommended
          </div>
          {recommended.slice(0, 4).map((pin) => (
            <button
              key={pin.id}
              type="button"
              onClick={() => onRunRecommended?.(pin)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] hover:bg-amber-50/60 transition-colors"
            >
              <Sparkles size={10} className="text-amber-600 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-slate-800 font-medium">{pin.label}</span>
              <ArrowRight size={10} className="text-slate-400" />
            </button>
          ))}
        </div>
      ) : null}

      {openQueued && queued ? (
        <div className="px-3 pb-2 space-y-1 border-t border-slate-100">
          <div className="pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            Queued
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <PauseCircle size={11} className="text-slate-700 shrink-0" />
            <span className="flex-1 min-w-0 truncate text-slate-700">
              {queued.intent.replace(/_/g, " ")}
              {queued.fileNames.length ? ` · ${queued.fileNames.length} file${queued.fileNames.length === 1 ? "" : "s"}` : ""}
            </span>
            {onContinueQueued ? (
              <button
                type="button"
                onClick={onContinueQueued}
                className="inline-flex items-center gap-0.5 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-slate-800 transition-colors"
              >
                Continue
                <ArrowRight size={10} />
              </button>
            ) : null}
            {onDismissQueued ? (
              <button
                type="button"
                onClick={onDismissQueued}
                className="text-[10px] text-slate-500 hover:text-slate-700"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {openCompleted && recentCompleted.length > 0 ? (
        <div className="px-3 pb-2 space-y-1 border-t border-slate-100">
          <div className="pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            Completed · last {recentCompleted.length}
          </div>
          {recentCompleted.map((item, idx) => (
            <CompletedRow key={`${item.kind}-${idx}`} item={item} />
          ))}
          {completed.length > recentCompleted.length && onOpenAll ? (
            <button
              type="button"
              onClick={onOpenAll}
              className="text-[10px] text-slate-500 hover:text-slate-800 transition-colors mt-1"
            >
              +{completed.length - recentCompleted.length} more in Tasks tab →
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
