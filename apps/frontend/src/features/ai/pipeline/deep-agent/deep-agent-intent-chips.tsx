"use client";

import type { ReactNode } from "react";
import { ArrowRight, Bot, Sparkles, X } from "lucide-react";

import { cn } from "@/utils/cn";

import {
  INTENT_CHIPS,
  INTENT_BY_KIND,
  MENU_SUBTITLE,
  MENU_TITLE,
  MIXED_TITLE,
  splitFilesByTrack,
  type IntentKind,
} from "./intent-menu";
import type { IntentMenuPhase, QueuedTrack } from "./use-intent-clarification";

/** Track-choice keys used by the two-way confirm + split bodies. */
type TrackKind = Extract<IntentKind, "csv_excel" | "word_pdf">;

export function DeepAgentIntentChips({
  phase,
  heldFiles,
  onPick,
  onConfirmIngest,
  onShowAll,
  onDismiss,
}: {
  phase: IntentMenuPhase;
  heldFiles: File[];
  onPick: (kind: IntentKind) => void;
  onConfirmIngest: (kind: TrackKind) => void;
  onShowAll: () => void;
  onDismiss: () => void;
}) {
  if (phase.kind === "none") return null;

  return (
    <Bubble onDismiss={onDismiss}>
      {phase.kind === "menu" ? <MenuBody onPick={onPick} /> : null}
      {phase.kind === "split" ? (
        <SplitBody heldFiles={heldFiles} onPick={onPick} onShowAll={onShowAll} />
      ) : null}
      {phase.kind === "confirm" ? (
        <ConfirmBody heldFiles={heldFiles} onConfirmIngest={onConfirmIngest} onShowAll={onShowAll} />
      ) : null}
      {phase.kind === "prompt" ? <PromptBody intent={phase.intent} /> : null}
    </Bubble>
  );
}

