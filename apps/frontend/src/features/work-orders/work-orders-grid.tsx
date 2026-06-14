"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  Clock,
  ClipboardList,
  Mail,
  Plus,
  Wrench,
  AlertCircle,
  BarChart3,
} from "lucide-react";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Badge, Button, Card, CardContent, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import {
  type DashboardStats,
  type WorkOrderResponse,
  getWoErrorMessage,
  woFetch,
  woFetchWorkOrderList,
} from "@/features/work-orders/wo-api";

// ─── Types ───────────────────────────────────────────────────────────────────

type WoRow = WorkOrderResponse;
type PpmDueRow = {
  schedule_id?: string;
  asset_name?: string;
  asset?: string;
  location?: string;
  frequency?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

// ─── KPI Cards ───────────────────────────────────────────────────────────────

function KpiCards({ stats }: { stats: DashboardStats }) {
  const openCount =
    (stats.by_status.pending_approval ?? 0) +
    (stats.by_status.preparing ?? 0) +
    (stats.by_status.prepared ?? 0) +
    (stats.by_status.active ?? 0);

  const pendingCount = stats.by_status.pending_approval ?? 0;

  const cards = [
    {
      label: "Total WOs",
      value: stats.total,
      icon: <ClipboardList size={18} className="text-slate-500" />,
      bg: "bg-slate-50",
    },
    {
      label: "Open",
      value: openCount,
      icon: <Activity size={18} className="text-blue-500" />,
      bg: "bg-blue-50",
    },
    {
      label: "Pending Approval",
      value: pendingCount,
      icon: <Clock size={18} className="text-amber-500" />,
      bg: "bg-amber-50",
      highlight: pendingCount > 0,
    },
    {
      label: "Created Today",
      value: stats.created_today,
      icon: <Plus size={18} className="text-green-500" />,
      bg: "bg-green-50",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card
          key={c.label}
          className={[
            "border-none shadow-sm",
            c.highlight ? "ring-2 ring-amber-300" : "",
          ].join(" ")}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.bg}`}>
                {c.icon}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="text-2xl font-bold leading-none mt-0.5">{c.value}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span className="text-muted-foreground">-</span>;
  const icon =
    source === "email" ? <Mail size={10} /> : source === "ppm" ? <Wrench size={10} /> : null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200 capitalize font-medium">
      {icon}
      {source}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function WorkOrdersGrid() {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [ppmDuePreview, setPpmDuePreview] = useState<PpmDueRow[] | null>(null);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sourceFilter]);

  // ── Dashboard stats ──
  const statsQuery = useQuery<DashboardStats>({
    queryKey: ["wo-dashboard-stats"],
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => woFetch<DashboardStats>("/api/dashboard/stats"),
  });

  // ── Pending approval count for badge ──
  const pendingQuery = useQuery<WoRow[]>({
    queryKey: ["wo-pending-approval"],
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => woFetch<WoRow[]>("/api/work-orders/filter/pending-approval"),
  });
  const pendingCount = pendingQuery.data?.length ?? 0;

  const ppmDueQuery = useQuery<PpmDueRow[]>({
    queryKey: ["wo-ppm-due-on-demand"],
    enabled: false,
    queryFn: () => woFetch<PpmDueRow[]>("/api/ppm/due"),
  });

  const runPpmQuery = useQuery<{ created: string[] }>({
    queryKey: ["wo-ppm-run-on-demand"],
    enabled: false,
    queryFn: () => woFetch<{ created: string[] }>("/api/ppm/run", { method: "POST" }),
  });

type WoListPage = { items: WoRow[]; total: number };

  // ── Work orders list ──
  const listQuery = useQuery<WoListPage>({
    queryKey: ["wo-list", statusFilter, sourceFilter, page, pageSize],
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(pageSize));
      if (statusFilter) params.set("status", statusFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      return woFetchWorkOrderList(`/api/work-orders/?${params.toString()}`, { signal });
    },
  });

  // client-side search filter
  const rows = useMemo(() => {
    const all = listQuery.data?.items ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (r) =>
        r.work_order_id.toLowerCase().includes(q) ||
        (r.issue_description ?? "").toLowerCase().includes(q) ||
        (r.asset ?? "").toLowerCase().includes(q) ||
        (r.location ?? "").toLowerCase().includes(q) ||
        (r.requester_name ?? "").toLowerCase().includes(q),
    );
  }, [listQuery.data?.items, search]);

  const columns = useMemo<ColDef<WoRow>[]>(
    () => [
      {
        headerName: "WO ID",
        field: "work_order_id",
        width: 190,
        cellRenderer: (p: ICellRendererParams<WoRow>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Link
              className="font-mono text-xs text-primary hover:underline"
              href={`${APP_ROUTES.workOrders}/${row.work_order_id}`}
              prefetch={false}
            >
              {row.work_order_id}
            </Link>
          );
        },
      },
      {
        headerName: "Description",
        field: "issue_description",
        minWidth: 260,
        flex: 2,
        valueFormatter: (p) => String(p.value ?? "-"),
      },
      {
        headerName: "Priority",
        field: "priority",
        width: 120,
        cellRenderer: (p: ICellRendererParams<WoRow>) => {
          const v = p.value as string | null;
          const variant =
            v === "high" || v === "urgent" || v === "critical"
              ? "destructive"
              : v === "medium"
                ? "warning"
                : "secondary";
          return Badge({ variant, className: "capitalize", children: v ?? "-" });
        },
      },
      {
        headerName: "Status",
        field: "status",
        width: 160,
        valueFormatter: (p) => statusLabel(String(p.value ?? "")),
      },
      {
        headerName: "Source",
        field: "source",
        width: 110,
        cellRenderer: (p: ICellRendererParams<WoRow>) => (
          <SourceBadge source={p.value as string | null} />
        ),
      },
      {
        headerName: "Asset",
        field: "asset",
        minWidth: 160,
        flex: 1,
        valueFormatter: (p) => String(p.value ?? "-"),
      },
      {
        headerName: "Location",
        field: "location",
        minWidth: 180,
        flex: 1,
        valueFormatter: (p) => String(p.value ?? "-"),
      },
      {
        headerName: "Created",
        field: "created_at",
        width: 140,
        valueFormatter: (p) => fmtDate(p.value as string | null),
      },
    ],
    [],
  );

  const STATUS_OPTIONS = [
    { label: "All Statuses", value: "" },
    { label: "Pending Approval", value: "pending_approval" },
    { label: "Preparing", value: "preparing" },
    { label: "Ready", value: "prepared" },
    { label: "Active", value: "active" },
    { label: "Completed", value: "completed" },
    { label: "Closed", value: "closed" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Work Orders</h1>
          <p className="text-sm text-muted-foreground">
            Track and manage maintenance requests across all sources.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs bg-amber-100 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full font-medium">
              <AlertCircle size={12} />
              {pendingCount} pending approval
            </span>
          )}
          <Link href={APP_ROUTES.workOrderEmailInbox}>
            <Button variant="outline" className="gap-2">
              <Mail size={15} />
              Email Inbox
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2"
            disabled={ppmDueQuery.isFetching}
            onClick={async () => {
              try {
                const result = await ppmDueQuery.refetch();
                const due = result.data ?? [];
                setPpmDuePreview(due.slice(0, 5));
                toast({
                  title: `PPM due checks: ${due.length}`,
                  variant: "success",
                });
              } catch (e) {
                toast({
                  title: "Failed to fetch due PPM schedules",
                  description: getWoErrorMessage(e),
                  variant: "destructive",
                });
              }
            }}
          >
            {ppmDueQuery.isFetching ? <Clock size={15} className="animate-spin" /> : <CalendarClock size={15} />}
            PPM Due
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            disabled={runPpmQuery.isFetching}
            onClick={async () => {
              try {
                const result = await runPpmQuery.refetch();
                const created = result.data?.created ?? [];
                toast({
                  title: created.length
                    ? `PPM run created ${created.length} WO${created.length === 1 ? "" : "s"}`
                    : "PPM run complete (no new work orders)",
                  variant: "success",
                });
                await Promise.all([listQuery.refetch(), statsQuery.refetch(), pendingQuery.refetch()]);
              } catch (e) {
                toast({
                  title: "Failed to run PPM scheduler",
                  description: getWoErrorMessage(e),
                  variant: "destructive",
                });
              }
            }}
          >
            {runPpmQuery.isFetching ? <Clock size={15} className="animate-spin" /> : <Wrench size={15} />}
            Run PPM
          </Button>
          <Button onClick={() => router.push(APP_ROUTES.workOrdersNew)} className="gap-2">
            <Plus size={15} />
            New WO
          </Button>
        </div>
      </div>

      {ppmDuePreview && ppmDuePreview.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-3">
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Next Due PPM Schedules
          </div>
          <div className="flex flex-wrap gap-2">
            {ppmDuePreview.map((item, idx) => (
              <span
                key={`${item.schedule_id ?? "ppm"}-${idx}`}
                className="text-xs rounded-full border bg-muted/40 px-2.5 py-1"
              >
                {(item.asset_name ?? item.asset ?? "Asset").toString()}
                {item.frequency ? ` • ${item.frequency}` : ""}
                {item.location ? ` • ${item.location}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* KPI cards */}
      {statsQuery.isSuccess && <KpiCards stats={statsQuery.data} />}
      {statsQuery.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Source breakdown strip (if stats available) */}
      {statsQuery.isSuccess && (
        <div className="flex items-center gap-3 flex-wrap">
          <BarChart3 size={13} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Sources:</span>
          {Object.entries(statsQuery.data.by_source)
            .filter(([, v]) => v > 0)
            .map(([src, count]) => (
              <button
                key={src}
                type="button"
                onClick={() => setSourceFilter((prev) => (prev === src ? "" : src))}
                className={[
                  "text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full border capitalize hover:bg-slate-200 transition-colors",
                  sourceFilter === src ? "ring-2 ring-primary border-primary bg-primary/10" : "border-slate-200",
                ].join(" ")}
              >
                {src} <span className="font-semibold">{count}</span>
              </button>
            ))}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatusFilter(opt.value)}
            className={[
              "text-xs px-3 py-1.5 rounded-full border transition-colors shrink-0",
              statusFilter === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted/40",
            ].join(" ")}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <AgDataGrid<WoRow>
        rowData={rows}
        columnDefs={columns}
        pagination={false}
        serverPagination={{
          page,
          pageSize,
          total: listQuery.data?.total ?? 0,
          onPageChange: setPage,
          onPageSizeChange: (n) => {
            setPageSize(n);
            setPage(1);
          },
        }}
        enableQuickFilter
        quickFilterPlaceholder="Search WO ID, description, asset…"
        quickFilterValue={search}
        onQuickFilterChange={setSearch}
        className="bg-card/50 backdrop-blur-sm"
        loading={listQuery.isLoading || listQuery.isFetching}
        emptyState={{
          title: "No work orders",
          description: listQuery.isError
            ? getWoErrorMessage(listQuery.error)
            : "No work orders found for the selected filter.",
        }}
        onRowClick={(r) => router.push(`${APP_ROUTES.workOrders}/${r.work_order_id}`)}
      />
    </div>
  );
}
