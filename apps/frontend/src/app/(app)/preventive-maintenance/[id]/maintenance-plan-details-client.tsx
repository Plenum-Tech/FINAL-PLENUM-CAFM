"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardPlus, Pencil, Plus, Trash2 } from "lucide-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { APP_ROUTES } from "@/constants";
import { ApiError, apiFetch } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import { listUsers } from "@/features/users/plenum-api";
import {
  createMaintenanceHistory,
  deleteMaintenanceHistory,
  deleteMaintenancePlan,
  getMaintenancePlan,
  listMaintenanceHistory,
  updateMaintenanceHistory,
  type PlenumPage,
  type PlenumMaintenanceHistory,
  type PlenumMaintenancePlan,
} from "@/features/preventive-maintenance/plenum-api";

type WorkOrderLite = { id: string; title: string };

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const p = err.payload as unknown;
    if (typeof p === "object" && p !== null) {
      const r = p as Record<string, unknown>;
      if (typeof r.detail === "string" && r.detail.trim()) return r.detail;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message || "Something went wrong";
  return "Something went wrong";
}

function normalizeDateOnly(v: string): string {
  const s = v.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function isoToDateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

async function fetchUsersSelectPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const page = await listUsers({
    organizationId: input.organizationId,
    limit: input.limit,
    offset: input.offset,
    search: input.search,
    signal: input.signal,
  });
  const data = page.data.map((u) => {
    const name = u.full_name?.trim() ?? "";
    const email = u.email?.trim() ?? "";
    const label = name && email ? `${name} (${email})` : name || email || u.id;
    return { id: u.id, label };
  });
  return { total: page.total, data };
}

async function fetchWorkOrdersSelectPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("organization_id", input.organizationId);
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  if (input.search.trim()) params.set("search", input.search.trim());

  let payload: unknown;
  try {
    payload = await apiFetch<unknown>(`/api/v1/plenum/work-orders?${params.toString()}`, { signal: input.signal });
  } catch (e) {
    if (input.search.trim()) {
      const fallback = new URLSearchParams();
      fallback.set("organization_id", input.organizationId);
      fallback.set("limit", String(input.limit));
      fallback.set("offset", String(input.offset));
      payload = await apiFetch<unknown>(`/api/v1/plenum/work-orders?${fallback.toString()}`, { signal: input.signal });
    } else {
      throw e;
    }
  }

  const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.work_orders)
      ? obj.work_orders
      : Array.isArray(obj.workOrders)
        ? obj.workOrders
        : [];
  const wos: WorkOrderLite[] = raw
    .map((x): WorkOrderLite | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : typeof r.wo_id === "string" ? r.wo_id : "";
      const title = typeof r.title === "string" ? r.title : "";
      if (!id.trim()) return null;
      return { id, title: title || id };
    })
    .filter((v): v is WorkOrderLite => Boolean(v));

  return { total, data: wos.map((w) => ({ id: w.id, label: w.title })) };
}

