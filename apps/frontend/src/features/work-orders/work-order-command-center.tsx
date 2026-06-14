"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  Mail,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Wifi,
  WifiOff,
  Wrench,
  XCircle,
} from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import {
  type DashboardStats,
  type EmailPollResult,
  type OutlookStatus,
  type WorkOrderResponse,
  getWoErrorMessage,
  woFetch,
} from "@/features/work-orders/wo-api";

type StepStatus = "running" | "complete" | "error" | "warning";
type PipelineStep = { status: StepStatus; message: string };
type FlowResult = Record<string, unknown> | null;
type PpmDueRow = { asset_name?: string; asset?: string; location?: string; frequency?: string };
type WoHealth = { status?: string; service?: string };
const QUERY_RETRY_LIMIT = 4;

function queryRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 20_000);
}

const STATUS_ORDER = [
  "pending_approval",
  "preparing",
  "prepared",
  "active",
  "completed",
  "closed",
] as const;

const LIFECYCLE_META: Record<
  (typeof STATUS_ORDER)[number],
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending_approval: { label: "Pending Approval", tone: "bg-amber-100 text-amber-700", icon: Clock },
  preparing: { label: "Preparing", tone: "bg-blue-100 text-blue-700", icon: Wrench },
  prepared: { label: "Prepared", tone: "bg-cyan-100 text-cyan-700", icon: CheckCircle2 },
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-700", icon: Activity },
  completed: { label: "Completed", tone: "bg-teal-100 text-teal-700", icon: ShieldCheck },
  closed: { label: "Closed", tone: "bg-slate-100 text-slate-700", icon: XCircle },
};

const STEP_ORDER = [
  "email_received",
  "classification",
  "parsing",
  "db_lookup",
  "ai_assessment",
  "wo_create",
  "journey_log",
  "notification",
  "approval_request",
  "waiting_approval",
  "technician_assigned",
  "notifications_sent",
] as const;

const STEP_LABELS: Record<(typeof STEP_ORDER)[number], string> = {
  email_received: "Email Received",
  classification: "AI Classification",
  parsing: "Field Extraction",
  db_lookup: "DB Lookup",
  ai_assessment: "AI Assessment",
  wo_create: "Create Work Order",
  journey_log: "Journey Log",
  notification: "Notify Requester",
  approval_request: "Approval Request",
  waiting_approval: "Waiting Approval",
  technician_assigned: "Technician Assigned",
  notifications_sent: "Notifications Sent",
};

const AI_BLOCK_KEYS = [
  "criticality",
  "safety",
  "compliance",
  "location",
  "asset_intelligence",
  "site_clearance",
  "parts_list",
  "inventory",
  "vendors",
  "technician",
  "schedule",
  "workspace_pin",
  "journey",
] as const;

