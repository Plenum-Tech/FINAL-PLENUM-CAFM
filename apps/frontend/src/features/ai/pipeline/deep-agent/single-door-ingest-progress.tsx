"use client";

import { Bot } from "lucide-react";

export type SingleDoorPipelineKind = "migration" | "doc_rag";

export function classifyUploadFiles(files: File[]): {
  migration: boolean;
  docRag: boolean;
  schema: boolean;
} {
  const migration = files.some((f) => /\.(csv|xlsx|xls|xlsm)$/i.test(f.name));
  const docRag = files.some((f) =>
    /\.(pdf|docx?|txt|png|jpe?g|webp|tiff?|gif)$/i.test(f.name),
  );
  const schema = files.some((f) => /\.(ya?ml|json)$/i.test(f.name));
  return { migration, docRag, schema };
}

function summarizeIngest(files: File[]): string {
  const { migration, docRag, schema } = classifyUploadFiles(files);
  const tracks: string[] = [];
  if (migration) tracks.push("migration");
  if (docRag) tracks.push("documents");
  if (schema) tracks.push("schema");

  const count = files.length;
  const noun = count === 1 ? "file" : "files";

  if (tracks.length === 0) return `Preparing ${count} ${noun}`;
  if (tracks.length === 1) return `Preparing ${count} ${noun} for ${tracks[0]}`;
  return `Preparing ${count} ${noun} across ${tracks.join(" + ")}`;
}

export function SingleDoorIngestProgress({
  files,
  active,
}: {
  files: File[];
  active: boolean;
}) {
  if (!files.length) return null;

  const summary = summarizeIngest(files);
  const previewFiles = files.slice(0, 3).map((f) => f.name);
  const remaining = Math.max(0, files.length - previewFiles.length);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={summary}
      className="flex gap-3.5 items-start animate-in fade-in slide-in-from-bottom-1 duration-300"
    >
      <div
        aria-hidden
        className="shrink-0 h-7 w-7 rounded-full bg-indigo-50 flex items-center justify-center mt-0.5"
      >
        <Bot size={14} className="text-indigo-600" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 text-[13px] text-slate-700">
          {active ? (
            <span aria-hidden className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 [animation-delay:0ms] animate-bounce" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 [animation-delay:150ms] animate-bounce" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 [animation-delay:300ms] animate-bounce" />
            </span>
          ) : null}
          <span className="tracking-tight">{summary}…</span>
        </div>
        {previewFiles.length ? (
          <div className="flex flex-wrap gap-1.5">
            {previewFiles.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full bg-slate-100/80 px-2.5 py-0.5 text-[11px] text-slate-600 max-w-[220px] truncate"
                title={name}
              >
                {name}
              </span>
            ))}
            {remaining > 0 ? (
              <span className="inline-flex items-center rounded-full bg-slate-100/80 px-2.5 py-0.5 text-[11px] text-slate-500">
                +{remaining} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