/** Continuation chip for the second track of a mixed upload (sequential). */
export function DeepAgentNextTrackChip({
  queued,
  onContinue,
  onDismiss,
}: {
  queued: QueuedTrack;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const chip = INTENT_BY_KIND[queued.intent];
  // Prefer the persistable file-name list — that's what survives a refresh
  // even when File blobs have been dropped from memory.
  const fileNames =
    queued.fileNames && queued.fileNames.length
      ? queued.fileNames
      : queued.files.map((f) => f.name);
  const firstFileName = fileNames[0];
  const filesRemaining = Math.max(0, fileNames.length - (firstFileName ? 1 : 0));
  const needsReAttach = queued.fileNames.length > 0 && queued.files.length === 0;

  return (
    <div
      role="status"
      className="relative rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300"
    >
      {/* Indigo accent stripe down the left edge — visually pairs this card
          with "active workflow" cards while keeping a distinct hue. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-indigo-500" />
      <div className="flex items-center gap-3 px-3.5 py-2.5 pl-4">
        <div
          aria-hidden
          className="shrink-0 h-7 w-7 rounded-full bg-indigo-50 flex items-center justify-center"
        >
          <Sparkles size={13} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-indigo-600">
            Next recommended task
          </div>
          <div className="mt-0.5 flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-900 tracking-tight truncate">
              {chip.label}
            </span>
            {firstFileName ? (
              <span
                className="shrink-0 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 font-medium max-w-[150px]"
                title={fileNames.join(", ")}
              >
                <span className="truncate">{firstFileName}</span>
                {filesRemaining ? <span className="ml-1 text-slate-400">+{filesRemaining}</span> : null}
              </span>
            ) : null}
            {needsReAttach ? (
              <span
                className="shrink-0 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 font-medium"
                title="The file is no longer in memory after the reload. Start now will open a file picker."
              >
                Re-attach
              </span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
          >
            Start now
            <ArrowRight size={12} />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Skip for now"
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div className="flex gap-3.5 items-start animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div
        aria-hidden
        className="shrink-0 h-7 w-7 rounded-full bg-indigo-50 flex items-center justify-center mt-0.5"
      >
        <Bot size={14} className="text-indigo-600" />
      </div>
      <div className="relative flex-1 pr-6">
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-0 top-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
        {children}
      </div>
    </div>
  );
}

function Chip({
  label,
  detail,
  onClick,
  tone = "default",
}: {
  label: string;
  detail?: string;
  onClick: () => void;
  tone?: "default" | "primary" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-xl px-3.5 py-3 transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
        tone === "ghost"
          ? "text-slate-600 hover:bg-slate-100/60"
          : "bg-slate-50/70 hover:bg-slate-100/80",
      )}
    >
      <div className="text-sm font-medium text-slate-900 tracking-tight">{label}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500 leading-relaxed">{detail}</div> : null}
    </button>
  );
}

function FileChips({ files }: { files: File[] }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {files.map((f) => (
        <span
          key={f.name}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50/80 px-2 py-0.5 text-[10px] text-slate-700 font-medium"
          title={f.name}
        >
          <span className="truncate max-w-[160px]">{f.name}</span>
        </span>
      ))}
    </div>
  );
}

function MenuBody({ onPick }: { onPick: (kind: IntentKind) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-slate-800">{MENU_TITLE}</div>
      <div className="text-xs text-slate-500">{MENU_SUBTITLE}</div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {INTENT_CHIPS.map((chip) => (
          <Chip key={chip.kind} label={chip.label} detail={chip.detail} onClick={() => onPick(chip.kind)} />
        ))}
      </div>
    </div>
  );
}

/** Scenario B — single-track upload: verify structured vs unstructured ingestion. */
function ConfirmBody({
  heldFiles,
  onConfirmIngest,
  onShowAll,
}: {
  heldFiles: File[];
  onConfirmIngest: (kind: TrackKind) => void;
  onShowAll: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-slate-800">How should I ingest these files?</div>
      <FileChips files={heldFiles} />
      <div className="mt-1 space-y-1.5">
        <Chip
          label="Excel / CSV structured ingestion"
          detail="Migrate as tabular data → field mapping → hierarchy → plenum_cafm."
          onClick={() => onConfirmIngest("csv_excel")}
          tone="primary"
        />
        <Chip
          label="Document ingestion (unstructured)"
          detail="Index in Doc RAG → match rows to CMMS tables → grounded search."
          onClick={() => onConfirmIngest("word_pdf")}
          tone="primary"
        />
        <Chip label="Show all options" onClick={onShowAll} tone="ghost" />
      </div>
    </div>
  );
}

/** Group held files by specific extension for the "you uploaded N files" summary. */
function summarizeFilesByExtension(files: File[]): Array<{ label: string; count: number }> {
  const buckets = {
    xlsx: 0,
    csv: 0,
    pdf: 0,
    docx: 0,
    other: 0,
  };
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (/\.(xlsx|xls|xlsm)$/.test(name)) buckets.xlsx += 1;
    else if (/\.csv$/.test(name)) buckets.csv += 1;
    else if (/\.pdf$/.test(name)) buckets.pdf += 1;
    else if (/\.(doc|docx)$/.test(name)) buckets.docx += 1;
    else buckets.other += 1;
  }
  const out: Array<{ label: string; count: number }> = [];
  if (buckets.xlsx) out.push({ label: buckets.xlsx === 1 ? "Excel" : "Excel files", count: buckets.xlsx });
  if (buckets.csv) out.push({ label: buckets.csv === 1 ? "CSV" : "CSVs", count: buckets.csv });
  if (buckets.pdf) out.push({ label: buckets.pdf === 1 ? "PDF" : "PDFs", count: buckets.pdf });
  if (buckets.docx) out.push({ label: buckets.docx === 1 ? "Word doc" : "Word docs", count: buckets.docx });
  if (buckets.other) out.push({ label: buckets.other === 1 ? "other file" : "other files", count: buckets.other });
  return out;
}

/** Scenario C — mixed upload: pick which track to run first, then continue with the other. */
function SplitBody({
  heldFiles,
  onPick,
  onShowAll,
}: {
  heldFiles: File[];
  onPick: (kind: IntentKind) => void;
  onShowAll: () => void;
}) {
  const { structured, docs } = splitFilesByTrack(heldFiles);
  const summary = summarizeFilesByExtension(heldFiles);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-800">
          You uploaded {heldFiles.length} file{heldFiles.length === 1 ? "" : "s"}. Which migration would you like to run first?
        </div>
        {summary.length ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {summary.map((s) => (
              <span
                key={s.label}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
              >
                <span className="tabular-nums">{s.count}</span>
                <span>{s.label}</span>
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
          {MIXED_TITLE} Pick one to start — the other continues automatically once the first finishes.
        </p>
      </div>
      <div className="space-y-2">
        <div className="space-y-1">
          <Chip
            label="Excel / CSV migration"
            detail={`${structured.length} spreadsheet${structured.length === 1 ? "" : "s"} → one migration job into plenum_cafm`}
            onClick={() => onPick("csv_excel")}
            tone="primary"
          />
          <FileChips files={structured} />
        </div>
        <div className="space-y-1">
          <Chip
            label="Word / PDF documents"
            detail={`${docs.length} document${docs.length === 1 ? "" : "s"} → Doc RAG index + row match`}
            onClick={() => onPick("word_pdf")}
            tone="primary"
          />
          <FileChips files={docs} />
        </div>
        <Chip label="Show all options" onClick={onShowAll} tone="ghost" />
      </div>
    </div>
  );
}

function PromptBody({ intent }: { intent: IntentKind }) {
  const chip = INTENT_BY_KIND[intent];
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{chip.label}</div>
      <div className="text-sm text-slate-600">{chip.nextStep}</div>
    </div>
  );
}
