"use client";

import { ChevronRight } from "lucide-react";

import {
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  type ToolCallRecord,
  type ToolInfo,
} from "@/features/ai/deep-agents-api";
import { cn } from "@/utils/cn";

function domainForTool(toolName: string, toolsByName: Map<string, ToolInfo>) {
  return toolsByName.get(toolName)?.domain ?? "unknown";
}

function summarizeOutput(output: unknown): string {
  if (output == null) return "—";
  if (typeof output === "string") {
    return output.length > 280 ? `${output.slice(0, 280)}…` : output;
  }
  try {
    const s = JSON.stringify(output, null, 2);
    return s.length > 400 ? `${s.slice(0, 400)}…` : s;
  } catch {
    return String(output);
  }
}

function ToolRow(props: {
  tool: string;
  domain: string;
  status: "running" | "done";
  dark: boolean;
}) {
  const badge = DOMAIN_COLORS[props.domain] ?? DOMAIN_COLORS.unknown;
  const label = DOMAIN_LABELS[props.domain] ?? props.domain;
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span
        className={cn(
          "text-xs font-mono font-medium truncate flex-1",
          props.dark ? "text-slate-100" : "text-slate-800",
        )}
      >
        {props.tool}
      </span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${badge}`}>
        {label}
      </span>
      {props.status === "running" ? (
        <span
          className={cn(
            "inline-block h-3 w-3 rounded-full border-2 border-t-transparent animate-spin shrink-0",
            props.dark ? "border-violet-400" : "border-indigo-500",
          )}
        />
      ) : null}
    </div>
  );
}

function TraceBlock(props: { title: string; value: unknown; raw?: boolean; dark: boolean }) {
  const text = props.raw ? summarizeOutput(props.value) : JSON.stringify(props.value, null, 2);
  return (
    <div>
      <div
        className={cn(
          "text-[9px] font-semibold uppercase tracking-wider",
          props.dark ? "text-slate-500" : "text-slate-400",
        )}
      >
        {props.title}
      </div>
      <pre
        className={cn(
          "mt-0.5 whitespace-pre-wrap break-words max-h-36 overflow-y-auto rounded px-2 py-1.5",
          props.dark ? "bg-slate-950 text-slate-300" : "bg-slate-50",
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function TraceBody(props: { input: Record<string, unknown>; output?: unknown; dark: boolean }) {
  return (
    <div
      className={cn(
        "border-t px-3 py-2 space-y-2 text-[10px] font-mono",
        props.dark ? "border-slate-700 text-slate-400" : "border-slate-100 text-slate-600",
      )}
    >
      <TraceBlock title="Input" value={props.input} dark={props.dark} />
      {props.output !== undefined ? (
        <TraceBlock title="Output" value={props.output} raw dark={props.dark} />
      ) : null}
    </div>
  );
}

export function DeepAgentToolTrace(props: {
  toolCalls: ToolCallRecord[];
  toolsCatalog?: ToolInfo[];
  liveEvents?: Array<{ id: string; label: string; domain: string; status: "running" | "done" }>;
  variant?: "light" | "dark";
}) {
  const { toolCalls, toolsCatalog = [], liveEvents = [], variant = "light" } = props;
  const dark = variant === "dark";
  const toolsByName = new Map(toolsCatalog.map((t) => [t.name, t]));

  if (!toolCalls.length && !liveEvents.length) {
    return (
      <div
        className={cn(
          "rounded-xl border p-4",
          dark ? "border-slate-700/60 bg-slate-900/50" : "border-slate-200 bg-slate-50",
        )}
      >
        <div className={cn("text-sm font-semibold", dark ? "text-slate-100" : "text-slate-800")}>
          No tool activity yet
        </div>
        <div
          className={cn(
            "mt-1 text-xs leading-relaxed",
            dark ? "text-slate-400" : "text-slate-500",
          )}
        >
          Ask a CAFM question — the orchestrator will call domain tools and show the trace here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {liveEvents.map((ev) => (
        <div
          key={ev.id}
          className={cn(
            "rounded-lg border px-3 py-2",
            dark ? "border-violet-500/30 bg-violet-950/30" : "border-indigo-200 bg-indigo-50/50",
          )}
        >
          <ToolRow tool={ev.label} domain={ev.domain} status={ev.status} dark={dark} />
        </div>
      ))}

      {toolCalls.map((tc, i) => {
        const domain = domainForTool(tc.tool, toolsByName);
        return (
          <details
            key={`${tc.tool}_${i}`}
            className={cn(
              "group rounded-lg border",
              dark ? "border-slate-700/60 bg-slate-900/40" : "border-slate-200 bg-white",
            )}
          >
            <summary className="list-none flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
              <ChevronRight
                size={12}
                className={cn(
                  "shrink-0 group-open:rotate-90 transition-transform",
                  dark ? "text-slate-500" : "text-slate-400",
                )}
              />
              <ToolRow tool={tc.tool} domain={domain} status="done" dark={dark} />
            </summary>
            <TraceBody input={tc.input} output={tc.output} dark={dark} />
          </details>
        );
      })}
    </div>
  );
}
