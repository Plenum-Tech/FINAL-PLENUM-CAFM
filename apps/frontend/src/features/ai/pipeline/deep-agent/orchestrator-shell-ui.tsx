"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Database,
  FileSpreadsheet,
  Layers,
  ListChecks,
  MessageSquare,
  RefreshCw,
  ScrollText,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui";
import { ChatMarkdown } from "@/components/chat-markdown";
import { cn } from "@/utils/cn";

import type { DeepAgentTurn } from "./use-deep-agent-orchestrator";

export type CenterTabId =
  | "chat"
  | "tasks"
  | "activity"
  | "documents"
  | "migration"
  | "udr"
  | "work_orders"
  | "schema";

export const CENTER_TABS: {
  id: CenterTabId;
  label: string;
  icon: ReactNode;
  accent: string;
  activeClass: string;
}[] = [
  {
    id: "chat",
    label: "Chat",
    icon: <MessageSquare size={13} />,
    accent: "text-slate-700",
    activeClass: "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200",
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: <ListChecks size={13} />,
    accent: "text-amber-600",
    activeClass: "bg-amber-600 text-white shadow-sm",
  },
  {
    id: "activity",
    label: "Activity",
    icon: <ScrollText size={13} />,
    accent: "text-violet-600",
    activeClass: "bg-violet-600 text-white shadow-sm",
  },
  {
    id: "work_orders",
    label: "Work orders",
    icon: <Wrench size={13} />,
    accent: "text-indigo-600",
    activeClass: "bg-indigo-600 text-white shadow-sm",
  },
  {
    id: "documents",
    label: "Documents",
    icon: <BookOpen size={13} />,
    accent: "text-rose-600",
    activeClass: "bg-rose-600 text-white shadow-sm",
  },
  {
    id: "migration",
    label: "Migration",
    icon: <FileSpreadsheet size={13} />,
    accent: "text-violet-600",
    activeClass: "bg-violet-600 text-white shadow-sm",
  },
  {
    id: "udr",
    label: "UDR",
    icon: <Database size={13} />,
    accent: "text-cyan-600",
    activeClass: "bg-cyan-600 text-white shadow-sm",
  },
  {
    id: "schema",
    label: "Schema",
    icon: <Layers size={13} />,
    accent: "text-emerald-600",
    activeClass: "bg-emerald-600 text-white shadow-sm",
  },
];

export function OrchestratorHero() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">Orchestrator</h1>
      <span className="hidden sm:inline-flex text-[11px] font-medium text-slate-400">
        Single conversation across all FM workflows
      </span>
    </div>
  );
}

export function OrchestratorOrgBanner(props: { orgName?: string; onScrollToHeader?: () => void }) {
  if (props.orgName) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 flex items-center gap-3 rounded-xl bg-amber-50/60 px-3.5 py-2.5 text-xs text-amber-900"
    >
      <AlertCircle size={14} className="shrink-0 text-amber-600" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-amber-950">Select an organization to start</span>
        <span className="text-amber-700/70"> — use the building icon in the top header bar.</span>
      </div>
      {props.onScrollToHeader ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0 h-7 px-2.5 text-xs text-amber-800 hover:bg-amber-100/60"
          onClick={props.onScrollToHeader}
        >
          Go to header
        </Button>
      ) : null}
    </div>
  );
}

