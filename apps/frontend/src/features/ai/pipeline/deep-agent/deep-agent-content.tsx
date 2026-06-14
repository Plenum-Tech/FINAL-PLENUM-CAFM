"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Bot, Loader2, RotateCcw, Sparkles } from "lucide-react";

import {
  buildDeepAgentsWebSocketUrl,
  deepAgentsApi,
  DOMAIN_LABELS,
  getDeepAgentsErrorMessage,
  useDeepAgentsResume,
  useDeepAgentsRunStateful,
  useDeepAgentsTools,
  type ToolCallRecord,
  type WorkflowResponse,
  type WorkflowStreamEvent,
} from "@/features/ai/deep-agents-api";

import { ChatMarkdown } from "@/components/chat-markdown";

import { DeepAgentHitlGate } from "./deep-agent-hitl-gate";
import { DeepAgentToolTrace } from "./deep-agent-tool-trace";
import type { DeepAgentProcessLogEntry } from "./deep-agent-process-log";

export type DeepAgentTurn = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
};

const STARTER_PROMPTS = [
  "Give me a morning operations briefing: critical WOs, today's PM tasks, zero-stock parts, and compliance rate.",
  "List all open work orders with urgent or critical priority.",
  "Which assets are most at risk — overdue PM, open critical WOs, and compliance status?",
  "Is asset MOB-AHU-001 compliant? Summarize findings only.",
];

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function formatToolOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

type PendingTool = {
  input: Record<string, unknown>;
  domain: string;
  startedAt: number;
};

export type DeepAgentContentHandle = {
  sendMessage: (text: string) => Promise<void>;
  isBusy: boolean;
  hasInterrupt: boolean;
};

export const DeepAgentContent = forwardRef<
  DeepAgentContentHandle,
  {
    sessionId: string;
    orgId?: string;
    serviceAvailable?: boolean | null;
    onReset: () => void;
    onToolCallsChange?: (toolCalls: ToolCallRecord[]) => void;
    onLiveEventsChange?: (
      events: Array<{ id: string; label: string; domain: string; status: "running" | "done" }>,
    ) => void;
    onProcessLogChange?: (entries: DeepAgentProcessLogEntry[]) => void;
    onBusyChange?: (busy: boolean) => void;
    useStreaming?: boolean;
    showInlineTrace?: boolean;
  }
