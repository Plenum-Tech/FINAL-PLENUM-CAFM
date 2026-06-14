"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Send,
  Loader2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  Clock3,
  Plus,
  MessageSquare,
  ScrollText,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui";
import { ChatMarkdown } from "@/components/chat-markdown";
import { APP_ROUTES } from "@/constants";
import type { ApiMessage, WoProcessLogEntry } from "@/app/api/wo-chat/route";
import { ApprovalWatcher } from "@/features/work-orders/new-wo-form";
import { QuickCreateWorkOrderInChat, PreparationInChatForm } from "@/features/work-orders/chat-inline-forms";
import { cn } from "@/utils/cn";

type DisplayMsg = { role: "user" | "assistant"; text: string };

function MessageBubble({ msg }: { msg: DisplayMsg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {!isUser ? (
        <div className="shrink-0 h-8 w-8 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center">
          <Bot size={14} className="text-indigo-600" />
        </div>
      ) : null}
      <div
        className={[
          "max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-gradient-to-br from-indigo-600 to-blue-600 text-white rounded-tr-sm"
            : "bg-white border border-slate-200 text-foreground rounded-tl-sm",
        ].join(" ")}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.text}</p>
        ) : (
          <ChatMarkdown text={msg.text} />
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 h-8 w-8 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center">
        <Bot size={14} className="text-indigo-600" />
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-3">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

const GREETING =
  "Hi! I can help you create, review, and update work orders. Tell me what needs to be done and where.";

const STARTER_PROMPTS = [
  "Create a high-priority HVAC repair for Building A roof, requested by John Smith (john@company.com).",
  "I got an email about an elevator fault in Tower B. Can you prepare a work order from it?",
  "Show me pending approval work orders before we create a new one.",
];

const SESSIONS_STORAGE_KEY = "wo-chat-sessions-v1";

type WoChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  displayMessages: DisplayMsg[];
  apiMessages: ApiMessage[];
  woId: string | null;
  processLog: WoProcessLogEntry[];
};

function newSession(): WoChatSession {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    updatedAt: Date.now(),
    displayMessages: [{ role: "assistant", text: GREETING }],
    apiMessages: [],
    woId: null,
    processLog: [],
  };
}

function loadStoredSessions(): WoChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WoChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSessions(sessions: WoChatSession[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions.slice(0, 40)));
}