function HistoryModal({
  open,
  pending,
  organizationId,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  organizationId: string;
  initial?: PlenumMaintenanceHistory | null;
  onClose: () => void;
  onSubmit: (v: { performed_by: string; work_order_id: string; performed_at: string; notes: string }) => void;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const [user, setUser] = useState<InfiniteSelectItem | null>(null);

  const [woOpen, setWoOpen] = useState(false);
  const [workOrder, setWorkOrder] = useState<InfiniteSelectItem | null>(null);

  const [performedAt, setPerformedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const uid = initial?.performed_by ?? "";
    const wid = initial?.work_order_id ?? "";
    setUser(uid ? { id: uid, label: uid } : null);
    setWorkOrder(wid ? { id: wid, label: wid } : null);
    setPerformedAt(isoToDateOnly(initial?.performed_at));
    setNotes(initial?.notes ?? "");
    setFieldErrors({});
  }, [initial?.notes, initial?.performed_at, initial?.performed_by, initial?.work_order_id, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div className="relative w-full max-w-lg rounded-xl border bg-card shadow-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 pt-5">
          <div className="text-base font-semibold">{initial ? "Edit History" : "Add History"}</div>
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Performed By</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setUserOpen((v) => !v)}
                  disabled={!organizationId}
                >
                  <span className="truncate">{user?.label ?? "Select user"}</span>
                </Button>
                <InfiniteSelect
                  open={userOpen}
                  onClose={() => setUserOpen(false)}
                  onSelect={(item) => setUser(item)}
                  valueLabel={user?.label ?? ""}
                  placeholder="Search users..."
                  pageSize={10}
                  cacheKey={organizationId ? `mh-users:${organizationId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchUsersSelectPage({ organizationId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.performed_by ? <div className="text-xs text-destructive">{fieldErrors.performed_by}</div> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Work Order</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setWoOpen((v) => !v)}
                  disabled={!organizationId}
                >
                  <span className="truncate">{workOrder?.label ?? "Select work order"}</span>
                </Button>
                <InfiniteSelect
                  open={woOpen}
                  onClose={() => setWoOpen(false)}
                  onSelect={(item) => setWorkOrder(item)}
                  valueLabel={workOrder?.label ?? ""}
                  placeholder="Search work orders..."
                  pageSize={10}
                  cacheKey={organizationId ? `mh-workorders:${organizationId}` : undefined}
                  cacheTTL={60_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchWorkOrdersSelectPage({ organizationId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.work_order_id ? <div className="text-xs text-destructive">{fieldErrors.work_order_id}</div> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Performed At</label>
              <Input value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} type="date" />
              {fieldErrors.performed_at ? <div className="text-xs text-destructive">{fieldErrors.performed_at}</div> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  const errs: Record<string, string> = {};
                  if (!user?.id) errs.performed_by = "Performed by is required.";
                  if (!workOrder?.id) errs.work_order_id = "Work order is required.";
                  if (!performedAt.trim()) errs.performed_at = "Performed at is required.";
                  if (Object.keys(errs).length) {
                    setFieldErrors(errs);
                    return;
                  }
                  setFieldErrors({});
                  onSubmit({
                    performed_by: user!.id,
                    work_order_id: workOrder!.id,
                    performed_at: normalizeDateOnly(performedAt),
                    notes: notes.trim(),
                  });
                }}
              >
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
        <div className="h-5" />
      </div>
    </div>,
    document.body,
  );
}

export function MaintenancePlanDetailsClient({ planId }: { planId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";

  const planQuery = useQuery<PlenumMaintenancePlan, unknown>({
    queryKey: ["plenum-maintenance-plan", planId],
    enabled: Boolean(planId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getMaintenancePlan({ id: planId, signal }),
  });

  const assetId = planQuery.data?.asset_id ?? "";

  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);

  useEffect(() => {
    setHistoryPage(1);
  }, [assetId]);

  const historyQuery = useQuery<PlenumPage<PlenumMaintenanceHistory>, unknown>({
    queryKey: ["plenum-maintenance-history", assetId, historyPage, historyPageSize],
    enabled: Boolean(assetId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      listMaintenanceHistory({
        assetId,
        limit: historyPageSize,
        offset: (historyPage - 1) * historyPageSize,
        signal,
      }),
  });

  const historyRows = historyQuery.data?.data ?? [];
  const historyTotal = historyQuery.data?.total ?? 0;

  useEffect(() => {
    if (!historyQuery.data) return;
    const totalPages = Math.max(1, Math.ceil(historyTotal / Math.max(1, historyPageSize)));
    if (historyPage > totalPages) setHistoryPage(totalPages);
  }, [historyPage, historyPageSize, historyQuery.data, historyTotal]);

  const userMapQuery = useQuery({
    queryKey: ["plenum-users-lite", organizationId],
    enabled: Boolean(organizationId),
    retry: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => listUsers({ organizationId, limit: 200, offset: 0, signal }),
  });

  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of userMapQuery.data?.data ?? []) {
      const name = u.full_name?.trim() || u.email?.trim() || u.id;
      map.set(u.id, name);
    }
    return map;
  }, [userMapQuery.data?.data]);

  useEffect(() => {
    const e = planQuery.error ?? historyQuery.error;
    const isErr = planQuery.isError || historyQuery.isError;
    if (!isErr) return;
    if (e instanceof ApiError && e.status === 401) router.replace(APP_ROUTES.login);
  }, [historyQuery.error, historyQuery.isError, planQuery.error, planQuery.isError, router]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [editingHistory, setEditingHistory] = useState<PlenumMaintenanceHistory | null>(null);

  const [deletePlanOpen, setDeletePlanOpen] = useState(false);
  const [deleteHistoryOpen, setDeleteHistoryOpen] = useState(false);
  const [deleteHistoryId, setDeleteHistoryId] = useState<string | null>(null);

  const createWoMutation = useMutation<{ id: string }, unknown>({
    mutationFn: async () => {
      const currentPlan = planQuery.data;
      if (!currentPlan) throw new Error("Plan not loaded");
      const body: Record<string, unknown> = {
        title: currentPlan.maintenance_type ?? "Scheduled Maintenance",
        description: `PPM work order generated from maintenance plan. Frequency: ${currentPlan.frequency_type ?? "-"} × ${currentPlan.frequency_value ?? "-"}.`,
        priority: "medium",
        status: "pending",
        organization_id: organizationId,
      };
      if (currentPlan.asset_id) body.asset_id = currentPlan.asset_id;
      return apiFetch<{ id: string }>("/api/v1/plenum/work-orders", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body,
      });
    },
    onSuccess: (data) => {
      toast({ title: "Work order created from PPM plan", variant: "success" });
      router.push(`${APP_ROUTES.workOrders}/${data.id}`);
    },
    onError: (e) => {
      toast({ title: "Failed to create work order", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const deletePlanMutation = useMutation<void, unknown>({
    mutationFn: async () => {
      await deleteMaintenancePlan({ id: planId });
    },
    onSuccess: async () => {
      toast({ title: "Maintenance plan deleted", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["plenum-maintenance-plans"] });
      router.push(APP_ROUTES.preventiveMaintenance);
    },
    onError: (e) => {
      toast({ title: "Failed to delete plan", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const saveHistoryMutation = useMutation<void, unknown, { payload: { performed_by: string; work_order_id: string; performed_at: string; notes: string } }>({
    mutationFn: async ({ payload }) => {
      if (!assetId) throw new Error("Missing asset id.");
      if (editingHistory) {
        await updateMaintenanceHistory({
          id: editingHistory.id,
          body: {
            asset_id: assetId,
            work_order_id: payload.work_order_id,
            performed_by: payload.performed_by,
            performed_at: payload.performed_at,
            notes: payload.notes || undefined,
          },
        });
      } else {
        await createMaintenanceHistory({
          asset_id: assetId,
          work_order_id: payload.work_order_id,
          performed_by: payload.performed_by,
          performed_at: payload.performed_at,
          notes: payload.notes,
        });
      }
    },
    onSuccess: async () => {
      toast({ title: editingHistory ? "History updated" : "History added", variant: "success" });
      setHistoryModalOpen(false);
      setEditingHistory(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-maintenance-history", assetId] });
    },
    onError: (e) => {
      toast({ title: "Failed to save history", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const deleteHistoryMutation = useMutation<void, unknown, { id: string }>({
    mutationFn: async ({ id }) => {
      await deleteMaintenanceHistory({ id });
    },
    onSuccess: async () => {
      toast({ title: "History deleted", variant: "success" });
      setDeleteHistoryOpen(false);
      setDeleteHistoryId(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-maintenance-history", assetId] });
    },
    onError: (e) => {
      toast({ title: "Failed to delete history", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const columns = useMemo<ColDef<PlenumMaintenanceHistory>[]>(
    () => [
      {
        headerName: "Performed At",
        field: "performed_at",
        width: 190,
        valueFormatter: (p) => {
          const v = typeof p.value === "string" ? p.value : "";
          if (!v) return "-";
          return isoToDateOnly(v) || v;
        },
      },
      {
        headerName: "Performed By",
        field: "performed_by",
        minWidth: 200,
        flex: 1,
        valueFormatter: (p) => {
          const id = typeof p.value === "string" ? p.value : "";
          if (!id) return "-";
          return userNameById.get(id) ?? id;
        },
      },
      { headerName: "Work Order", field: "work_order_id", minWidth: 220, flex: 1, valueFormatter: (p) => String(p.value ?? "-") },
      { headerName: "Notes", field: "notes", minWidth: 260, flex: 1, valueFormatter: (p) => String(p.value ?? "-") },
      {
        headerName: "Actions",
        field: "id",
        width: 120,
        cellRenderer: (p: ICellRendererParams<PlenumMaintenanceHistory, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                aria-label="Edit"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingHistory(row);
                  setHistoryModalOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="destructive"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteHistoryId(row.id);
                  setDeleteHistoryOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [userNameById],
  );

  if (planQuery.isFetching && !planQuery.data) {
    return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Loading maintenance plan...</div>;
  }

  if (planQuery.isError) {
    return <div className="rounded-xl border bg-card p-4 text-sm text-destructive">{getErrorMessage(planQuery.error)}</div>;
  }

  const plan = planQuery.data;
  if (!plan) {
    return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Maintenance plan not found.</div>;
  }

  return (
    <div className="space-y-4">
      <Card className="bg-card/50 backdrop-blur-sm">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link href={APP_ROUTES.preventiveMaintenance} aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="space-y-1">
              <div className="text-xl font-bold leading-tight">{plan.maintenance_type ?? "Maintenance Plan"}</div>
              <div className="text-sm text-muted-foreground">
                {plan.frequency_type ?? "-"} • {typeof plan.frequency_value === "number" ? plan.frequency_value : "-"} • Next due{" "}
                {plan.next_due_date ? plan.next_due_date.slice(0, 10) : "-"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
              disabled={!organizationId || createWoMutation.isPending}
              onClick={() => createWoMutation.mutate()}
            >
              <ClipboardPlus className="h-4 w-4" />
              {createWoMutation.isPending ? "Creating…" : "Create Work Order"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                setEditingHistory(null);
                setHistoryModalOpen(true);
              }}
              disabled={!organizationId || !assetId}
            >
              <Plus className="h-4 w-4" />
              Add History
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => router.push(`${APP_ROUTES.preventiveMaintenance}/${planId}/edit`)}
            >
              <Pencil className="h-4 w-4" />
              Edit Plan
            </Button>
            <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeletePlanOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Maintenance History</CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => {
              setEditingHistory(null);
              setHistoryModalOpen(true);
            }}
            disabled={!organizationId || !assetId}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </CardHeader>
        <CardContent>
          <AgDataGrid<PlenumMaintenanceHistory>
            rowData={historyRows}
            columnDefs={columns}
            pagination={false}
            serverPagination={{
              page: historyPage,
              pageSize: historyPageSize,
              total: historyTotal,
              onPageChange: setHistoryPage,
              onPageSizeChange: (next) => {
                setHistoryPageSize(next);
                setHistoryPage(1);
              },
            }}
            enableQuickFilter={false}
            className="bg-card/30"
            height={420}
            loading={historyQuery.isLoading || historyQuery.isFetching}
            emptyState={{
              title: "No history",
              description: "No maintenance history records are available.",
            }}
          />
        </CardContent>
      </Card>

      {mounted ? (
        <HistoryModal
          open={historyModalOpen}
          pending={saveHistoryMutation.isPending}
          organizationId={organizationId}
          initial={editingHistory}
          onClose={() => {
            if (saveHistoryMutation.isPending) return;
            setHistoryModalOpen(false);
            setEditingHistory(null);
          }}
          onSubmit={(payload) => saveHistoryMutation.mutate({ payload })}
        />
      ) : null}

      <ConfirmDialog
        open={deletePlanOpen}
        onOpenChange={setDeletePlanOpen}
        title="Delete maintenance plan?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deletePlanMutation.isPending}
        onConfirm={async () => {
          await deletePlanMutation.mutateAsync();
        }}
      />

      <ConfirmDialog
        open={deleteHistoryOpen}
        onOpenChange={setDeleteHistoryOpen}
        title="Delete history record?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deleteHistoryMutation.isPending}
        onConfirm={async () => {
          if (!deleteHistoryId) return;
          await deleteHistoryMutation.mutateAsync({ id: deleteHistoryId });
        }}
      />
    </div>
  );
}