export function OrchestratorCenterTabBar(props: {
  active: CenterTabId;
  onChange: (tab: CenterTabId) => void;
  schemaLive?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200/80 bg-slate-100/80 p-1">
      {CENTER_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => props.onChange(tab.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all",
            props.active === tab.id ? tab.activeClass : "text-muted-foreground hover:text-foreground hover:bg-white/60",
          )}
        >
          <span className={props.active === tab.id && tab.id !== "chat" ? "text-inherit" : tab.accent}>
            {tab.icon}
          </span>
          {tab.label}
          {tab.id === "schema" && props.schemaLive ? (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

const DEMO_FLOWS: {
  title: string;
  description: string;
  prompt: string;
  tab: CenterTabId;
  tone: string;
}[] = [
  {
    title: "Work orders",
    description: "List urgent WOs or create a repair request",
    prompt: "List open work orders with urgent or critical priority.",
    tab: "work_orders",
    tone: "border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50/50",
  },
  {
    title: "Documents",
    description: "Index PDFs and query certificates",
    prompt: "Help me index a warranty PDF and search for HVAC certificates.",
    tab: "documents",
    tone: "border-rose-200 hover:border-rose-300 hover:bg-rose-50/50",
  },
  {
    title: "Migration",
    description: "CSV/Excel structured ingest",
    prompt: "I have a CSV workbook to migrate into plenum_cafm — what do you need?",
    tab: "migration",
    tone: "border-violet-200 hover:border-violet-300 hover:bg-violet-50/50",
  },
  {
    title: "UDR",
    description: "Ingest, map, and build hierarchy",
    prompt: "Run UDR mapping and hierarchy on my latest ingest batch.",
    tab: "udr",
    tone: "border-cyan-200 hover:border-cyan-300 hover:bg-cyan-50/50",
  },
  {
    title: "Fiix schema",
    description: "Live CMMS → plenum_cafm mapping",
    prompt:
      "Connect Fiix and start live schema mapping.\nSubdomain: demo\nApp Key: …\nAccess Key: …\nSecret Key: …",
    tab: "schema",
    tone: "border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50/50",
  },
];

export function OrchestratorDemoWelcome(props: {
  disabled?: boolean;
  onRunPrompt: (prompt: string, tab?: CenterTabId) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-slate-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Welcome — pick a demo flow</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Each card opens the right workspace tab and sends a starter prompt. Follow tool steps in the{" "}
              <strong>Process log</strong> panel on the right.
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {DEMO_FLOWS.map((flow) => (
          <button
            key={flow.title}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onRunPrompt(flow.prompt, flow.tab)}
            className={cn(
              "text-left rounded-xl border bg-white px-4 py-3 transition-all shadow-sm disabled:opacity-50",
              flow.tone,
            )}
          >
            <p className="text-sm font-medium text-slate-900">{flow.title}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{flow.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OrchestratorFlowEmptyState(props: {
  flow: CenterTabId;
  onOpenChat?: (prefill?: string) => void;
}) {
  const copy: Record<CenterTabId, { title: string; body: string; action: string; prefill?: string }> = {
    chat: { title: "Start chatting", body: "Pick a demo flow below.", action: "Open chat" },
    tasks: {
      title: "No tasks yet",
      body: "Active, recommended, queued, and completed work will appear here as you use the orchestrator.",
      action: "Open chat",
    },
    activity: {
      title: "No activity yet",
      body: "Triggers, agent handoffs, tool calls, approvals, and escalations will appear here as the orchestrator works.",
      action: "Open chat",
    },
    work_orders: {
      title: "Work order workspace",
      body: "Live WO stats and recent tickets appear here. Create WOs through chat.",
      action: "Create in chat",
      prefill: "Create a work order for urgent HVAC repair at Building A.",
    },
    documents: {
      title: "Document & Doc RAG",
      body: "Upload PDFs, match rows to CMMS, and run semantic queries.",
      action: "Ask in chat",
      prefill: "Help me index documents and run a Doc RAG query.",
    },
    migration: {
      title: "Structured migration",
      body: "Attach CSV/Excel in chat to start the gate pipeline — pre-semantic, semantic review, field mapping.",
      action: "Start in chat",
      prefill: "Start structured migration — I will attach a CSV file.",
    },
    udr: {
      title: "Unified Data Register",
      body: "Ingest files, run mapping, and confirm hierarchy in one script.",
      action: "Run UDR in chat",
      prefill: "Ingest files and run UDR mapping with hierarchy for plenum_cafm.",
    },
    schema: {
      title: "Fiix schema mapper",
      body: "Paste Fiix credentials in chat to fetch live schema and walk through mapping gates.",
      action: "Connect Fiix",
      prefill: "Connect Fiix and start live schema mapping into plenum_cafm.",
    },
  };
  const c = copy[props.flow];

  return (
    <div className="rounded-2xl bg-slate-50/60 px-6 py-8 text-center max-w-lg mx-auto">
      <h3 className="text-base font-semibold text-slate-900 tracking-tight">{c.title}</h3>
      <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{c.body}</p>
      {props.onOpenChat ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-4 shadow-none"
          onClick={() => props.onOpenChat?.(c.prefill)}
        >
          {c.action}
        </Button>
      ) : null}
    </div>
  );
}

export function OrchestratorPanelFrame(props: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-[min(68vh,720px)] flex flex-col rounded-xl overflow-hidden", props.className)}>
      {props.title ? (
        <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 py-2.5">
          <p className="text-xs font-medium text-slate-600">{props.title}</p>
        </div>
      ) : null}
      <div className="flex-1 min-h-0 overflow-hidden">{props.children}</div>
    </div>
  );
}

export function OrchestratorMessageBubble(props: {
  turn: DeepAgentTurn;
  domain?: string;
  onRetry?: () => void;
}) {
  const { turn } = props;
  const isUser = turn.role === "user";
  const isError = turn.role === "error";

  if (isUser) {
    return (
      <div className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="max-w-[80%] rounded-2xl bg-slate-100 px-4 py-2.5 text-[15px] leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
          {turn.text}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div
        aria-hidden
        className={cn(
          "shrink-0 h-7 w-7 rounded-full flex items-center justify-center mt-0.5",
          isError ? "bg-red-50 text-red-600" : "bg-indigo-50 text-indigo-600",
        )}
      >
        {isError ? <AlertCircle size={14} /> : <Bot size={14} />}
      </div>
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        {props.domain && props.domain !== "unknown" && !isError ? (
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 capitalize">
            {props.domain.replace(/_/g, " ")}
          </span>
        ) : null}
        <div
          className={cn(
            "text-[15px] leading-relaxed",
            isError ? "text-red-900" : "text-slate-800",
          )}
        >
          {isError ? (
            <div className="space-y-2">
              <p className="font-semibold">Something went wrong</p>
              <p className="text-sm whitespace-pre-wrap opacity-90">{turn.text}</p>
              {props.onRetry ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-red-700 hover:bg-red-50 px-2"
                  onClick={props.onRetry}
                >
                  <RefreshCw size={12} className="mr-1" />
                  Try again
                </Button>
              ) : null}
            </div>
          ) : (
            <ChatMarkdown text={turn.text} />
          )}
        </div>
      </div>
    </div>
  );
}

export function OrchestratorHitlBanner(props: { onOpenActivity: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 rounded-xl bg-amber-50/60 px-4 py-2.5 text-xs animate-in fade-in slide-in-from-bottom-1 duration-300"
    >
      <div className="flex items-center gap-2.5 text-amber-900">
        <AlertCircle size={14} className="shrink-0 text-amber-600" />
        <span>
          <strong className="font-medium text-amber-950">Review required</strong>
          <span className="text-amber-700/80"> — approve or reject in the Process log.</span>
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0 h-7 px-2.5 text-xs text-amber-800 hover:bg-amber-100/60"
        onClick={props.onOpenActivity}
      >
        Open Process log
      </Button>
    </div>
  );
}
