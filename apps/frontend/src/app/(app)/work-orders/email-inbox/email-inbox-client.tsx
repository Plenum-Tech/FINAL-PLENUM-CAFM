"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge, Button, Input, toast } from "@/components/ui";
import { cn } from "@/utils/cn";
import { EmailInboxDeepChat } from "@/features/work-orders/email-inbox-deep-chat";
import {
  buildWoSseUrl,
  getWoErrorMessage,
  type OutlookStatus,
  type EmailPollResult,
  woFetch,
} from "@/features/work-orders/wo-api";

// ─── Types ───────────────────────────────────────────────────────────────────

type Priority = "high" | "medium" | "low";

type EmailItem = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: string;
  read: boolean;
  priority: Priority;
};

type PipelineState = {
  status: "running" | "complete" | "error" | "warning";
  message: string;
};

const PIPELINE_STEP_LABELS: Record<string, string> = {
  email_received: "Email Received",
  classification: "AI Classification",
  parsing: "Field Extraction",
  db_lookup: "DB Lookup",
  ai_assessment: "AI Assessment",
  wo_create: "Work Order Created",
  journey_log: "Journey Log",
  notification: "Requester Notification",
  approval_request: "Approval Request Sent",
  waiting_approval: "Waiting Approval",
  technician_assigned: "Technician Assigned",
  notifications_sent: "Outcome Notifications Sent",
};