>(function DeepAgentContent(props, ref) {
  const {
    sessionId,
    orgId,
    serviceAvailable,
    onReset,
    onToolCallsChange,
    onLiveEventsChange,
    onProcessLogChange,
    onBusyChange,
    useStreaming = true,
    showInlineTrace = true,
  } = props;

  const [turns, setTurns] = useState<DeepAgentTurn[]>([
    {
      id: "greeting",
      role: "assistant",
      text: "I'm the Plenum CAFM DeepAgent — ask anything about work orders, assets, compliance, migrations, or documents. I'll call the right tools and show you the trace.",
    },
  ]);
  const [pending, setPending] = useState(false);
  const [interruptPayload, setInterruptPayload] = useState<Record<string, unknown> | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [processLog, setProcessLog] = useState<DeepAgentProcessLogEntry[]>([]);
  const [liveEvents, setLiveEvents] = useState<
    Array<{ id: string; label: string; domain: string; status: "running" | "done" }>
  >([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const processStepRef = useRef(0);
  const pendingToolStacks = useRef<Record<string, PendingTool[]>>({});
  const { data: toolsCatalog = [] } = useDeepAgentsTools({ enabled: true });

  const appendProcessLog = useCallback(
    (partial: Omit<DeepAgentProcessLogEntry, "id" | "at" | "step"> & { id?: string }) => {
      processStepRef.current += 1;
      const entry: DeepAgentProcessLogEntry = {
        id: partial.id ?? nowId("plog"),
        at: new Date().toISOString(),
        step: processStepRef.current,
        ...partial,
      };
      setProcessLog((prev) => [...prev, entry]);
    },
    [],
  );

  const logToolCallsFromRest = useCallback(
    (calls: ToolCallRecord[]) => {
      for (const tc of calls) {
        appendProcessLog({
          phase: "started",
          tool: tc.tool,
          toolLabel: tc.tool,
          status: "running",
          title: `Calling ${tc.tool}`,
          detail: "Tool invoked by orchestrator",
          input: tc.input,
        });
        appendProcessLog({
          phase: "completed",
          tool: tc.tool,
          toolLabel: tc.tool,
          status: "success",
          title: `${tc.tool} completed`,
          detail: "Tool returned successfully",
          input: tc.input,
          output: formatToolOutput(tc.output),
        });
      }
    },
    [appendProcessLog],
  );

  useEffect(() => {
    onToolCallsChange?.(toolCalls);
  }, [toolCalls, onToolCallsChange]);

  useEffect(() => {
    onLiveEventsChange?.(liveEvents);
  }, [liveEvents, onLiveEventsChange]);

  useEffect(() => {
    onProcessLogChange?.(processLog);
  }, [processLog, onProcessLogChange]);

  useEffect(() => {
    setTurns([
      {
        id: "greeting",
        role: "assistant",
        text: "I'm the Plenum CAFM DeepAgent — ask anything about work orders, assets, compliance, migrations, or documents. I'll call the right tools and show you the trace.",
      },
    ]);
    setInterruptPayload(null);
    setToolCalls([]);
    setProcessLog([]);
    setLiveEvents([]);
    processStepRef.current = 0;
    pendingToolStacks.current = {};
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await deepAgentsApi.getWorkflowStatus(sessionId);
        if (cancelled) return;
        if (status.interrupted && status.interrupt_payload) {
          setInterruptPayload(status.interrupt_payload);
        }
      } catch {
        /* new or unknown session */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending, interruptPayload]);

  const applyResponse = useCallback(
    (res: WorkflowResponse) => {
      if (res.tool_calls?.length) {
        setToolCalls(res.tool_calls);
        logToolCallsFromRest(res.tool_calls);
      } else {
        setToolCalls([]);
      }
      setLiveEvents([]);
      if (res.interrupted && res.interrupt_payload) {
        setInterruptPayload(res.interrupt_payload);
        return;
      }
      setInterruptPayload(null);
      if (res.answer?.trim()) {
        setTurns((prev) => [
          ...prev,
          { id: nowId("assistant"), role: "assistant", text: res.answer.trim() },
        ]);
      } else if (!res.success && res.error) {
        setTurns((prev) => [
          ...prev,
          { id: nowId("error"), role: "error", text: res.error ?? "Request failed" },
        ]);
      }
    },
    [logToolCallsFromRest],
  );

  const { mutateAsync: runStateful } = useDeepAgentsRunStateful();
  const { mutateAsync: resumeWorkflow, isPending: resuming } = useDeepAgentsResume();

  const runViaRest = useCallback(
    async (message: string) => {
      const context = orgId ? `Organization ID: ${orgId}` : undefined;
      const res = await runStateful({ message, session_id: sessionId, context });
      applyResponse(res);
    },
    [applyResponse, orgId, runStateful, sessionId],
  );

  const runViaWebSocket = useCallback(
    async (message: string) => {
      const context = orgId ? `Organization ID: ${orgId}` : undefined;
      const url = buildDeepAgentsWebSocketUrl(sessionId);
      if (!url) {
        await runViaRest(message);
        return;
      }

      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const collected: ToolCallRecord[] = [];
        const live: typeof liveEvents = [];
        let answer = "";
        let settled = false;

        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          if (err) reject(err);
          else resolve();
        };

        ws.onopen = () => {
          ws.send(JSON.stringify({ message, context: context ?? null }));
        };

        ws.onmessage = (ev) => {
          let data: WorkflowStreamEvent;
          try {
            data = JSON.parse(String(ev.data)) as WorkflowStreamEvent;
          } catch {
            return;
          }

          if (data.type === "tool_started") {
            const stack = pendingToolStacks.current[data.tool] ?? [];
            stack.push({ input: data.input, domain: data.domain, startedAt: Date.now() });
            pendingToolStacks.current[data.tool] = stack;

            const id = nowId(`live_${data.tool}`);
            live.push({
              id,
              label: data.tool,
              domain: data.domain,
              status: "running",
            });
            setLiveEvents([...live]);

            appendProcessLog({
              phase: "started",
              tool: data.tool,
              toolLabel: data.tool,
              status: "running",
              title: `Calling ${data.tool}`,
              detail: DOMAIN_LABELS[data.domain]
                ? `${DOMAIN_LABELS[data.domain]} domain`
                : `${data.domain} domain`,
              input: data.input,
            });
            return;
          }

          if (data.type === "tool_completed") {
            const stack = pendingToolStacks.current[data.tool] ?? [];
            const pendingMeta = stack.shift();
            if (stack.length) pendingToolStacks.current[data.tool] = stack;
            else delete pendingToolStacks.current[data.tool];

            const durationMs = pendingMeta ? Date.now() - pendingMeta.startedAt : undefined;
            const input = pendingMeta?.input ?? {};

            const idx = live.findIndex((e) => e.label === data.tool && e.status === "running");
            if (idx >= 0) live[idx] = { ...live[idx], status: "done" };
            else {
              live.push({
                id: nowId(`live_${data.tool}`),
                label: data.tool,
                domain: data.domain,
                status: "done",
              });
            }
            collected.push({ tool: data.tool, input, output: data.output });
            setLiveEvents([...live]);
            setToolCalls([...collected]);

            appendProcessLog({
              phase: "completed",
              tool: data.tool,
              toolLabel: data.tool,
              status: "success",
              title: `${data.tool} completed`,
              detail: "Tool returned successfully",
              input,
              output: formatToolOutput(data.output),
              durationMs,
            });
            return;
          }

          if (data.type === "agent_switch") {
            const fromLabel = DOMAIN_LABELS[data.from_domain] ?? data.from_domain;
            const toLabel = DOMAIN_LABELS[data.to_domain] ?? data.to_domain;
            appendProcessLog({
              phase: "completed",
              tool: "agent_switch",
              toolLabel: "Agent switch",
              status: "success",
              title: "Agent handoff",
              detail: `${fromLabel} → ${toLabel}`,
              input: { from_domain: data.from_domain, to_domain: data.to_domain },
            });
            return;
          }

          if (data.type === "gate_interrupt") {
            setInterruptPayload(data.payload);
            setLiveEvents([]);
            finish();
            return;
          }

          if (data.type === "workflow_completed") {
            answer = data.answer ?? "";
            if (data.tool_calls?.length) setToolCalls(data.tool_calls);
            else if (collected.length) setToolCalls(collected);
            setLiveEvents([]);
            setInterruptPayload(null);
            if (answer.trim()) {
              setTurns((prev) => [
                ...prev,
                { id: nowId("assistant"), role: "assistant", text: answer.trim() },
              ]);
            }
            finish();
            return;
          }

          if (data.type === "error") {
            setTurns((prev) => [
              ...prev,
              { id: nowId("error"), role: "error", text: data.error },
            ]);
            finish(new Error(data.error));
          }
        };

        ws.onerror = () => {
          finish(new Error("WebSocket connection failed"));
        };

        ws.onclose = () => {
          if (!settled) finish();
        };
      }).catch(async () => {
        await runViaRest(message);
      });
    },
    [appendProcessLog, orgId, runViaRest, sessionId],
  );

  const sendUserMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pending || resuming || interruptPayload) return;
      if (serviceAvailable === false) return;

      setTurns((prev) => [...prev, { id: nowId("user"), role: "user", text: trimmed }]);
      setPending(true);
      setLiveEvents([]);

      try {
        if (useStreaming) {
          await runViaWebSocket(trimmed);
        } else {
          await runViaRest(trimmed);
        }
      } catch (err: unknown) {
        setTurns((prev) => [
          ...prev,
          { id: nowId("error"), role: "error", text: getDeepAgentsErrorMessage(err) },
        ]);
      } finally {
        setPending(false);
      }
    },
    [interruptPayload, pending, resuming, runViaRest, runViaWebSocket, serviceAvailable, useStreaming],
  );

  async function handleHitlDecision(decision: Record<string, unknown>) {
    setPending(true);
    try {
      const res = await resumeWorkflow({ sessionId, body: { decision } });
      applyResponse(res);
    } catch (err: unknown) {
      setTurns((prev) => [
        ...prev,
        { id: nowId("error"), role: "error", text: getDeepAgentsErrorMessage(err) },
      ]);
    } finally {
      setPending(false);
    }
  }

  const busy = pending || resuming;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useImperativeHandle(
    ref,
    () => ({
      sendMessage: sendUserMessage,
      isBusy: busy,
      hasInterrupt: !!interruptPayload,
    }),
    [busy, interruptPayload, sendUserMessage],
  );

  const orchestratorDown = serviceAvailable === false;
  const missingOrg = !orgId?.trim();

  return (
    <div className="space-y-4">
      {orchestratorDown ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 leading-relaxed">
          Deep Agent service is not reachable. Use the unified gateway at{" "}
          <span className="font-mono">/backend/deep-agents</span> or set{" "}
          <span className="font-mono">DEEP_AGENTS_DEV_PROXY</span> in{" "}
          <span className="font-mono">.env.local</span> for local dev.
        </div>
      ) : null}
      {missingOrg ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-relaxed">
          Select an organization in the header before sending messages — tools need your org context.
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <Sparkles size={18} className="text-violet-700" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">DeepAgent orchestration</div>
            <div className="text-xs text-slate-500 font-mono truncate max-w-[240px]">
              Session {sessionId.slice(0, 8)}…
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
        >
          <RotateCcw size={13} />
          New session
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <div className="text-[11px] font-semibold text-slate-500 tracking-widest mb-2">TRY ASKING</div>
        <div className="flex flex-wrap gap-2">
          {STARTER_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy || !!interruptPayload || orchestratorDown || missingOrg}
              onClick={() => void sendUserMessage(p)}
              className="text-left text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50 max-w-full"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 max-h-[min(52vh,520px)] overflow-y-auto pr-1">
        {turns.map((t) => (
          <TurnBubble key={t.id} turn={t} />
        ))}
        {pending && !interruptPayload ? (
          <div className="flex gap-3">
            <div className="h-9 w-9 rounded-full bg-violet-600 text-white flex items-center justify-center shrink-0">
              <Bot size={16} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin text-indigo-600" />
              Orchestrating across CAFM agents…
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {interruptPayload ? (
        <DeepAgentHitlGate
          payload={interruptPayload}
          busy={busy}
          onApproveMapping={(d) => void handleHitlDecision(d)}
          onConfirmRollback={(d) => void handleHitlDecision(d)}
        />
      ) : null}

      {!interruptPayload && showInlineTrace ? (
        <DeepAgentToolTrace
          toolCalls={toolCalls}
          toolsCatalog={toolsCatalog}
          liveEvents={liveEvents}
        />
      ) : null}
    </div>
  );
});

function TurnBubble({ turn }: { turn: DeepAgentTurn }) {
  const isUser = turn.role === "user";
  const isError = turn.role === "error";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser ? (
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
            isError ? "bg-red-100 text-red-700" : "bg-violet-600 text-white"
          }`}
        >
          <Bot size={16} />
        </div>
      ) : null}
      <div
        className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
          isUser
            ? "bg-slate-900 text-white rounded-tr-sm whitespace-pre-wrap"
            : isError
              ? "bg-red-50 border border-red-200 text-red-800 rounded-tl-sm"
              : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm"
        }`}
      >
        {isUser ? turn.text : <ChatMarkdown text={turn.text} />}
      </div>
    </div>
  );
}

/** Health check helper for connection badge */
export async function checkDeepAgentsHealth() {
  try {
    return await deepAgentsApi.health();
  } catch {
    return null;
  }
}
