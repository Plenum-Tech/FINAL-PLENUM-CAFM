"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bot, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui";
import { ChatMarkdown } from "@/components/chat-markdown";
import { APP_ROUTES } from "@/constants";
import { env } from "@/config";
import { useDeepAgentsHealth } from "@/features/ai/deep-agents-api";
import { DeepAgentApprovalErrorPanel } from "@/features/ai/pipeline/deep-agent/deep-agent-approval-error";
import { DeepAgentApprovalPanel } from "@/features/ai/pipeline/deep-agent/deep-agent-approval-panel";
import { extractWorkOrderIdFromToolCalls } from "@/features/ai/pipeline/deep-agent/approval-suggestion-parse";
import {
  DEEP_AGENT_TURNS_STORAGE_KEY,
  useDeepAgentOrchestrator,
  type DeepAgentTurn,
} from "@/features/ai/pipeline/deep-agent/use-deep-agent-orchestrator";
import { useOrganizationStore } from "@/store/organizationStore";
import { cn } from "@/utils/cn";

import { buildWoSseUrl } from "./wo-api";

// ─── Types (match email-inbox-client) ─────────────────────────────────────────

export type EmailInboxItem = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: string;
  read: boolean;
  priority: "high" | "medium" | "low";
};

function emailSessionId(emailId: string): string {
  return `email-inbox-${emailId}`;
}

function loadTurnsCount(sessionId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DEEP_AGENT_TURNS_STORAGE_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw) as Record<string, DeepAgentTurn[]>;
    return map[sessionId]?.length ?? 0;
  } catch {
    return 0;
  }
}

function buildEmailAnalysisMessage(email: EmailInboxItem): string {
  return [
    "Here is a maintenance request email. Analyze it, extract all required work order fields,",
    "present them clearly for my review, and only create the work order after I explicitly confirm.",
    "After creation, show the suggested approval chain from the tool result (approver names and roles).",
    "When I confirm approval, request the approval chain and send the step 1 approval email via Outlook.",
    "",
    `From: ${email.from} <${email.fromEmail}>`,
    `Subject: ${email.subject}`,
    "",
    email.body || email.preview,
  ].join("\n");
}

function TurnBubble({ turn }: { turn: DeepAgentTurn }) {
  const isUser = turn.role === "user";
  const isError = turn.role === "error";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {!isUser && (
        <div className="shrink-0 h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center">
          <Bot size={13} className="text-blue-600" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser && "bg-primary text-primary-foreground rounded-tr-sm",
          !isUser && !isError && "bg-muted/70 text-foreground rounded-tl-sm",
          isError && "bg-destructive/10 text-destructive rounded-tl-sm border border-destructive/20",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{turn.text}</p>
        ) : (
          <ChatMarkdown text={turn.text} />
        )}
      </div>
    </div>
  );
}

// ─── Approval watcher (SSE from work-order service) ───────────────────────────

type WatchStep = {
  key: string;
  label: string;
  state: "pending" | "running" | "done" | "error" | "warning";
  message?: string;
  technicianName?: string;
};

function ApprovalWatcher({
  workOrderId,
  onDone,
}: {
  workOrderId: string;
  onDone: (woId: string) => void;
}) {
  const [steps, setSteps] = useState<WatchStep[]>([
    { key: "waiting_approval", label: "Awaiting manager approval", state: "running" },
    { key: "technician_assigned", label: "Technician assignment", state: "pending" },
    { key: "notifications_sent", label: "Outcome notifications", state: "pending" },
  ]);

  useEffect(() => {
    const url = buildWoSseUrl(`/api/email/watch/${encodeURIComponent(workOrderId)}`);
    const es = new EventSource(url);

    es.onmessage = (event) => {
      if (event.data === "[DONE]") {
        es.close();
        return;
      }
      try {
        const payload = JSON.parse(event.data) as {
          step?: string;
          status?: string;
          message?: string;
          data?: { technician_name?: string };
        };
        setSteps((prev) =>
          prev.map((s) => {
            if (s.key === payload.step) {
              if (payload.status === "complete") {
                return {
                  ...s,
                  state: "done",
                  message: payload.message,
                  technicianName: payload.data?.technician_name,
                };
              }
              if (payload.status === "error") return { ...s, state: "error", message: payload.message };
              if (payload.status === "warning") return { ...s, state: "warning", message: payload.message };
              return { ...s, state: "running", message: payload.message };
            }
            if (payload.step === "waiting_approval" && payload.status === "complete" && s.key === "technician_assigned") {
              return { ...s, state: "running" };
            }
            if (payload.step === "technician_assigned" && payload.status === "complete" && s.key === "notifications_sent") {
              return { ...s, state: "running" };
            }
            return s;
          }),
        );
        if (payload.step === "notifications_sent" && payload.status === "complete") {
          setTimeout(() => onDone(workOrderId), 1500);
        }
      } catch {
        /* ignore */
      }
    };

    es.onerror = () => es.close();
    return () => es.close();
  }, [workOrderId, onDone]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-2">
      <p className="text-xs font-semibold text-blue-800">Work order journey — {workOrderId}</p>
      {steps.map((s) => (
        <div key={s.key} className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              s.state === "done" ? "bg-green-500" : s.state === "running" ? "bg-blue-500 animate-pulse" : "bg-slate-300",
            )}
          />
          <span className="font-medium">{s.label}</span>
          {s.technicianName ? <span className="text-green-700">({s.technicianName})</span> : null}
        </div>
      ))}
    </div>
  );
}