function EmailBodyPanel({ email }: { email: EmailItem }) {
  const [open, setOpen] = useState(true);
  const bodyText = (email.body?.trim() || email.preview?.trim() || "").trim();

  return (
    <div className="shrink-0 border-b border-border/60 bg-slate-50/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Email body
        </span>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="px-5 pb-4 max-h-[min(280px,35vh)] overflow-y-auto">
          {bodyText ? (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
              {bodyText}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No message body returned from Outlook.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function priorityVariant(p: Priority): "destructive" | "warning" | "secondary" {
  if (p === "high") return "destructive";
  if (p === "medium") return "warning";
  return "secondary";
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = MONTHS[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month}, ${hh}:${mm}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EmailInboxClient() {
  const [selected, setSelected] = useState<EmailItem | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineSteps, setPipelineSteps] = useState<Record<string, PipelineState>>({});
  const [pipelineResult, setPipelineResult] = useState<Record<string, unknown> | null>(null);

  // ── Real Outlook inbox via Microsoft Graph ──
  const inboxQuery = useQuery<EmailItem[]>({
    queryKey: ["outlook-inbox"],
    queryFn: () =>
      fetch("/api/outlook").then(async (res) => {
        const data = (await res.json()) as EmailItem[] | { error: string };
        if (!res.ok) throw new Error((data as { error: string }).error ?? `HTTP ${res.status}`);
        return data as EmailItem[];
      }),
    staleTime: 60_000,
    retry: false,
  });

  // ── Outlook connection status (backend) ──
  const outlookQuery = useQuery<OutlookStatus>({
    queryKey: ["outlook-status"],
    staleTime: 60_000,
    retry: false,
    queryFn: () => woFetch<OutlookStatus>("/api/email/status"),
  });

  // ── Poll inbox (backend auto-processes new emails → creates WOs) ──
  const pollMutation = useMutation<EmailPollResult>({
    mutationFn: () => woFetch<EmailPollResult>("/api/email/poll?max_emails=20", { method: "POST" }),
    onSuccess: (data) => {
      toast({
        title: `Polled: ${data.created} new WO${data.created !== 1 ? "s" : ""} created`,
        variant: "success",
      });
    },
    onError: (e) => {
      toast({ title: "Poll failed", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const emails = inboxQuery.data ?? [];

  const filteredEmails = emails.filter((e) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      e.subject.toLowerCase().includes(q) ||
      e.from.toLowerCase().includes(q) ||
      e.preview.toLowerCase().includes(q)
    );
  });

  function isUnread(email: EmailItem): boolean {
    return !email.read && !readIds.has(email.id);
  }

  function selectEmail(email: EmailItem) {
    setSelected(email);
    setReadIds((prev) => new Set([...prev, email.id]));
  }

  const unreadCount = emails.filter(isUnread).length;
  const outlookConnected = outlookQuery.data?.connected;

  async function runSamplePipeline(path: string) {
    setPipelineOpen(true);
    setPipelineBusy(true);
    setPipelineError(null);
    setPipelineResult(null);
    setPipelineSteps({});

    try {
      const streamUrl = buildWoSseUrl(path);
      const res = await fetch(streamUrl, { method: "POST", headers: { Accept: "text/event-stream" } });
      if (!res.ok || !res.body) {
        throw new Error(`Unable to start stream (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          if (raw === "[DONE]") continue;

          try {
            const evt = JSON.parse(raw) as {
              step?: string;
              status?: "running" | "complete" | "error" | "warning";
              message?: string;
              result?: Record<string, unknown>;
            };

            if (evt.step === "done") {
              setPipelineResult(evt.result ?? null);
              continue;
            }

            const step = evt.step;
            const status = evt.status;

            if (step && status) {
              setPipelineSteps((prev) => ({
                ...prev,
                [step]: {
                  status,
                  message: evt.message ?? "",
                },
              }));
            }
          } catch {
            // Ignore malformed SSE chunks
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to run sample pipeline";
      setPipelineError(message);
    } finally {
      setPipelineBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] gap-3">
      {/* Backend Outlook status banner */}
      {outlookQuery.isSuccess && (
        <div className={["flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm", outlookConnected ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"].join(" ")}>
          <div className="flex items-center gap-2">
            {outlookConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {outlookConnected ? (
              <span>Outlook connected as <strong>{outlookQuery.data?.display_name ?? outlookQuery.data?.email}</strong></span>
            ) : (
              <span>Outlook disconnected — {outlookQuery.data?.error ?? "token invalid"}</span>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs border-current/30" disabled={pollMutation.isPending} onClick={() => pollMutation.mutate()}>
            {pollMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Poll Now
          </Button>
        </div>
      )}

      {/* Graph API token error banner */}
      {inboxQuery.isError && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1 truncate">
            {inboxQuery.error instanceof Error ? inboxQuery.error.message : "Could not load inbox"}
          </span>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs border-amber-300 shrink-0" onClick={() => inboxQuery.refetch()}>
            <RefreshCw size={12} />
            Retry
          </Button>
        </div>
      )}

      {/* Main panel */}
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Email Pipeline Playground</div>
            <div className="text-xs text-muted-foreground">
              Runs sample email flow from backend docs/reference implementation.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              disabled={pipelineBusy}
              onClick={() => void runSamplePipeline("/api/email/process/sample/stream")}
            >
              {pipelineBusy ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
              Process Sample
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              disabled={pipelineBusy}
              onClick={() => void runSamplePipeline("/api/email/process/sample/missing-info/stream")}
            >
              {pipelineBusy ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
              Missing Info Test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setPipelineOpen((v) => !v)}
            >
              {pipelineOpen ? "Hide" : "Show"} Flow
            </Button>
          </div>
        </div>

        {pipelineOpen && (
          <div className="mt-3 rounded-lg border bg-muted/20 p-3 space-y-2">
            {pipelineError && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-md px-2 py-1.5">
                {pipelineError}
              </div>
            )}
            {Object.entries(pipelineSteps).length === 0 && !pipelineError && (
              <div className="text-xs text-muted-foreground">Run a sample to see live pipeline events.</div>
            )}
            {Object.entries(pipelineSteps).map(([step, state]) => (
              <div key={step} className="flex items-start justify-between gap-3 text-xs">
                <div className="font-medium">
                  {PIPELINE_STEP_LABELS[step] ?? step.replace(/_/g, " ")}
                </div>
                <div
                  className={[
                    "rounded-full px-2 py-0.5 capitalize",
                    state.status === "complete"
                      ? "bg-green-100 text-green-700"
                      : state.status === "error"
                        ? "bg-red-100 text-red-700"
                        : state.status === "warning"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700",
                  ].join(" ")}
                >
                  {state.status}
                </div>
              </div>
            ))}
            {pipelineResult && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Result:{" "}
                <span className="font-mono">
                  {String(pipelineResult.work_order_id ?? pipelineResult.status ?? "completed")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {/* Left — email list */}
        <div className="w-[300px] shrink-0 flex flex-col border-r border-border/60">
          <div className="px-4 py-3 border-b border-border/60 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Inbox size={15} className="text-muted-foreground" />
                <span className="text-sm font-semibold">Inbox</span>
                {unreadCount > 0 && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={inboxQuery.isFetching}
                onClick={() => inboxQuery.refetch()}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                aria-label="Refresh inbox"
              >
                <RefreshCw size={13} className={inboxQuery.isFetching ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8 text-xs" placeholder="Search emails…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/50">
            {inboxQuery.isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="text-muted-foreground animate-spin" />
              </div>
            )}

            {filteredEmails.map((email) => {
              const unread = isUnread(email);
              const isActive = selected?.id === email.id;
              return (
                <button
                  key={email.id}
                  type="button"
                  onClick={() => selectEmail(email)}
                  className={["w-full text-left px-4 py-3.5 hover:bg-muted/40 transition-colors block", isActive ? "bg-muted/60" : ""].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${unread ? "bg-indigo-600" : "bg-transparent"}`} />
                      <span className={["text-sm truncate", unread ? "font-semibold" : "font-medium text-muted-foreground"].join(" ")}>
                        {email.from}
                      </span>
                    </div>
                    <span suppressHydrationWarning className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                      {timeAgo(email.receivedAt)}
                    </span>
                  </div>
                  <div className={["text-xs mt-0.5 truncate pl-3.5", unread ? "font-semibold text-foreground" : "text-muted-foreground"].join(" ")}>
                    {email.subject}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1 pl-3.5">
                    <p className="text-[11px] text-muted-foreground truncate flex-1">{email.preview}</p>
                    <Badge variant={priorityVariant(email.priority)} className="text-[9px] px-1.5 py-0 shrink-0 capitalize">
                      {email.priority}
                    </Badge>
                  </div>
                </button>
              );
            })}

            {!inboxQuery.isLoading && !inboxQuery.isError && filteredEmails.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Mail size={28} className="opacity-30" />
                <span className="text-sm">{search ? "No emails found" : "Inbox is empty"}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right — email chat */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              {/* Email header */}
              <div className="px-5 py-3.5 border-b border-border/60 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-foreground truncate">{selected.subject}</h2>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {readIds.has(selected.id) ? <MailOpen size={11} /> : <Mail size={11} />}
                        <span className="font-medium text-foreground/80">{selected.from}</span>
                        <span className="hidden sm:inline">&lt;{selected.fromEmail}&gt;</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock size={10} />
                        <span suppressHydrationWarning>{formatDate(selected.receivedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant={priorityVariant(selected.priority)} className="capitalize shrink-0 text-xs">
                    {selected.priority}
                  </Badge>
                </div>
              </div>

              <EmailBodyPanel email={selected} />

              {/* Chat — remounts fresh for each email via key */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <EmailInboxDeepChat key={selected.id} email={selected} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Mail size={40} className="opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Select an email to process</p>
                <p className="text-xs opacity-60">The AI assistant will analyze it and help you create a work order</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