function sessionTitleFromMessages(msgs: DisplayMsg[]): string {
  const firstUser = msgs.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  const t = firstUser.text.trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

/** Avoid SSR/client locale & timezone mismatches (React hydration #418). */
function useClientMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

function formatChatTimestamp(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatLogTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function ClientTimestamp({
  children,
  className,
}: {
  children: () => string;
  className?: string;
}) {
  const mounted = useClientMounted();
  return <span className={className}>{mounted ? children() : "\u00a0"}</span>;
}

function WoChatHistoryPanel({
  sessions,
  activeId,
  onSelect,
  onNew,
}: {
  sessions: WoChatSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MessageSquare size={16} className="text-indigo-600" />
            Chat history
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={onNew}>
            <Plus size={14} />
            New
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {sorted.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">No past chats yet.</p>
        ) : (
          sorted.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                s.id === activeId
                  ? "bg-indigo-50 border border-indigo-200"
                  : "hover:bg-slate-50 border border-transparent",
              )}
            >
              <div className="text-xs font-medium text-slate-800 truncate">{s.title}</div>
              <ClientTimestamp className="mt-0.5 text-[10px] text-muted-foreground block">
                {() => formatChatTimestamp(s.updatedAt)}
              </ClientTimestamp>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}


function logStatusIcon(status: WoProcessLogEntry["status"]) {
  if (status === "running") return <Loader2 size={14} className="text-indigo-600 shrink-0 mt-0.5 animate-spin" />;
  if (status === "success") return <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />;
  return <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />;
}

function logDetail(entry: WoProcessLogEntry): string {
  return entry.detail ?? (entry as { summary?: string }).summary ?? "";
}

function WoChatProcessLogPanel({
  entries,
  loading,
}: {
  entries: WoProcessLogEntry[];
  loading?: boolean;
}) {
  const logBottomRef = useRef<HTMLDivElement>(null);
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at) || (a.step ?? 0) - (b.step ?? 0));
  const completed = sorted.filter((e) => e.phase === "completed").length;

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, loading]);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ScrollText size={16} className="text-indigo-600" />
            Process log
          </div>
          {sorted.length > 0 ? (
            <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
              {completed} step{completed === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
          Tool invocations with request parameters, API responses, and duration.
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2.5 flex items-center gap-2 text-xs text-indigo-800">
            <Loader2 size={14} className="animate-spin shrink-0" />
            Running tools (Claude → work-order APIs)…
          </div>
        ) : null}
        {sorted.length === 0 && !loading ? (
          <p className="text-xs text-muted-foreground px-1 py-2 leading-relaxed">
            Send a message to see steps (search_assets, create_work_order, list_work_orders, etc.).
          </p>
        ) : sorted.length > 0 ? (
          sorted.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-xs",
                entry.phase === "started" && "border-indigo-100 bg-indigo-50/40",
                entry.phase === "completed" && entry.status === "success" && "border-emerald-100 bg-emerald-50/30",
                entry.phase === "completed" && entry.status === "error" && "border-red-100 bg-red-50/40",
                !entry.phase && "border-slate-200 bg-slate-50/80",
              )}
            >
              <div className="flex items-start gap-2">
                {logStatusIcon(entry.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {entry.step != null ? (
                      <span className="font-mono text-[10px] text-slate-500">#{entry.step}</span>
                    ) : null}
                    <span className="font-semibold text-slate-800">
                      {entry.title ?? entry.toolLabel ?? entry.tool}
                    </span>
                    {entry.durationMs != null ? (
                      <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                        {entry.durationMs}ms
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-slate-600 leading-snug">{logDetail(entry)}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground font-mono">{entry.tool}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    <ClientTimestamp className="inline">
                      {() => formatLogTime(entry.at)}
                    </ClientTimestamp>
                    {entry.phase === "started" ? " · invoked" : entry.phase === "completed" ? " · finished" : ""}
                  </p>
                  {entry.input && Object.keys(entry.input).length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] font-medium text-indigo-700 hover:text-indigo-900">
                        Request parameters
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all">
                        {JSON.stringify(entry.input, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                  {entry.output ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] font-medium text-indigo-700 hover:text-indigo-900">
                        API response
                      </summary>
                      <pre className="mt-1 max-h-52 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all">
                        {entry.output}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        ) : null}
        <div ref={logBottomRef} aria-hidden className="h-px shrink-0" />
      </div>
    </aside>
  );
}


export function WoChat({
  className,
  layout = "chat-only",
}: {
  className?: string;
  layout?: "workspace" | "chat-only";
}) {
  const router = useRouter();

  const [sessions, setSessions] = useState<WoChatSession[] | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStoredSessions();
    if (stored.length > 0) {
      setSessions(stored);
      setActiveSessionId(stored[0]!.id);
      return;
    }
    const session = newSession();
    setSessions([session]);
    setActiveSessionId(session.id);
  }, []);

  const activeSession =
    sessions?.find((s) => s.id === activeSessionId) ?? sessions?.[0] ?? null;
  const displayMessages = activeSession?.displayMessages ?? [];
  const apiMessages = activeSession?.apiMessages ?? [];
  const woId = activeSession?.woId ?? null;
  const processLog = activeSession?.processLog ?? [];

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (sessions) persistSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (!sessions) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions, displayMessages, loading, activeSessionId]);

  const activeId = activeSession?.id ?? "";

  function patchSession(sessionId: string, patch: Partial<WoChatSession>) {
    setSessions((prev) => {
      if (!prev) return prev;
      return prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              ...patch,
              updatedAt: Date.now(),
              title: patch.displayMessages
                ? sessionTitleFromMessages(patch.displayMessages)
                : s.title,
            }
          : s,
      );
    });
  }

  function startNewChat() {
    const session = newSession();
    setSessions((prev) => [session, ...(prev ?? [])]);
    setActiveSessionId(session.id);
    setInput("");
    setError(null);
  }

  function selectSession(id: string) {
    setActiveSessionId(id);
    setInput("");
    setError(null);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || woId || !activeId) return;

    const sessionId = activeId;
    setInput("");
    setError(null);
    const nextDisplay: DisplayMsg[] = [...displayMessages, { role: "user", text }];
    patchSession(sessionId, { displayMessages: nextDisplay });

    const nextApiMessages: ApiMessage[] = [...apiMessages, { role: "user", content: text }];
    setLoading(true);

    try {
      const res = await fetch("/api/wo-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextApiMessages }),
      });

      const data = (await res.json()) as {
        message?: string;
        messages?: ApiMessage[];
        woId?: string | null;
        processLog?: WoProcessLogEntry[];
        error?: string;
      };

      if (!res.ok || data.error) {
        setError(data.error ?? "Something went wrong. Please try again.");
        patchSession(sessionId, { displayMessages });
        setInput(text);
      } else {
        setSessions((prev) => {
          if (!prev) return prev;
          return prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  updatedAt: Date.now(),
                  title: sessionTitleFromMessages([
                    ...nextDisplay,
                    { role: "assistant", text: data.message ?? "" },
                  ]),
                  displayMessages: [
                    ...nextDisplay,
                    { role: "assistant", text: data.message ?? "" },
                  ],
                  apiMessages: data.messages ?? nextApiMessages,
                  woId: data.woId ?? s.woId,
                  processLog: [...s.processLog, ...(data.processLog ?? [])],
                }
              : s,
          );
        });
      }
    } catch {
      setError("Network error — please check your connection and try again.");
      patchSession(sessionId, { displayMessages });
      setInput(text);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }

  if (!sessions || !activeSession) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[480px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50",
          className,
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const isWorkspace = layout === "workspace";

  return (
    <div
      className={cn(
        isWorkspace
          ? "grid h-full min-h-[640px] gap-4 md:grid-cols-[minmax(200px,240px)_minmax(0,1fr)_minmax(280px,360px)]"
          : "flex h-full min-h-[480px] flex-col",
        className,
      )}
    >
      {isWorkspace ? (
      <div className="hidden md:flex min-h-0 flex-col">
        <WoChatHistoryPanel
          sessions={sessions}
          activeId={activeId}
          onSelect={selectSession}
          onNew={startNewChat}
        />
      </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-5 py-4 bg-white/80 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
                <Sparkles size={14} className="text-white" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">AI Work Order Concierge</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Create, review, and manage work orders through natural chat.
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white">
              <ShieldCheck size={12} className="text-emerald-600" />
              API-backed
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white">
              <Clock3 size={12} className="text-indigo-600" />
              Live workflow
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 py-4">
        {displayMessages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}

        {!woId && displayMessages.length <= 1 ? (
          <div className="pt-1">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Try one of these:</div>
            <div className="flex flex-col gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="text-left text-xs rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? <TypingIndicator /> : null}

        {woId ? (
          <div className="pt-2">
            <ApprovalWatcher
              woId={woId}
              onNavigate={() => router.push(`${APP_ROUTES.workOrders}/${woId}`)}
            />
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg border border-destructive/20 px-3 py-2.5">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {!woId ? (
        <div className="shrink-0 border-t border-slate-200 px-4 py-3 bg-white space-y-3">
          <QuickCreateWorkOrderInChat />
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the issue, or ask to list/update work orders..."
              rows={2}
              disabled={loading}
              className="flex-1 rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              size="sm"
              className="h-10 w-10 p-0 shrink-0 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700"
              aria-label="Send message"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </Button>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">Enter to send, Shift+Enter for newline.</div>
        </div>
      ) : null}
      </div>

      {isWorkspace ? (
      <div className="hidden md:flex min-h-0 flex-col">
        <WoChatProcessLogPanel entries={processLog} loading={loading} />
      </div>
      ) : null}
    </div>
  );
}

const detailIntroMessage = (workOrderId: string) =>
  `I'm focused on **${workOrderId}**. Ask me to approve, prepare, update fields, change status, check the journey, or close—I'll use the work-order APIs. Try a shortcut below or type what you need.`;

export function WoChatWorkOrderDetail({
  workOrderId,
  contextBlock,
  starterPrompts = [],
  onAfterReply,
  className,
  workOrderStatus,
}: {
  workOrderId: string;
  contextBlock: string;
  starterPrompts?: string[];
  onAfterReply?: () => void | Promise<void>;
  className?: string;
  /** When `preparing`, shows the same preparation fields as the detail page, inside the chat column. */
  workOrderStatus?: string;
}) {
  const [displayMessages, setDisplayMessages] = useState<DisplayMsg[]>([
    { role: "assistant", text: detailIntroMessage(workOrderId) },
  ]);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDisplayMessages([{ role: "assistant", text: detailIntroMessage(workOrderId) }]);
    setApiMessages([]);
    setInput("");
    setError(null);
  }, [workOrderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setDisplayMessages((prev) => [...prev, { role: "user", text }]);

    const apiPayload = `${contextBlock}\n\nUser message:\n${text}`;
    const nextApiMessages: ApiMessage[] = [...apiMessages, { role: "user", content: apiPayload }];
    setLoading(true);

    try {
      const res = await fetch("/api/wo-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextApiMessages }),
      });

      const data = (await res.json()) as {
        message?: string;
        messages?: ApiMessage[];
        error?: string;
      };

      if (!res.ok || data.error) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setDisplayMessages((prev) => prev.slice(0, -1));
        setInput(text);
      } else {
        setDisplayMessages((prev) => [...prev, { role: "assistant", text: data.message ?? "" }]);
        setApiMessages(data.messages ?? nextApiMessages);
        await onAfterReply?.();
      }
    } catch {
      setError("Network error — please check your connection and try again.");
      setDisplayMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const showStarters = displayMessages.length <= 1 && starterPrompts.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white shadow-md overflow-hidden",
        "min-h-[380px] h-[min(88vh,840px)] w-full xl:h-full xl:min-h-0",
        className,
      )}
    >
      <div className="shrink-0 border-b border-slate-200 px-5 py-4 bg-white/90 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
                <Sparkles size={16} className="text-white" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight">Workflow assistant</h2>
                <p className="text-[11px] text-muted-foreground font-mono">{workOrderId}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground max-w-prose">
              {workOrderStatus === "preparing"
                ? "Use the preparation form under the chat, or type requests—I'll call the same work-order APIs."
                : "Full lifecycle in chat: approvals, preparation, scheduling, status transitions, updates, journey checks, and close."}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white">
              <ShieldCheck size={12} className="text-emerald-600" />
              Actions via API
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 py-4">
        {displayMessages.map((m, i) => (
          <MessageBubble key={`${m.role}-${i}`} msg={m} />
        ))}

        {showStarters ? (
          <div className="pt-1">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Shortcuts</div>
            <div className="flex flex-col gap-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="text-left text-xs rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors leading-snug"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? <TypingIndicator /> : null}

        {error ? (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg border border-destructive/20 px-3 py-2.5">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {workOrderStatus === "preparing" ? (
        <div className="shrink-0 border-t border-amber-100 px-4 py-2 bg-amber-50/30">
          <PreparationInChatForm
            workOrderId={workOrderId}
            disabled={loading}
            onSuccess={onAfterReply}
          />
        </div>
      ) : null}

      <div className="shrink-0 border-t border-slate-200 px-4 py-3 bg-white">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Approve this WO, move it to active, update the vendor and schedule…"
            rows={3}
            disabled={loading}
            className="flex-1 rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 min-h-[5.5rem]"
          />
          <Button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || loading}
            size="sm"
            className="h-[5.5rem] w-12 p-0 shrink-0 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700"
            aria-label="Send message"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</div>
      </div>
    </div>
  );
}
