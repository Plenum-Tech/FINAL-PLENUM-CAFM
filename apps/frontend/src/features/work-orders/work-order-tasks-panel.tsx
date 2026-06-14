"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { ApiError, apiFetch } from "@/services/api";
import { APP_ROUTES } from "@/constants";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import { listTechnicians } from "@/features/technicians/plenum-api";
import { useOrganizationStore } from "@/store/organizationStore";

type Mode = "create" | "edit";

function isoToDateOnly(v: string | null | undefined): string {
  if (!v) return "";
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : v;
}

type TaskRow = {
  id: string;
  work_order_id: string;
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  status: "pending" | "in_progress" | "completed" | (string & {});
  completed_at?: string | null;
};

type PlenumTechnician = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  technician_name?: string | null;
  full_name?: string | null;
  base_location?: string | null;
  user_id?: string | null;
  availability_status?: string | null;
};

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

function shortId(id: string): string {
  if (!id) return "-";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function technicianLabelFromRecord(t: PlenumTechnician | null | undefined): string {
  const firstName = typeof t?.first_name === "string" ? t.first_name : "";
  const lastName = typeof t?.last_name === "string" ? t.last_name : "";
  const full = `${firstName} ${lastName}`.trim();
  const baseLocation = typeof t?.base_location === "string" ? t.base_location : "";
  const userId = typeof t?.user_id === "string" ? t.user_id : "";
  return (
    full ||
    (typeof t?.name === "string" ? t.name : "") ||
    (typeof t?.technician_name === "string" ? t.technician_name : "") ||
    (typeof t?.full_name === "string" ? t.full_name : "") ||
    baseLocation ||
    userId ||
    ""
  );
}

async function fetchTechnicianLabelById(input: { id: string; signal?: AbortSignal }): Promise<string | null> {
  const payload = await apiFetch<PlenumTechnician>(`/api/v1/plenum/technicians/${encodeURIComponent(input.id)}`, {
    signal: input.signal,
  });
  const label = technicianLabelFromRecord(payload);
  return label || null;
}

async function listTasks(params: {
  workOrderId: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<{ total: number; data: TaskRow[] }> {
  const q = new URLSearchParams();
  q.set("work_order_id", params.workOrderId);
  q.set("limit", String(params.limit ?? 50));
  q.set("offset", String(params.offset ?? 0));
  const payload = await apiFetch<unknown>(`/api/v1/plenum/work-order-tasks?${q.toString()}`, { signal: params.signal });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.tasks) ? obj.tasks : [];
  const data: TaskRow[] = raw
    .map((x): TaskRow | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id =
        typeof r.id === "string"
          ? r.id
          : typeof r.task_id === "string"
            ? r.task_id
            : "";
      const work_order_id =
        typeof r.work_order_id === "string" ? r.work_order_id : typeof r.wo_id === "string" ? r.wo_id : "";
      const title = typeof r.title === "string" ? r.title : "";
      if (!id || !work_order_id || !title) return null;
      return {
        id,
        work_order_id,
        title,
        description: typeof r.description === "string" ? r.description : null,
        assigned_to: typeof r.assigned_to === "string" ? r.assigned_to : null,
        status: (typeof r.status === "string" ? r.status : "pending") as TaskRow["status"],
        completed_at: typeof r.completed_at === "string" ? r.completed_at : null,
      };
    })
    .filter((v): v is TaskRow => Boolean(v));
  return { total, data };
}

async function fetchTechniciansSelectPage({
  organizationId,
  limit,
  offset,
  signal,
}: {
  organizationId: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const page = await listTechnicians({ organizationId, limit, offset, signal });
  const data = page.data.map((t) => {
    const status = (t.availability_status ?? "").toLowerCase();
    const tag =
      status === "available"
        ? "Available"
        : status === "busy"
          ? "Busy"
          : status === "on_leave"
            ? "On Leave"
            : status || undefined;
    const tagVariant: "success" | "warning" | "destructive" | "secondary" =
      status === "available"
        ? "success"
        : status === "busy"
          ? "warning"
          : status === "on_leave"
            ? "destructive"
            : "secondary";
    const label = (t.base_location ?? t.user_id ?? t.id) || t.id;
    return { id: t.id, label, tag, tagVariant };
  });
  return { total: page.total, data };
}

export function WorkOrderTasksPanel({
  mode,
  workOrderId,
  assignedTechnicianId,
}: {
  mode: Mode;
  workOrderId?: string;
  assignedTechnicianId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";

  const query = useQuery<{ total: number; data: TaskRow[] }, unknown>({
    queryKey: ["plenum-work-order-tasks", workOrderId],
    enabled: mode === "edit" && Boolean(workOrderId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => listTasks({ workOrderId: workOrderId ?? "", limit: 30, offset: 0, signal }),
  });

  useEffect(() => {
    if (!query.isError) return;
    if (query.error instanceof ApiError && query.error.status === 401) router.replace(APP_ROUTES.login);
  }, [query.error, query.isError, router]);

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskRow["status"]>("pending");
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assignee, setAssignee] = useState<InfiniteSelectItem | null>(null);
  const [completedAt, setCompletedAt] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [technicianNameById, setTechnicianNameById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editing) {
      if (assignedTechnicianId) {
        setAssignee({
          id: assignedTechnicianId,
          label: technicianNameById[assignedTechnicianId] ?? assignedTechnicianId,
        });
      }
      return;
    }
    setTitle(editing.title ?? "");
    setDescription(editing.description ?? "");
    setStatus(editing.status ?? "pending");
    if (assignedTechnicianId) {
      setAssignee({
        id: assignedTechnicianId,
        label: technicianNameById[assignedTechnicianId] ?? assignedTechnicianId,
      });
    } else {
      setAssignee(
        editing.assigned_to
          ? { id: editing.assigned_to, label: technicianNameById[editing.assigned_to] ?? editing.assigned_to }
          : null,
      );
    }
    setCompletedAt(isoToDateOnly(editing.completed_at));
    setFieldErrors({});
  }, [assignedTechnicianId, editing, technicianNameById]);

  const saveMutation = useMutation<void, unknown>({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      const t = title.trim();
      if (!t) errs.title = "Title is required.";
      if (!status) errs.status = "Status is required.";
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        throw new Error("VALIDATION");
      }
      setFieldErrors({});
      if (!workOrderId) throw new Error("Missing work order id.");
      if (editing) {
        await apiFetch(`/api/v1/plenum/work-order-tasks/${encodeURIComponent(editing.id)}`, {
          method: "PUT",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            title: t,
            description: description.trim() || undefined,
            assigned_to: assignedTechnicianId || assignee?.id || undefined,
            status: status.trim(),
            completed_at: completedAt.trim() || undefined,
          },
        });
      } else {
        await apiFetch("/api/v1/plenum/work-order-tasks", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            work_order_id: workOrderId,
            title: t,
            description: description.trim() || undefined,
            assigned_to: assignedTechnicianId || assignee?.id || undefined,
            status: status.trim(),
          },
        });
      }
    },
    onSuccess: async () => {
      toast({ title: editing ? "Task updated" : "Task created", variant: "success" });
      setOpenForm(false);
      setEditing(null);
      setTitle("");
      setDescription("");
      setStatus("pending");
      setAssignee(null);
      setCompletedAt("");
      await queryClient.invalidateQueries({ queryKey: ["plenum-work-order-tasks", workOrderId] });
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "VALIDATION") return;
      toast({ title: "Failed to save task", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteMutation = useMutation<void, unknown, { id: string }>({
    mutationFn: async ({ id }) =>
      apiFetch(`/api/v1/plenum/work-order-tasks/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      }),
    onSuccess: async () => {
      toast({ title: "Task deleted", variant: "success" });
      setConfirmOpen(false);
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-work-order-tasks", workOrderId] });
    },
    onError: (e) => toast({ title: "Failed to delete task", description: getErrorMessage(e), variant: "destructive" }),
  });

  const rows = useMemo(() => query.data?.data ?? [], [query.data?.data]);

  useEffect(() => {
    if (!organizationId) return;
    const ids = new Set<string>();
    for (const r of rows) if (r.assigned_to) ids.add(r.assigned_to);
    if (editing?.assigned_to) ids.add(editing.assigned_to);
    const missing = [...ids].filter((id) => !technicianNameById[id]);
    if (missing.length === 0) return;

    const ac = new AbortController();
    Promise.all(
      missing.map(async (id) => {
        const label = await fetchTechnicianLabelById({ id, signal: ac.signal }).catch(() => null);
        return { id, label: label ?? shortId(id) };
      }),
    )
      .then((updates) => {
        setTechnicianNameById((prev) => {
          const next = { ...prev };
          for (const u of updates) next[u.id] = u.label;
          return next;
        });
      })
      .catch(() => {});

    return () => ac.abort();
  }, [editing?.assigned_to, organizationId, rows, technicianNameById]);

  useEffect(() => {
    if (!assignee?.id) return;
    if (assignee.label !== assignee.id) return;
    const next = technicianNameById[assignee.id];
    if (!next) return;
    setAssignee({ id: assignee.id, label: next });
  }, [assignee?.id, assignee?.label, technicianNameById]);

  if (mode === "create") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Task Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">Save work order first to add tasks.</div>
          <div>
            <Button size="sm" type="button" disabled>
              Push Task
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold">Task Checklist</div>
        <Button size="sm" type="button" onClick={() => setOpenForm(true)}>
          Push Task
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          {rows.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/30 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{t.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.assigned_to
                    ? `Assigned to: ${technicianNameById[t.assigned_to] ?? t.assigned_to}`
                    : "Unassigned"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs capitalize text-muted-foreground">{t.status}</span>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setEditing(t);
                    setOpenForm(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  type="button"
                  onClick={() => {
                    setDeleteId(t.id);
                    setConfirmOpen(true);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No tasks yet.</div>
          ) : null}
        </CardContent>
      </Card>

      {openForm ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                {fieldErrors.title ? <p className="text-xs text-destructive">{fieldErrors.title}</p> : null}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskRow["status"])}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
                {fieldErrors.status ? <p className="text-xs text-destructive">{fieldErrors.status}</p> : null}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {assignedTechnicianId ? null : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Assigned To (Optional)</label>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between"
                      onClick={() => setAssigneeOpen((v) => !v)}
                      disabled={!organizationId}
                    >
                      <span className="truncate">{assignee?.label ?? "Select technician"}</span>
                    </Button>
                    <InfiniteSelect
                      open={assigneeOpen}
                      onClose={() => setAssigneeOpen(false)}
                      onSelect={(item) => setAssignee(item)}
                      valueLabel={assignee?.label ?? ""}
                      placeholder="Search technicians..."
                      pageSize={10}
                      cacheKey={organizationId ? `wo-technicians:${organizationId}` : undefined}
                      cacheTTL={90_000}
                      fullWidth
                      fetchPage={({ limit, offset, signal }) =>
                        fetchTechniciansSelectPage({ organizationId, limit, offset, signal })
                      }
                    />
                  </div>
                </div>
              )}

              {editing ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Completed At (Optional)</label>
                  <Input
                    type="date"
                    value={completedAt}
                    onChange={(e) => setCompletedAt(e.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setOpenForm(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !organizationId}>
                {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Push"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete task?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          if (deleteId) await deleteMutation.mutateAsync({ id: deleteId });
        }}
      />
    </div>
  );
}