// ─── Main email chat (Deep Agent orchestrator) ──────────────────────────────────

export function EmailInboxDeepChat({ email }: { email: EmailInboxItem }) {
  const router = useRouter();
  const sessionId = useMemo(() => emailSessionId(email.id), [email.id]);
  const orgFromStore = useOrganizationStore((s) => s.selected?.id ?? "");
  const orgId = orgFromStore || env.organizationId || "";

  const { data: health, isLoading: healthLoading, isError: healthError } = useDeepAgentsHealth({
    enabled: true,
  });
  const serviceAvailable = healthLoading ? null : !healthError && !!health;

  const orch = useDeepAgentOrchestrator({
    sessionId,
    orgId: orgId || undefined,
    serviceAvailable,
    useStreaming: true,
  });

  const [composer, setComposer] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workOrderId = useMemo(() => {
    const fromInsight = orch.approvalInsight?.workOrderId;
    if (fromInsight) return fromInsight;
    return extractWorkOrderIdFromToolCalls(orch.toolCalls);
  }, [orch.approvalInsight, orch.toolCalls]);

  const hasPriorChat = useMemo(() => loadTurnsCount(sessionId) > 1, [sessionId]);
  const autoStartedForEmail = useRef<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [orch.turns, orch.pending, orch.approvalInsight, workOrderId]);

  // First open: analyze email. Return visits: restore turns from localStorage only.
  useEffect(() => {
    if (serviceAvailable !== true) return;
    if (autoStartedForEmail.current === email.id) return;
    autoStartedForEmail.current = email.id;
    if (hasPriorChat) return;
    const prompt = buildEmailAnalysisMessage(email);
    void orch.sendMessage(prompt);
  }, [email.id, sessionId, serviceAvailable, hasPriorChat]);

  const canSend =
    !!composer.trim() &&
    serviceAvailable !== false &&
    !orch.busy &&
    !orch.interruptPayload;

  function handleSend() {
    const text = composer.trim();
    if (!canSend) return;
    setComposer("");
    void orch.sendMessage(text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const displayTurns =
    serviceAvailable === false
      ? orch.turns.map((t) =>
          t.id === "greeting"
            ? {
                ...t,
                text: "Deep Agent service is offline. Ensure svc-deepagents is running and /backend/deep-agents is reachable.",
              }
            : t,
        )
      : orch.turns;

  const showGreetingOnly = displayTurns.length <= 1 && !orch.pending && !hasPriorChat;

  return (
    <div className="flex flex-col h-full">
      {hasPriorChat ? (
        <div className="shrink-0 px-4 py-2 border-b bg-slate-50 text-[11px] text-muted-foreground">
          Restored chat history for this email. Continue with approval or ask for work order status.
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto space-y-4 px-5 py-4">
        {showGreetingOnly ? (
          <div className="text-sm text-muted-foreground">
            Analyzing email: <strong>{email.subject}</strong>…
          </div>
        ) : null}

        {displayTurns
          .filter((t) => t.id !== "greeting" || displayTurns.length === 1)
          .map((t) => (
            <TurnBubble key={t.id} turn={t} />
          ))}

        {orch.pending && !orch.interruptPayload ? (
          <div className="flex gap-2.5 items-center text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Processing…
          </div>
        ) : null}

        {orch.approvalToolError ? <DeepAgentApprovalErrorPanel error={orch.approvalToolError} /> : null}

        {orch.approvalInsight && !orch.approvalToolError ? (
          <DeepAgentApprovalPanel insight={orch.approvalInsight} />
        ) : null}

        {workOrderId ? (
          <div className="space-y-2">
            <ApprovalWatcher
              workOrderId={workOrderId}
              onDone={(id) => router.push(`${APP_ROUTES.workOrders}/${id}`)}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs"
              onClick={() => router.push(`${APP_ROUTES.workOrders}/${workOrderId}`)}
            >
              View work order {workOrderId}
            </Button>
          </div>
        ) : null}

        {serviceAvailable === false ? (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2.5">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            Orchestrator unavailable — restart svc-deepagents or check gateway routing.
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <div className="border-t px-4 py-3 flex gap-2 items-end shrink-0 bg-white">
        <textarea
          ref={textareaRef}
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            workOrderId
              ? 'Confirm approval (e.g. "yes, send approval email") or ask for status…'
              : "Reply to confirm create, adjust fields, or ask questions…"
          }
          rows={2}
          disabled={!canSend && serviceAvailable !== false}
          className="flex-1 rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          size="sm"
          className="h-10 w-10 p-0 shrink-0 rounded-xl"
          aria-label="Send message"
        >
          {orch.busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground px-4 pb-2">
        Same orchestrator as AI → Orchestrator: create WO, approval chain, and email notifications.
        Chat is saved per email when you return.
      </p>
    </div>
  );
}
