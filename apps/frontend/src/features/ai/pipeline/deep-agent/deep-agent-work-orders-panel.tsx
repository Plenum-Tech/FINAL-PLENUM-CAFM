"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, ClipboardList, Loader2, Mail, Plus, Wrench } from "lucide-react";

import { Button } from "@/components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { Badge } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import {
  getWoErrorMessage,
  type DashboardStats,
  type WorkOrderResponse,
  woFetch,
  woFetchWorkOrderList,
} from "@/features/work-orders/wo-api";
import { cn } from "@/utils/cn";

type Props = {
  onAskCreate?: () => void;
  embeddedRail?: boolean;
  className?: string;
};

function statusLabel(s: string | null | undefined): string {
  if (!s) return "—";
  const map: Record<string, string> = {
    pending_approval: "Pending approval",
    preparing: "Preparing",
    prepared: "Ready",
    active: "Active",
    completed: "Completed",
    closed: "Closed",
  };
  return map[s] ?? s.replace(/_/g, " ");
}

function statusVariant(s: string | null | undefined): "warning" | "secondary" | "success" | "outline" {
  const v = (s ?? "").toLowerCase();
  if (v === "pending_approval") return "warning";
  if (v === "active" || v === "preparing") return "secondary";
  if (v === "completed" || v === "prepared") return "success";
  return "outline";
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="shadow-none border-slate-200/80 bg-white">
      <CardContent className="p-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums mt-0.5">{value}</p>
        {hint ? <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function DeepAgentWorkOrdersPanel({ onAskCreate, embeddedRail, className }: Props) {
  const statsQuery = useQuery({
    queryKey: ["wo", "dashboard-stats"],
    queryFn: () => woFetch<DashboardStats>("/api/dashboard/stats"),
    staleTime: 30_000,
    retry: 1,
  });

  const listQuery = useQuery({
    queryKey: ["wo", "list-recent"],
    queryFn: () => woFetchWorkOrderList<WorkOrderResponse>("/api/work-orders/?limit=12"),
    staleTime: 20_000,
    retry: 1,
  });

  const stats = statsQuery.data;
  const openCount = stats
    ? (stats.by_status.pending_approval ?? 0) +
      (stats.by_status.preparing ?? 0) +
      (stats.by_status.prepared ?? 0) +
      (stats.by_status.active ?? 0)
    : 0;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden",
        embeddedRail ? "" : "",
        className,
      )}
    >
      <CardHeader className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-indigo-50/50 to-white py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <Wrench size={16} className="text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Work orders</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Live status from the WO engine — create and triage via chat.
              </CardDescription>
            </div>
          </div>
          {onAskCreate ? (
            <Button type="button" size="sm" className="shrink-0 h-8" onClick={onAskCreate}>
              <Plus size={12} className="mr-1" />
              Ask in chat
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {statsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
            <Loader2 size={16} className="animate-spin text-indigo-600" />
            Loading stats…
          </div>
        ) : statsQuery.isError ? (
          <Card className="border-red-200 bg-red-50/50 shadow-none">
            <CardContent className="py-3 px-4 text-xs text-red-800">
              Could not load WO stats — {getWoErrorMessage(statsQuery.error)}
            </CardContent>
          </Card>
        ) : stats ? (
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Open" value={openCount} hint="Active pipeline" />
            <StatCard label="Pending approval" value={stats.by_status.pending_approval ?? 0} />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary" className="h-8 text-xs">
            <Link href={APP_ROUTES.workOrdersList}>
              <ClipboardList size={12} className="mr-1" />
              All work orders
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary" className="h-8 text-xs">
            <Link href={APP_ROUTES.workOrderEmailInbox}>
              <Mail size={12} className="mr-1" />
              Email inbox
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary" className="h-8 text-xs">
            <Link href={APP_ROUTES.workOrderCommandCenter}>
              <Activity size={12} className="mr-1" />
              Command center
            </Link>
          </Button>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-700 mb-2">Recent work orders</p>
          {listQuery.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : listQuery.isError ? (
            <p className="text-xs text-muted-foreground py-2">No list available — use chat to query WOs.</p>
          ) : listQuery.data?.items.length ? (
            <ul className="space-y-2">
              {listQuery.data.items.map((wo) => (
                <li key={wo.work_order_id}>
                  <Link
                    href={`${APP_ROUTES.workOrders}/${encodeURIComponent(wo.work_order_id)}`}
                    className="block rounded-xl border border-slate-200/90 bg-slate-50/50 px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/40 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold font-mono truncate">{wo.work_order_id}</span>
                      <Badge variant={statusVariant(wo.status)} className="text-[10px] font-normal shrink-0">
                        {statusLabel(wo.status)}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-1">
                      {wo.issue_description ?? wo.asset ?? "No description"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Card className="border-dashed shadow-none bg-slate-50/50">
              <CardContent className="py-6 text-center text-xs text-muted-foreground">
                No work orders yet — describe a repair in chat.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
