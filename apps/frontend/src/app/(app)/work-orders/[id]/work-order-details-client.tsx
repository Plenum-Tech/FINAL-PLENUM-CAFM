"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock,
  ClipboardList,
  Mail,
  MapPin,
  Package,
  ShieldCheck,
  User,
  Wrench,
  XCircle,
  Activity,
  AlertTriangle,
} from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import {
  type JourneyHealth,
  type JourneyMilestone,
  type JourneyResponse,
  type StatusHistoryItem,
  type WorkOrderResponse,
  getWoErrorMessage,
  woFetch,
} from "@/features/work-orders/wo-api";
import { WoChatWorkOrderDetail } from "@/features/work-orders/wo-chat";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

function statusLabel(s: string | null): string {
  if (!s) return "-";
  const map: Record<string, string> = {
    pending_approval: "Pending Approval",
    preparing: "Preparing",
    prepared: "Ready",
    active: "Active",
    completed: "Completed",
    closed: "Closed",
  };
  return map[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sourceIcon(source: string | null) {
  if (source === "email") return <Mail size={12} />;
  if (source === "ppm") return <CalendarClock size={12} />;
  return <ClipboardList size={12} />;
}

function priorityVariant(p: string | null): "secondary" | "warning" | "destructive" {
  if (p === "high" || p === "urgent" || p === "critical") return "destructive";
  if (p === "medium") return "warning";
  return "secondary";
}

function statusVariant(s: string | null): "secondary" | "warning" | "success" | "destructive" {
  if (s === "completed" || s === "closed") return "success";
  if (s === "active" || s === "preparing" || s === "prepared") return "warning";
  if (s === "pending_approval") return "secondary";
  return "secondary";
}

function healthVariant(h: JourneyHealth["health_status"]): string {
  if (h === "completed") return "bg-green-100 text-green-700 border-green-200";
  if (h === "on_track") return "bg-blue-100 text-blue-700 border-blue-200";
  if (h === "in_progress") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function healthLabel(h: JourneyHealth["health_status"]): string {
  const map = {
    on_track: "On Track",
    in_progress: "In Progress",
    at_risk: "At Risk",
    completed: "Completed",
  };
  return map[h] ?? h;
}

function buildWorkOrderChatContext(opts: {
  wo: WorkOrderResponse;
  milestones: JourneyMilestone[];
  health: JourneyHealth | undefined;
  nextStatuses: string[];
}): string {
  const { wo, milestones, health, nextStatuses } = opts;
  const journeyLine =
    milestones.length > 0
      ? milestones.map((m) => `${m.name}=${m.status}`).join(", ")
      : "(none)";

  const lines: string[] = [
    "=== WORK ORDER CONTEXT (for tools; do not read aloud verbatim) ===",
    `work_order_id: ${wo.work_order_id}`,
    wo.journey_log_id ? `journey_log_id: ${wo.journey_log_id}` : "",
    `current_status: ${wo.status ?? "unknown"}`,
    `priority: ${wo.priority ?? "unknown"}`,
    `request_type: ${wo.request_type ?? "unknown"}`,
    `source: ${wo.source ?? "unknown"}`,
    `issue_description: ${wo.issue_description ?? ""}`,
    `asset: ${wo.asset ?? ""}`,
    `location: ${wo.location ?? ""}`,
    `requester_name: ${wo.requester_name ?? ""}`,
    `requester_email: ${wo.requester_email ?? ""}`,
    `vendor: ${wo.vendor ?? ""}`,
    wo.scheduled_date ? `scheduled_date: ${wo.scheduled_date}` : "",
    wo.scheduled_time ? `scheduled_time: ${wo.scheduled_time}` : "",
    wo.estimated_duration != null ? `estimated_duration_hours: ${wo.estimated_duration}` : "",
    health
      ? `journey_health: ${health.health_status} (${Math.round(health.completion_percentage)}% complete)`
      : "",
    `journey_milestones: ${journeyLine}`,
    `ui_hint_allowed_next_statuses: ${nextStatuses.length ? nextStatuses.join(", ") : "(none — verify via API / workflow)"}`,
    "",
    "Always pass work_order_id exactly as above when calling tools.",
    "=== END CONTEXT ===",
  ];

  return lines.filter(Boolean).join("\n");
}

// ─── Journey Stepper ────────────────────────────────────────────────────────

function JourneyStepper({ milestones }: { milestones: JourneyMilestone[] }) {
  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {milestones.map((m, idx) => {
        const isLast = idx === milestones.length - 1;
        const isDone = m.status === "completed";
        const isCurrent = m.status === "current";
        const isSkipped = m.status === "skipped";

        return (
          <div key={m.name} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-1.5 min-w-[90px]">
              <div
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all",
                  isDone
                    ? "border-green-500 bg-green-500 text-white"
                    : isCurrent
                      ? "border-blue-500 bg-blue-50 text-blue-600 ring-2 ring-blue-200 ring-offset-1"
                      : isSkipped
                        ? "border-slate-300 bg-slate-100 text-slate-400"
                        : "border-slate-200 bg-white text-slate-300",
                ].join(" ")}
              >
                {isDone ? (
                  <Check size={14} strokeWidth={2.5} />
                ) : isCurrent ? (
                  <CircleDot size={14} />
                ) : isSkipped ? (
                  <XCircle size={13} />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-current" />
                )}
              </div>
              <div className="text-center">
                <div
                  className={[
                    "text-[10px] font-medium leading-tight",
                    isDone
                      ? "text-green-700"
                      : isCurrent
                        ? "text-blue-700"
                        : "text-muted-foreground",
                  ].join(" ")}
                >
                  {m.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </div>
                {m.timestamp && (
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    {fmtDate(m.timestamp)}
                  </div>
                )}
              </div>
            </div>
            {!isLast && (
              <div
                className={[
                  "h-0.5 w-8 mx-1 mt-[-18px] shrink-0",
                  isDone ? "bg-green-400" : "bg-slate-200",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function WorkOrderDetailsClient({ workOrderId }: { workOrderId: string }) {
  const _router = useRouter();
  const queryClient = useQueryClient();

  // Preparation form state
  const [prepVendor, setPrepVendor] = useState("");
  const [prepScheduledDate, setPrepScheduledDate] = useState("");
  const [prepScheduledTime, setPrepScheduledTime] = useState("");
  const [prepDuration, setPrepDuration] = useState("");
  const [prepInspection, setPrepInspection] = useState(false);
  const [prepSpecial, setPrepSpecial] = useState("");

  // Status change modal
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusValue, setStatusValue] = useState("");

  // ── Queries ──
  const woQuery = useQuery<WorkOrderResponse>({
    queryKey: ["wo", workOrderId],
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      woFetch<WorkOrderResponse>(`/api/work-orders/${encodeURIComponent(workOrderId)}`, { signal }),
  });

  const wo = woQuery.data;
  const jlogId = wo?.journey_log_id ?? "";

  const journeyQuery = useQuery<JourneyResponse>({
    queryKey: ["journey", workOrderId],
    enabled: Boolean(workOrderId),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      woFetch<JourneyResponse>(`/api/journeys/by-work-order/${encodeURIComponent(workOrderId)}`, { signal }),
  });

  const healthQuery = useQuery<JourneyHealth>({
    queryKey: ["journey-health", jlogId],
    enabled: Boolean(jlogId),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      woFetch<JourneyHealth>(`/api/journeys/${encodeURIComponent(jlogId)}/health`, { signal }),
  });

  const historyQuery = useQuery<StatusHistoryItem[]>({
    queryKey: ["wo-history", workOrderId],
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      woFetch<StatusHistoryItem[]>(`/api/work-orders/${encodeURIComponent(workOrderId)}/history`, { signal }),
  });

  // ── Mutations ──
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wo", workOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["journey", workOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["journey-health", jlogId] }),
      queryClient.invalidateQueries({ queryKey: ["wo-history", workOrderId] }),
      queryClient.invalidateQueries({ queryKey: ["wo-list"] }),
    ]);
  };

  const approveMutation = useMutation<WorkOrderResponse>({
    mutationFn: () =>
      woFetch<WorkOrderResponse>(`/api/work-orders/${encodeURIComponent(workOrderId)}/approve`, {
        method: "POST",
      }),
    onSuccess: async () => {
      toast({ title: "Work order approved — now preparing", variant: "success" });
      await invalidate();
    },
    onError: (e) => {
      toast({ title: "Failed to approve", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const prepareMutation = useMutation<WorkOrderResponse>({
    mutationFn: () =>
      woFetch<WorkOrderResponse>(`/api/work-orders/${encodeURIComponent(workOrderId)}/prepare`, {
        method: "POST",
        body: {
          ...(prepVendor.trim() ? { vendor: prepVendor.trim() } : {}),
          ...(prepScheduledDate ? { scheduled_date: prepScheduledDate } : {}),
          ...(prepScheduledTime ? { scheduled_time: prepScheduledTime } : {}),
          ...(prepDuration ? { estimated_duration: parseFloat(prepDuration) } : {}),
          inspection_required: prepInspection,
          ...(prepSpecial.trim() ? { special_requirements: prepSpecial.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      toast({ title: "Work order marked as prepared — ready for dispatch", variant: "success" });
      await invalidate();
    },
    onError: (e) => {
      toast({ title: "Failed to submit preparation", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const statusMutation = useMutation<WorkOrderResponse, unknown, { new_status: string; notes?: string }>({
    mutationFn: (body) =>
      woFetch<WorkOrderResponse>(`/api/work-orders/${encodeURIComponent(workOrderId)}/status`, {
        method: "PATCH",
        body,
      }),
    onSuccess: async (_d, vars) => {
      toast({ title: `Status updated to "${statusLabel(vars.new_status)}"`, variant: "success" });
      setStatusModalOpen(false);
      await invalidate();
    },
    onError: (e) => {
      toast({ title: "Failed to update status", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const closeMutation = useMutation<WorkOrderResponse>({
    mutationFn: () =>
      woFetch<WorkOrderResponse>(`/api/work-orders/${encodeURIComponent(workOrderId)}/close`, {
        method: "POST",
      }),
    onSuccess: async () => {
      toast({ title: "Work order closed", variant: "success" });
      await invalidate();
    },
    onError: (e) => {
      toast({ title: "Failed to close", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  const status = wo?.status ?? "";
  const milestones = journeyQuery.data?.milestones ?? [];
  const health = healthQuery.data;
  const history = historyQuery.data ?? [];
  const techName = journeyQuery.data?.assigned_technician_name;

  const allowedTransitions: Record<string, string[]> = {
    preparing: ["prepared", "closed"],
    prepared: ["active", "preparing", "closed"],
    active: ["completed", "closed"],
    completed: ["closed"],
  };
  const nextStatuses = allowedTransitions[status] ?? [];

  const detailChatContext = useMemo(() => {
    if (!wo) return "";
    return buildWorkOrderChatContext({ wo, milestones, health, nextStatuses });
  }, [wo, milestones, health, nextStatuses]);

  const detailChatStarters = useMemo(() => {
    if (!wo) return [];
    const id = wo.work_order_id;
    const lines: string[] = [];
    if (status === "pending_approval") {
      lines.push(`Approve work order ${id}.`);
    }
    if (status === "preparing") {
      lines.push(
        `Help me finish preparation for ${id}: ask what vendor and schedule I want, then submit preparation with those details.`,
      );
    }
    if (nextStatuses.length > 0) {
      lines.push(`Move ${id} to "${nextStatuses[0]}" (${statusLabel(nextStatuses[0])}).`);
    }
    lines.push(`Fetch the latest record and journey for ${id} and summarize what's next.`);
    lines.push(`Show recent status history for ${id}.`);
    if (status !== "closed") {
      lines.push(`Close ${id} if work is complete.`);
    }
    return lines.slice(0, 7);
  }, [wo, status, nextStatuses]);

  // ── Loading / error states ──
  if (woQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/40" />;
  }

  if (woQuery.isError || !wo) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{getWoErrorMessage(woQuery.error)}</p>
        <Button variant="outline" onClick={() => woQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild aria-label="Back">
            <Link href={APP_ROUTES.workOrdersList}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight truncate">
              {wo.issue_description || wo.request_type || "Work Order"}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">{wo.work_order_id}</span>
              {wo.source && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200 capitalize">
                  {sourceIcon(wo.source)}
                  {wo.source}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Approve (pending_approval → preparing) */}
          {status === "pending_approval" && (
            <Button
              className="gap-2 bg-green-600 hover:bg-green-700 text-white"
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate()}
            >
              <ShieldCheck size={15} />
              {approveMutation.isPending ? "Approving…" : "Approve"}
            </Button>
          )}

          {/* Status change (for allowed transitions) */}
          {nextStatuses.length > 0 && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setStatusValue(nextStatuses[0]);
                setStatusModalOpen(true);
              }}
            >
              <Clock size={15} />
              Update Status
            </Button>
          )}

          {/* Close (any non-closed) */}
          {status !== "closed" && (
            <Button
              variant="outline"
              className="gap-2 border-slate-300 text-slate-600 hover:bg-slate-50"
              disabled={closeMutation.isPending}
              onClick={() => closeMutation.mutate()}
            >
              <XCircle size={15} />
              {closeMutation.isPending ? "Closing…" : "Close WO"}
            </Button>
          )}
        </div>
      </div>

      {/* Journey stepper */}
      {milestones.length > 0 && (
        <Card className="border-none shadow-sm bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Journey Progress</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <JourneyStepper milestones={milestones} />
            {techName && (
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                <User size={11} />
                Technician assigned: <span className="font-medium text-foreground">{techName}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-none shadow-sm bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40">
                <ClipboardList size={16} className="text-muted-foreground" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Priority</div>
                <Badge variant={priorityVariant(wo.priority)} className="capitalize mt-0.5">
                  {wo.priority ?? "-"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40">
                <Activity size={16} className="text-muted-foreground" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={statusVariant(status)} className="mt-0.5">
                  {statusLabel(status)}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40">
                <ShieldCheck size={16} className="text-muted-foreground" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Health</div>
                {health ? (
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 mt-0.5 rounded-full border ${healthVariant(health.health_status)}`}
                  >
                    {healthLabel(health.health_status)}
                    <span className="text-[10px] opacity-70">
                      {Math.round(health.completion_percentage)}%
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground mt-0.5">—</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40">
                <Clock size={16} className="text-muted-foreground" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Created</div>
                <div className="text-sm font-semibold mt-0.5">{fmt(wo.created_at)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main details + workflow chat */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(440px,44vw)]">
        {/* WO details */}
        <Card className="border-none shadow-sm bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Work Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {wo.issue_description && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Description</div>
                <div className="text-sm whitespace-pre-wrap">{wo.issue_description}</div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Requester</div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <User size={13} className="text-muted-foreground shrink-0" />
                  <span>{wo.requester_name ?? "-"}</span>
                </div>
                {wo.requester_email && (
                  <div className="text-xs text-muted-foreground mt-0.5 pl-5">{wo.requester_email}</div>
                )}
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Request Type</div>
                <span className="text-sm font-medium capitalize">{wo.request_type ?? "-"}</span>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Asset</div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wrench size={13} className="text-muted-foreground shrink-0" />
                  <span>{wo.asset ?? "-"}</span>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Location</div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MapPin size={13} className="text-muted-foreground shrink-0" />
                  <span>{wo.location ?? "-"}</span>
                </div>
              </div>

              {wo.vendor && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Vendor</div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Package size={13} className="text-muted-foreground shrink-0" />
                    <span>{wo.vendor}</span>
                  </div>
                </div>
              )}

              {wo.scheduled_date && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Scheduled</div>
                  <div className="text-sm font-medium">
                    {wo.scheduled_date}
                    {wo.scheduled_time ? ` at ${wo.scheduled_time}` : ""}
                  </div>
                </div>
              )}

              {wo.estimated_duration != null && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Est. Duration</div>
                  <div className="text-sm font-medium">{wo.estimated_duration}h</div>
                </div>
              )}

              {wo.cmms_work_order_id && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">CMMS WO ID</div>
                  <div className="text-sm font-mono font-medium">{wo.cmms_work_order_id}</div>
                </div>
              )}

              {wo.approved_at && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Approved At</div>
                  <div className="text-sm font-medium">{fmt(wo.approved_at)}</div>
                </div>
              )}

              {wo.prepared_at && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Prepared At</div>
                  <div className="text-sm font-medium">{fmt(wo.prepared_at)}</div>
                </div>
              )}
            </div>

            {wo.special_requirements && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Special Requirements</div>
                <div className="text-sm text-muted-foreground">{wo.special_requirements}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 min-h-0 xl:sticky xl:top-4 xl:self-start xl:h-[calc(100dvh-5rem)] xl:max-h-[calc(100dvh-5rem)]">
          <WoChatWorkOrderDetail
            workOrderId={wo.work_order_id}
            contextBlock={detailChatContext}
            starterPrompts={detailChatStarters}
            workOrderStatus={status}
            onAfterReply={invalidate}
            className="min-h-0 flex-1 basis-0 shadow-lg"
          />

          <Card className="border-none shadow-sm bg-card/50 shrink-0 flex flex-col max-h-52 overflow-hidden min-h-0">
            <CardHeader className="py-3 pb-2 shrink-0">
              <CardTitle className="text-sm">Status History</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto pt-0 pb-3">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No history yet.</p>
              ) : (
                <div className="space-y-3">
                  {history.map((h, idx) => (
                    <div key={`${h.changed_at}-${idx}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-2.5 w-2.5 rounded-full bg-primary/70 mt-1.5 shrink-0" />
                        {idx < history.length - 1 && (
                          <div className="w-px flex-1 bg-border/60 mt-1 min-h-[8px]" />
                        )}
                      </div>
                      <div className="pb-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-xs flex-wrap">
                          {h.from_status ? (
                            <>
                              <span className="font-medium">{statusLabel(h.from_status)}</span>
                              <ChevronRight size={12} className="text-muted-foreground" />
                            </>
                          ) : null}
                          <span className="font-semibold text-foreground">{statusLabel(h.to_status)}</span>
                        </div>
                        {h.notes && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">{h.notes}</div>
                        )}
                        <div className="text-[11px] text-muted-foreground mt-0.5">{fmt(h.changed_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Preparation form (shown when status === "preparing") */}
      {status === "preparing" && (
        <Card className="border-none shadow-sm bg-amber-50/60 border-l-4 border-l-amber-400">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock size={16} className="text-amber-600" />
              Preparation Form
              <span className="text-xs font-normal text-amber-600 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full ml-2">
                Fill in before marking Ready
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Vendor / Contractor</label>
                <input
                  type="text"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="e.g. CoolTech HVAC Services"
                  value={prepVendor}
                  onChange={(e) => setPrepVendor(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Estimated Duration (hours)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="e.g. 2.5"
                  value={prepDuration}
                  onChange={(e) => setPrepDuration(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Scheduled Date</label>
                <input
                  type="date"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={prepScheduledDate}
                  onChange={(e) => setPrepScheduledDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Scheduled Time</label>
                <input
                  type="time"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={prepScheduledTime}
                  onChange={(e) => setPrepScheduledTime(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 pt-5">
                <input
                  id="prep-inspection"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={prepInspection}
                  onChange={(e) => setPrepInspection(e.target.checked)}
                />
                <label htmlFor="prep-inspection" className="text-sm font-medium cursor-pointer">
                  Inspection Required
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Special Requirements</label>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                placeholder="Tools, permits, safety requirements…"
                value={prepSpecial}
                onChange={(e) => setPrepSpecial(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button
                disabled={prepareMutation.isPending}
                onClick={() => prepareMutation.mutate()}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <CheckCircle2 size={15} />
                {prepareMutation.isPending ? "Submitting…" : "Mark as Ready"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prepared banner */}
      {status === "prepared" && (
        <Card className="border-none shadow-sm bg-blue-50/60 border-l-4 border-l-blue-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-blue-100">
                  <CheckCircle2 size={18} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Ready for Dispatch</div>
                  <div className="text-xs text-muted-foreground">
                    Preparation complete — activate to begin work
                  </div>
                </div>
              </div>
              <Button
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ new_status: "active", notes: "Dispatched to CMMS" })}
              >
                <Activity size={15} />
                {statusMutation.isPending ? "Activating…" : "Activate"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active banner */}
      {status === "active" && (
        <Card className="border-none shadow-sm bg-green-50/60 border-l-4 border-l-green-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-green-100">
                  <Activity size={18} className="text-green-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Work In Progress</div>
                  <div className="text-xs text-muted-foreground">Mark as completed when the work is done</div>
                </div>
              </div>
              <Button
                className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ new_status: "completed" })}
              >
                <Check size={15} />
                {statusMutation.isPending ? "Completing…" : "Mark Complete"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status change modal */}
      {statusModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setStatusModalOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-xl border bg-card shadow-xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-base font-semibold">Update Status</div>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={statusValue}
              onChange={(e) => setStatusValue(e.target.value)}
            >
              {nextStatuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={statusMutation.isPending}
                onClick={() => setStatusModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ new_status: statusValue })}
              >
                {statusMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Health overrun warnings */}
      {health && (health.cost_overrun || health.time_overrun) && (
        <Card className="border-none shadow-sm bg-red-50/60 border-l-4 border-l-red-400">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <AlertTriangle size={16} className="text-red-600 shrink-0" />
              <div className="text-sm">
                {health.cost_overrun && <span className="font-medium text-red-700 mr-3">Cost overrun detected</span>}
                {health.time_overrun && <span className="font-medium text-red-700">Time overrun detected</span>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