function statusBadge(status: StepStatus) {
  if (status === "complete") return "bg-green-100 text-green-700";
  if (status === "error") return "bg-red-100 text-red-700";
  if (status === "warning") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

function formatStatusLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sourceBreakdown(stats?: DashboardStats) {
  if (!stats) return [];
  return Object.entries(stats.by_source ?? {}).sort((a, b) => b[1] - a[1]);
}

function priorityBreakdown(stats?: DashboardStats) {
  if (!stats) return [];
  return Object.entries(stats.by_priority ?? {}).sort((a, b) => b[1] - a[1]);
}

function parseIds(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function WorkOrderCommandCenter() {
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [steps, setSteps] = useState<Record<string, PipelineStep>>({});
  const [flowResult, setFlowResult] = useState<FlowResult>(null);
  const [runningFlow, setRunningFlow] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [selectedAiBlock, setSelectedAiBlock] = useState<string | null>(null);
  const [ppmDuePreview, setPpmDuePreview] = useState<PpmDueRow[] | null>(null);

  const [approvalRequestId, setApprovalRequestId] = useState("");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalDecision, setApprovalDecision] = useState<"approve" | "reject">("approve");

  const [bulkIdsRaw, setBulkIdsRaw] = useState("");
  const [bulkNewStatus, setBulkNewStatus] = useState("closed");
  const [bulkNotes, setBulkNotes] = useState("");

  const statsQuery = useQuery<DashboardStats>({
    queryKey: ["wo-cc-stats"],
    queryFn: () => woFetch<DashboardStats>("/api/dashboard/stats"),
    staleTime: 30_000,
    retry: QUERY_RETRY_LIMIT,
    retryDelay: queryRetryDelay,
  });

  const emailStatusQuery = useQuery<OutlookStatus>({
    queryKey: ["wo-cc-email-status"],
    queryFn: () => woFetch<OutlookStatus>("/api/email/status"),
    staleTime: 30_000,
    retry: QUERY_RETRY_LIMIT,
    retryDelay: queryRetryDelay,
  });

  const healthQuery = useQuery<WoHealth>({
    queryKey: ["wo-cc-health"],
    queryFn: () => woFetch<WoHealth>("/health"),
    staleTime: 30_000,
    retry: QUERY_RETRY_LIMIT,
    retryDelay: queryRetryDelay,
  });

  const workOrdersQuery = useQuery<WorkOrderResponse[]>({
    queryKey: ["wo-cc-list", filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (filterStatus) params.set("status", filterStatus);
      return woFetch<WorkOrderResponse[]>(`/api/work-orders/?${params.toString()}`);
    },
    staleTime: 10_000,
    retry: QUERY_RETRY_LIMIT,
    retryDelay: queryRetryDelay,
  });

  const [showHealthDropBanner, setShowHealthDropBanner] = useState(false);
  const [healthDropAt, setHealthDropAt] = useState<number | null>(null);
  const wasHealthyRef = useRef<boolean | null>(null);

  const isApiHealthy = healthQuery.isSuccess && healthQuery.data?.status === "ok";
  const hasHealthSignal = healthQuery.isSuccess || healthQuery.isError;

  useEffect(() => {
    if (!hasHealthSignal) return;
    const prev = wasHealthyRef.current;
    const curr = isApiHealthy;

    if (prev === true && curr === false) {
      setShowHealthDropBanner(true);
      setHealthDropAt(Date.now());
    }

    if (curr) {
      setShowHealthDropBanner(false);
      setHealthDropAt(null);
    }

    wasHealthyRef.current = curr;
  }, [hasHealthSignal, isApiHealthy]);

  const pollMutation = useMutation<EmailPollResult>({
    mutationFn: () => woFetch<EmailPollResult>("/api/email/poll?max_emails=20", { method: "POST" }),
    onSuccess: (data) => {
      toast({
        title: `Inbox polled: ${data.created} created, ${data.approved} approved, ${data.rejected} rejected`,
        variant: "success",
      });
      void Promise.all([statsQuery.refetch(), workOrdersQuery.refetch()]);
    },
    onError: (e) => {
      toast({ title: "Inbox poll failed", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const ppmDueMutation = useMutation<PpmDueRow[]>({
    mutationFn: () => woFetch<PpmDueRow[]>("/api/ppm/due"),
    onSuccess: (rows) => {
      setPpmDuePreview(rows.slice(0, 6));
      toast({ title: `PPM due schedules: ${rows.length}`, variant: "success" });
    },
    onError: (e) => {
      toast({ title: "PPM due check failed", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const runPpmMutation = useMutation<{ created: string[] }>({
    mutationFn: () => woFetch<{ created: string[] }>("/api/ppm/run", { method: "POST" }),
    onSuccess: (data) => {
      toast({
        title: data.created.length
          ? `PPM run created ${data.created.length} WO${data.created.length === 1 ? "" : "s"}`
          : "PPM run complete (no new work orders)",
        variant: "success",
      });
      void Promise.all([statsQuery.refetch(), workOrdersQuery.refetch()]);
    },
    onError: (e) => {
      toast({ title: "PPM run failed", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const approvalMutation = useMutation<unknown>({
    mutationFn: () => {
      const params = new URLSearchParams();
      params.set("approved", String(approvalDecision === "approve"));
      if (approvalNotes.trim()) params.set("notes", approvalNotes.trim());
      return woFetch(
        `/api/work-orders/approvals/${encodeURIComponent(approvalRequestId.trim())}/respond?${params.toString()}`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      toast({ title: "Approval response submitted", variant: "success" });
      setApprovalRequestId("");
      setApprovalNotes("");
    },
    onError: (e) => {
      toast({
        title: "Approval response failed",
        description: getWoErrorMessage(e),
        variant: "destructive",
      });
    },
  });

  const bulkMutation = useMutation<{
    updated?: number;
    failed?: number;
    failed_details?: Array<{ work_order_id: string; reason: string }>;
  }>({
    mutationFn: () =>
      woFetch("/api/work-orders/bulk/status", {
        method: "PATCH",
        body: {
          work_order_ids: parseIds(bulkIdsRaw),
          new_status: bulkNewStatus,
          notes: bulkNotes.trim() || undefined,
        },
      }),
    onSuccess: (data) => {
      const updated = data.updated ?? 0;
      const failed = data.failed ?? 0;
      toast({
        title: `Bulk update: ${updated} updated, ${failed} failed`,
        variant: failed > 0 ? "destructive" : "success",
      });
      void Promise.all([statsQuery.refetch(), workOrdersQuery.refetch()]);
    },
    onError: (e) => {
      toast({ title: "Bulk update failed", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  async function runSampleFlow(path: string) {
    setRunningFlow(true);
    setFlowError(null);
    setFlowResult(null);
    setSteps({});

    try {
      const res = await fetch(path, { method: "POST", headers: { Accept: "text/event-stream" } });
      if (!res.ok || !res.body) throw new Error(`Unable to run flow (${res.status})`);

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
          if (!raw || raw === "[DONE]") continue;

          try {
            const evt = JSON.parse(raw) as {
              step?: string;
              status?: StepStatus;
              message?: string;
              result?: Record<string, unknown>;
            };
            if (evt.step === "done") {
              setFlowResult(evt.result ?? null);
              continue;
            }
            const step = evt.step;
            const status = evt.status;
            if (step && status) {
              setSteps((prev) => ({
                ...prev,
                [step]: { status, message: evt.message ?? "" },
              }));
            }
          } catch {
            // Ignore malformed chunk
          }
        }
      }

      void Promise.all([statsQuery.refetch(), workOrdersQuery.refetch()]);
    } catch (e) {
      setFlowError(e instanceof Error ? e.message : "Flow failed");
    } finally {
      setRunningFlow(false);
    }
  }

  const aiDetails = useMemo(() => {
    const payload = flowResult ?? {};
    const full =
      typeof payload.full_assessment === "object" && payload.full_assessment !== null
        ? (payload.full_assessment as Record<string, unknown>)
        : null;
    const summary =
      typeof payload.assessment_summary === "object" && payload.assessment_summary !== null
        ? (payload.assessment_summary as Record<string, unknown>)
        : null;
    return { full, summary };
  }, [flowResult]);

  const selectedAiValue = useMemo(() => {
    if (!selectedAiBlock) return null;
    return (aiDetails.full && aiDetails.full[selectedAiBlock]) ?? (aiDetails.summary && aiDetails.summary[selectedAiBlock]) ?? null;
  }, [aiDetails.full, aiDetails.summary, selectedAiBlock]);

  const sourceStats = sourceBreakdown(statsQuery.data);
  const priorityStats = priorityBreakdown(statsQuery.data);

  const isRefreshing =
    statsQuery.isFetching ||
    emailStatusQuery.isFetching ||
    healthQuery.isFetching ||
    workOrdersQuery.isFetching ||
    pollMutation.isPending ||
    runningFlow;

  return (
    <div className="space-y-5">
      {showHealthDropBanner ? (
        <div className="sticky top-2 z-30 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-amber-800">
              <span className="font-semibold">Backend connectivity degraded.</span>{" "}
              Command Center is retrying failed sections with backoff.
              {healthDropAt ? (
                <span className="text-amber-700/90"> Detected at {new Date(healthDropAt).toLocaleTimeString()}.</span>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-800 hover:bg-amber-100"
              onClick={() => {
                void Promise.all([
                  statsQuery.refetch(),
                  emailStatusQuery.refetch(),
                  healthQuery.refetch(),
                  workOrdersQuery.refetch(),
                ]);
              }}
            >
              Retry Now
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_420px]">
        <div className="space-y-5">
      <Card className="shadow-sm">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
                <Database size={12} />
                Live Operations Console
              </div>
              <h1 className="text-2xl font-bold mt-3">Work Order Command Center</h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                End-to-end control room for lifecycle tracking, email automation, AI pipeline monitoring, PPM triggers, and admin actions.
              </p>
            </div>
            <Button
              variant="outline"
              className="gap-2"
              disabled={isRefreshing}
              onClick={() => {
                void Promise.all([
                  statsQuery.refetch(),
                  emailStatusQuery.refetch(),
                  healthQuery.refetch(),
                  workOrdersQuery.refetch(),
                ]);
              }}
            >
              {isRefreshing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-5">
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Total Work Orders</div>
              <div className="text-2xl font-bold mt-1">{statsQuery.data?.total ?? "-"}</div>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Pending Approval</div>
              <div className="text-2xl font-bold mt-1">{statsQuery.data?.by_status.pending_approval ?? 0}</div>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Active</div>
              <div className="text-2xl font-bold mt-1">{statsQuery.data?.by_status.active ?? 0}</div>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Service + Outlook</div>
              <div className="text-sm font-semibold mt-1 inline-flex items-center gap-1.5">
                {healthQuery.isSuccess && healthQuery.data?.status === "ok" ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 size={13} />
                    API Up
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-700">
                    <XCircle size={13} />
                    API Down
                  </span>
                )}
                <span className="text-muted-foreground">•</span>
                {emailStatusQuery.data?.connected ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <Wifi size={13} />
                    Outlook OK
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <WifiOff size={13} />
                    Outlook Off
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp size={15} />
              Lifecycle Control Board
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {STATUS_ORDER.map((statusKey) => {
                const meta = LIFECYCLE_META[statusKey];
                const Icon = meta.icon;
                const count = statsQuery.data?.by_status[statusKey] ?? 0;
                const active = filterStatus === statusKey;
                return (
                  <button
                    key={statusKey}
                    type="button"
                    onClick={() => setFilterStatus(active ? "" : statusKey)}
                    className={[
                      "rounded-xl border p-3 text-left transition-colors",
                      active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${meta.tone}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {meta.label}
                      </span>
                      <span className="text-xl font-bold">{count}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-2">
                      Click to {active ? "clear filter" : "focus queue"}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold mb-2">Source Breakdown</div>
                <div className="space-y-2">
                  {sourceStats.map(([key, value]) => (
                    <div key={key} className="text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="capitalize text-muted-foreground">{key}</span>
                        <span className="font-semibold">{value}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-indigo-500"
                          style={{
                            width: `${statsQuery.data?.total ? Math.min(100, (value / statsQuery.data.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold mb-2">Priority Breakdown</div>
                <div className="space-y-2">
                  {priorityStats.map(([key, value]) => (
                    <div key={key} className="text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="capitalize text-muted-foreground">{key}</span>
                        <span className="font-semibold">{value}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-amber-500"
                          style={{
                            width: `${statsQuery.data?.total ? Math.min(100, (value / statsQuery.data.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Mail size={15} />
              Runtime Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Button className="w-full justify-start gap-2" disabled={runningFlow} onClick={() => void runSampleFlow("/api/email/process/sample/stream")}>
              {runningFlow ? <RefreshCw size={14} className="animate-spin" /> : <Mail size={14} />}
              Process Sample Email
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={runningFlow}
              onClick={() => void runSampleFlow("/api/email/process/sample/missing-info/stream")}
            >
              {runningFlow ? <RefreshCw size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
              Run Missing-Info Flow
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" disabled={pollMutation.isPending} onClick={() => pollMutation.mutate()}>
              {pollMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Clock size={14} />}
              Poll Inbox Now
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" disabled={ppmDueMutation.isPending} onClick={() => ppmDueMutation.mutate()}>
              {ppmDueMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <CalendarClock size={14} />}
              Check PPM Due
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" disabled={runPpmMutation.isPending} onClick={() => runPpmMutation.mutate()}>
              {runPpmMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Wrench size={14} />}
              Run PPM Scheduler
            </Button>

            {ppmDuePreview?.length ? (
              <div className="rounded-md border bg-muted/20 p-2 text-[11px]">
                <div className="font-semibold mb-1">PPM Due Preview</div>
                <div className="space-y-1">
                  {ppmDuePreview.map((item, idx) => (
                    <div key={`${item.asset_name ?? item.asset ?? "asset"}-${idx}`} className="truncate">
                      {(item.asset_name ?? item.asset ?? "Asset").toString()}
                      {item.frequency ? ` • ${item.frequency}` : ""}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={15} />
              Live Pipeline Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {flowError ? (
              <div className="rounded-md bg-destructive/10 text-destructive text-xs px-3 py-2">{flowError}</div>
            ) : null}

            {Object.keys(steps).length === 0 ? (
              <div className="text-sm text-muted-foreground">Run a sample flow to stream events in real time.</div>
            ) : (
              <div className="space-y-2">
                {STEP_ORDER.map((key) => {
                  const s = steps[key];
                  if (!s) return null;
                  return (
                    <div key={key} className="rounded-lg border p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold">{STEP_LABELS[key]}</div>
                        <span className={`text-[10px] rounded-full px-2 py-0.5 ${statusBadge(s.status)}`}>
                          {s.status}
                        </span>
                      </div>
                      {s.message ? <div className="text-[11px] text-muted-foreground mt-1">{s.message}</div> : null}
                    </div>
                  );
                })}
              </div>
            )}

            {flowResult ? (
              <div className="mt-3 rounded-lg border bg-muted/20 p-2.5 text-xs">
                <div className="font-semibold">Latest Result</div>
                <div className="mt-1 text-muted-foreground font-mono truncate">
                  WO: {String(flowResult.work_order_id ?? "n/a")} • Status: {String(flowResult.status ?? "n/a")}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot size={15} />
              AI Block Inspector
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {AI_BLOCK_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelectedAiBlock((prev) => (prev === k ? null : k))}
                  className={[
                    "text-left rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                    selectedAiBlock === k ? "bg-primary/10 border-primary/30" : "hover:bg-muted/40",
                  ].join(" ")}
                >
                  {k.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <div className="rounded-md border bg-muted/20 p-2.5 text-[11px] min-h-24">
              {selectedAiBlock ? (
                <>
                  <div className="font-semibold mb-1">{selectedAiBlock.replace(/_/g, " ")}</div>
                  <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                    {selectedAiValue === null ? "n/a (run sample flow first)" : JSON.stringify(selectedAiValue, null, 2)}
                  </pre>
                </>
              ) : (
                <div className="text-muted-foreground">Select a block to inspect output.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck size={15} />
              Approval Response Tool
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input value={approvalRequestId} onChange={(e) => setApprovalRequestId(e.target.value)} placeholder="approval_request_id" />
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                value={approvalDecision}
                onChange={(e) => setApprovalDecision(e.target.value as "approve" | "reject")}
              >
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
              </select>
              <Input value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)} placeholder="Optional notes" />
              <Button
                size="sm"
                disabled={!approvalRequestId.trim() || approvalMutation.isPending}
                onClick={() => approvalMutation.mutate()}
              >
                {approvalMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : "Submit"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Bulk Status Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
              placeholder="WO-001, WO-002 or newline-separated IDs"
              value={bulkIdsRaw}
              onChange={(e) => setBulkIdsRaw(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                value={bulkNewStatus}
                onChange={(e) => setBulkNewStatus(e.target.value)}
              >
                <option value="preparing">preparing</option>
                <option value="prepared">prepared</option>
                <option value="active">active</option>
                <option value="completed">completed</option>
                <option value="closed">closed</option>
              </select>
              <Input value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} placeholder="Optional notes" />
              <Button size="sm" disabled={!bulkIdsRaw.trim() || bulkMutation.isPending} onClick={() => bulkMutation.mutate()}>
                {bulkMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : "Apply"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity size={15} />
            Active Queue
            {filterStatus ? (
              <Badge variant="secondary" className="capitalize">
                {formatStatusLabel(filterStatus)}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workOrdersQuery.isLoading ? (
            <div className="h-24 flex items-center justify-center">
              <RefreshCw size={18} className="animate-spin text-muted-foreground" />
            </div>
          ) : workOrdersQuery.isError ? (
            <div className="text-sm text-destructive">{getWoErrorMessage(workOrdersQuery.error)}</div>
          ) : (
            <div className="space-y-2">
              {(workOrdersQuery.data ?? []).map((wo) => (
                <div key={wo.work_order_id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-muted-foreground">{wo.work_order_id}</div>
                    <div className="text-sm font-semibold truncate">{wo.issue_description ?? "-"}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {(wo.asset ?? "-") + " • " + (wo.location ?? "-") + " • " + (wo.requester_name ?? "-")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="capitalize">
                      {wo.status ?? "-"}
                    </Badge>
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <Link href={`${APP_ROUTES.workOrders}/${wo.work_order_id}`}>
                        Open
                        <ChevronRight size={12} />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
              {(workOrdersQuery.data ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No work orders found for this view.</div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
        </div>

        <div className="space-y-5">
          <Card className="border-none shadow-sm xl:sticky xl:top-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bot size={15} />
                Work Order AI Chat
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Use the dedicated AI Chat Create page for conversation history, the chat assistant, and a
                detailed tool/process log.
              </p>
              <Button asChild className="w-full gap-2">
                <Link href={APP_ROUTES.workOrdersNew}>
                  <Bot size={15} />
                  Open AI Chat Create
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
