"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, CardContent, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError, apiFetch } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import { listVendors } from "@/features/vendor/plenum-api";
import { listTechnicians, technicianDisplayName } from "@/features/technicians/plenum-api";
import { WorkOrderTasksPanel } from "@/features/work-orders/work-order-tasks-panel";

type Mode = "create" | "edit";

type PlenumWorkOrder = {
  id: string;
  organization_id: string;
  asset_id: string;
  location_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_by?: string;
  assigned_technician?: string | null;
  assigned_vendor?: string | null;
  sla_id?: string | null;
  sla_due_at?: string | null;
  completed_at?: string | null;
};

type FastApiValidationIssue = {
  loc: Array<string | number>;
  msg: string;
};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const textareaClassName =
  "min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const DUMMY_CREATED_BY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

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

function extractFieldErrorsFromPayload(payload: unknown): Record<string, string> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  const out: Record<string, string> = {};
  if ("detail" in rec) {
    const detail = (rec as { detail: unknown }).detail;
    if (Array.isArray(detail)) {
      for (const it of detail) {
        if (typeof it !== "object" || it === null) continue;
        const issue = it as Partial<FastApiValidationIssue>;
        if (Array.isArray(issue.loc) && typeof issue.msg === "string") {
          const key = [...issue.loc].reverse().find((x) => typeof x === "string" && (x as string).trim());
          if (typeof key === "string") out[key] = issue.msg;
        }
      }
    } else if (typeof detail === "string") {
      out._ = detail;
    }
  }
  return Object.keys(out).length ? out : null;
}

// removed datetime-local helpers in favor of date-only helpers

function toDateOnly(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const parts = iso.split("T")[0] ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// no longer exporting raw date-only value; we build midnight ISO at submit time

async function fetchAssetsPage({
  organizationId,
  limit,
  offset,
  search,
  signal,
}: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("organization_id", organizationId);
  if (search.trim()) params.set("search", search.trim());
  const payload = await apiFetch<unknown>(`/api/v1/plenum/assets?${params.toString()}`, { signal });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : [];
  const data = raw
    .map((x): InfiniteSelectItem | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id =
        typeof r.id === "string" ? r.id : typeof r.asset_id === "string" ? r.asset_id : "";
      const name =
        typeof r.asset_name === "string"
          ? r.asset_name
          : typeof r.name === "string"
            ? r.name
            : "";
      const code =
        typeof r.asset_code === "string"
          ? r.asset_code
          : typeof r.code === "string"
            ? r.code
            : "";
      if (!id.trim() || !name.trim()) return null;
      const label = code.trim() ? `${name} (${code})` : name;
      return { id, label };
    })
    .filter((v): v is InfiniteSelectItem => Boolean(v));
  return { total, data };
}

async function fetchLocationsPage({
  organizationId,
  limit,
  offset,
  search,
  signal,
}: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("organization_id", organizationId);
  if (search.trim()) params.set("search", search.trim());
  const payload = await apiFetch<unknown>(`/api/v1/plenum/locations?${params.toString()}`, { signal });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.locations) ? obj.locations : [];
  const data = raw
    .map((x): InfiniteSelectItem | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id =
        typeof r.id === "string"
          ? r.id
          : typeof r.location_id === "string"
            ? r.location_id
            : "";
      const name =
        typeof r.name === "string"
          ? r.name
          : typeof r.location_name === "string"
            ? r.location_name
            : "";
      if (!id.trim() || !name.trim()) return null;
      return { id, label: name };
    })
    .filter((v): v is InfiniteSelectItem => Boolean(v));
  return { total, data };
}

async function resolveLabelById(input: {
  organizationId: string;
  kind: "asset" | "location" | "vendor" | "technician" | "sla";
  id: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  try {
    if (input.kind === "asset") {
      const a = await apiFetch<Record<string, unknown>>(
        `/api/v1/plenum/assets/${encodeURIComponent(input.id)}`,
        { signal: input.signal },
      );
      const name =
        typeof a.asset_name === "string"
          ? a.asset_name
          : typeof a.name === "string"
            ? a.name
            : "";
      const code =
        typeof a.asset_code === "string"
          ? a.asset_code
          : typeof a.code === "string"
            ? a.code
            : "";
      const label = name && code ? `${name} (${code})` : name || code || "";
      return label || null;
    } else {
      if (input.kind === "vendor") {
        const v = await apiFetch<Record<string, unknown>>(
          `/api/v1/plenum/vendors/${encodeURIComponent(input.id)}`,
          { signal: input.signal },
        );
        const name =
          typeof v.name === "string"
            ? v.name
            : typeof v.vendor_name === "string"
              ? v.vendor_name
              : typeof v.company_name === "string"
                ? v.company_name
                : "";
        return name || null;
      }
      if (input.kind === "technician") {
        const t = await apiFetch<Record<string, unknown>>(
          `/api/v1/plenum/technicians/${encodeURIComponent(input.id)}`,
          { signal: input.signal },
        );
        const firstName = typeof t.first_name === "string" ? t.first_name : "";
        const lastName = typeof t.last_name === "string" ? t.last_name : "";
        const full = `${firstName} ${lastName}`.trim();
        const baseLocation = typeof t.base_location === "string" ? t.base_location : "";
        const userId = typeof t.user_id === "string" ? t.user_id : "";
        const name =
          full ||
          (typeof t.name === "string" ? t.name : "") ||
          (typeof t.technician_name === "string" ? t.technician_name : "") ||
          (typeof t.full_name === "string" ? t.full_name : "") ||
          baseLocation ||
          userId;
        return name || null;
      }
      if (input.kind === "sla") {
        const s = await apiFetch<Record<string, unknown>>(
          `/api/v1/plenum/sla-policies/${encodeURIComponent(input.id)}`,
          { signal: input.signal },
        );
        const name =
          typeof s.name === "string"
            ? s.name
            : typeof s.policy_name === "string"
              ? s.policy_name
              : typeof s.title === "string"
                ? s.title
                : typeof s.sla_name === "string"
                  ? s.sla_name
                  : "";
        const code = typeof s.code === "string" ? s.code : "";
        const label = name && code ? `${name} (${code})` : name || code || "";
        return label || null;
      }

      const l = await apiFetch<Record<string, unknown>>(
        `/api/v1/plenum/locations/${encodeURIComponent(input.id)}`,
        { signal: input.signal },
      );
      const name =
        typeof l.name === "string"
          ? l.name
          : typeof l.location_name === "string"
            ? l.location_name
            : "";
      return name || null;
    }
  } catch {
    if (input.kind === "asset") {
      const page = await fetchAssetsPage({
        organizationId: input.organizationId,
        limit: 200,
        offset: 0,
        search: "",
        signal: input.signal,
      });
      const found = page.data.find((d) => d.id === input.id);
      return found?.label ?? null;
    }
    if (input.kind === "location") {
      const page = await fetchLocationsPage({
        organizationId: input.organizationId,
        limit: 200,
        offset: 0,
        search: "",
        signal: input.signal,
      });
      const found = page.data.find((d) => d.id === input.id);
      return found?.label ?? null;
    }
    if (input.kind === "vendor") {
      const page = await listVendors({
        organizationId: input.organizationId,
        limit: 20,
        offset: 0,
        signal: input.signal,
      });
      const found = page.data.find((d) => d.id === input.id);
      return found ? found.name : null;
    }
    if (input.kind === "sla") {
      const page = await fetchSlaPoliciesSelectPage({
        organizationId: input.organizationId,
        limit: 200,
        offset: 0,
        search: "",
        signal: input.signal,
      });
      const found = page.data.find((d) => d.id === input.id);
      return found?.label ?? null;
    }
    const page = await listTechnicians({
      organizationId: input.organizationId,
      limit: 20,
      offset: 0,
      signal: input.signal,
    });
    const found = page.data.find((d) => d.id === input.id);
    return found ? technicianDisplayName(found) : null;
  }
}

async function fetchSlaPoliciesSelectPage({
  organizationId,
  limit,
  offset,
  search,
  signal,
}: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("organization_id", organizationId);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (search.trim()) params.set("search", search.trim());

  let payload: unknown;
  try {
    payload = await apiFetch<unknown>(`/api/v1/plenum/sla-policies?${params.toString()}`, { signal });
  } catch (e) {
    if (search.trim()) {
      const fallbackParams = new URLSearchParams();
      fallbackParams.set("organization_id", organizationId);
      fallbackParams.set("limit", String(limit));
      fallbackParams.set("offset", String(offset));
      payload = await apiFetch<unknown>(`/api/v1/plenum/sla-policies?${fallbackParams.toString()}`, { signal });
    } else {
      throw e;
    }
  }

  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.sla_policies)
      ? obj.sla_policies
      : Array.isArray(obj.slaPolicies)
        ? obj.slaPolicies
        : [];

  const data = raw
    .map((x): InfiniteSelectItem | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id =
        typeof r.id === "string"
          ? r.id
          : typeof r.sla_id === "string"
            ? r.sla_id
            : typeof r.policy_id === "string"
              ? r.policy_id
              : "";
      const name =
        typeof r.name === "string"
          ? r.name
          : typeof r.policy_name === "string"
            ? r.policy_name
            : typeof r.title === "string"
              ? r.title
              : typeof r.sla_name === "string"
                ? r.sla_name
                : "";
      const code = typeof r.code === "string" ? r.code : "";
      const label = name && code ? `${name} (${code})` : name || code || "";
      if (!id.trim()) return null;
      return { id, label: label || id };
    })
    .filter((v): v is InfiniteSelectItem => Boolean(v));

  return { total, data };
}

async function fetchVendorsSelectPage({
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
  const page = await listVendors({ organizationId, limit, offset, signal });
  return { total: page.total, data: page.data.map((v) => ({ id: v.id, label: v.name })) };
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

export function WorkOrderForm({
  mode,
  workOrderId,
  initial,
  onSuccess,
}: {
  mode: Mode;
  workOrderId?: string;
  initial?: PlenumWorkOrder | null;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectedOrgId = orgSelected?.id ?? "";
  const selectedOrgName = orgSelected?.name ?? "";
  const [orgId, setOrgId] = useState(selectedOrgId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("open");

  const [assetOpen, setAssetOpen] = useState(false);
  const [asset, setAsset] = useState<InfiniteSelectItem | null>(null);

  const [locationOpen, setLocationOpen] = useState(false);
  const [location, setLocation] = useState<InfiniteSelectItem | null>(null);

  const [technicianOpen, setTechnicianOpen] = useState(false);
  const [technician, setTechnician] = useState<InfiniteSelectItem | null>(null);

  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendor, setVendor] = useState<InfiniteSelectItem | null>(null);

  const [slaOpen, setSlaOpen] = useState(false);
  const [sla, setSla] = useState<InfiniteSelectItem | null>(null);
  const [slaDueAtLocal, setSlaDueAtLocal] = useState("");
  const [completedAtLocal, setCompletedAtLocal] = useState("");

  const detailsQuery = useQuery<PlenumWorkOrder, unknown>({
    queryKey: ["plenum-work-order", workOrderId],
    enabled: mode === "edit" && Boolean(workOrderId) && !initial,
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      apiFetch<PlenumWorkOrder>(`/api/v1/plenum/work-orders/${encodeURIComponent(workOrderId ?? "")}`, {
        signal,
      }),
  });

  useEffect(() => {
    if (mode !== "create") return;
    setOrgId(selectedOrgId);
  }, [mode, selectedOrgId]);

  const applyWorkOrder = useCallback((wo: PlenumWorkOrder) => {
    setOrgId(wo.organization_id ?? "");
    setTitle(wo.title ?? "");
    setDescription(wo.description ?? "");
    setPriority(wo.priority ?? "medium");
    setStatus(wo.status ?? "open");
    setAsset(wo.asset_id ? { id: wo.asset_id, label: wo.asset_id } : null);
    setLocation(wo.location_id ? { id: wo.location_id, label: wo.location_id } : null);
    setTechnician(wo.assigned_technician ? { id: wo.assigned_technician, label: wo.assigned_technician } : null);
    setVendor(wo.assigned_vendor ? { id: wo.assigned_vendor, label: wo.assigned_vendor } : null);
    setSla(wo.sla_id ? { id: wo.sla_id, label: wo.sla_id } : null);
    setSlaDueAtLocal(wo.sla_due_at ? toDateOnly(wo.sla_due_at) : "");
    setCompletedAtLocal(wo.completed_at ? toDateOnly(wo.completed_at) : "");
    setFieldErrors({});
    setSubmitError(null);
  }, []);

  useEffect(() => {
    if (!initial) return;
    applyWorkOrder(initial);
  }, [applyWorkOrder, initial]);

  useEffect(() => {
    if (mode !== "edit") return;
    if (!detailsQuery.data) return;
    applyWorkOrder(detailsQuery.data);
  }, [applyWorkOrder, detailsQuery.data, mode]);

  useEffect(() => {
    if (mode !== "create") return;
    setFieldErrors({});
    setSubmitError(null);
    setAsset(null);
    setLocation(null);
    setTechnician(null);
    setVendor(null);
    setSla(null);
  }, [mode, orgId]);

  useEffect(() => {
    if (mode !== "edit") return;
    if (!orgId) return;
    const ac = new AbortController();
    async function run() {
      if (asset?.id && asset.label === asset.id) {
        const label = await resolveLabelById({
          organizationId: orgId,
          kind: "asset",
          id: asset.id,
          signal: ac.signal,
        }).catch(() => null);
        if (label) setAsset({ id: asset.id, label });
      }
      if (location?.id && location.label === location.id) {
        const label = await resolveLabelById({
          organizationId: orgId,
          kind: "location",
          id: location.id,
          signal: ac.signal,
        }).catch(() => null);
        if (label) setLocation({ id: location.id, label });
      }
      if (technician?.id && technician.label === technician.id) {
        const label = await resolveLabelById({
          organizationId: orgId,
          kind: "technician",
          id: technician.id,
          signal: ac.signal,
        }).catch(() => null);
        if (label) setTechnician({ id: technician.id, label });
      }
      if (vendor?.id && vendor.label === vendor.id) {
        const label = await resolveLabelById({
          organizationId: orgId,
          kind: "vendor",
          id: vendor.id,
          signal: ac.signal,
        }).catch(() => null);
        if (label) setVendor({ id: vendor.id, label });
      }
      if (sla?.id && sla.label === sla.id) {
        const label = await resolveLabelById({
          organizationId: orgId,
          kind: "sla",
          id: sla.id,
          signal: ac.signal,
        }).catch(() => null);
        if (label) setSla({ id: sla.id, label });
      }
    }
    run();
    return () => ac.abort();
  }, [
    asset?.id,
    asset?.label,
    location?.id,
    location?.label,
    technician?.id,
    technician?.label,
    vendor?.id,
    vendor?.label,
    sla?.id,
    sla?.label,
    mode,
    orgId,
  ]);

  const saveMutation = useMutation<void, unknown>({
    mutationFn: async () => {
      const nextErrors: Record<string, string> = {};
      const t = title.trim();
      const aId = asset?.id ?? "";
      const lId = location?.id ?? "";

      if (!orgId) nextErrors.organization_id = "Organization is required.";
      if (!t) nextErrors.title = "Title is required.";
      if (!aId) nextErrors.asset_id = "Asset is required.";
      else if (!isUuid(aId)) nextErrors.asset_id = "Invalid asset id.";
      if (!lId) nextErrors.location_id = "Location is required.";
      else if (!isUuid(lId)) nextErrors.location_id = "Invalid location id.";

      if (!priority.trim()) nextErrors.priority = "Priority is required.";
      if (!status.trim()) nextErrors.status = "Status is required.";

      if (technician?.id && !isUuid(technician.id))
        nextErrors.assigned_technician = "Invalid technician id.";
      if (vendor?.id && !isUuid(vendor.id))
        nextErrors.assigned_vendor = "Invalid vendor id.";
      if (sla?.id && !isUuid(sla.id)) nextErrors.sla_id = "Invalid SLA id.";

      if (Object.keys(nextErrors).length) {
        setFieldErrors(nextErrors);
        throw new Error("VALIDATION");
      }

      setFieldErrors({});

      if (mode === "create") {
        await apiFetch("/api/v1/plenum/work-orders", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            organization_id: orgId,
            asset_id: aId,
            location_id: lId,
            title: t,
            description: description.trim(),
            priority: priority.trim(),
            status: "open",
            created_by: DUMMY_CREATED_BY,
            assigned_technician: technician?.id || undefined,
            assigned_vendor: vendor?.id || undefined,
            sla_id: sla?.id || undefined,
            sla_due_at: slaDueAtLocal ? `${slaDueAtLocal}T00:00:00` : undefined,
          },
        });
      } else {
        await apiFetch(`/api/v1/plenum/work-orders/${encodeURIComponent(workOrderId ?? "")}`, {
          method: "PUT",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            asset_id: aId,
            location_id: lId,
            title: t,
            description: description.trim(),
            priority: priority.trim(),
            status: status.trim(),
            assigned_technician: technician?.id || undefined,
            assigned_vendor: vendor?.id || undefined,
            sla_id: sla?.id || undefined,
            sla_due_at: slaDueAtLocal ? `${slaDueAtLocal}T00:00:00` : undefined,
            completed_at: completedAtLocal ? `${completedAtLocal}T00:00:00` : undefined,
          },
        });
      }
    },
    onSuccess: async () => {
      toast({
        title: mode === "create" ? "Work order created" : "Work order updated",
        variant: "success",
      });

      await queryClient.invalidateQueries({ queryKey: ["plenum-work-orders"] });
      if (workOrderId) {
        await queryClient.invalidateQueries({ queryKey: ["plenum-work-order", workOrderId] });
      }

      onSuccess?.();
      if (mode === "create") {
        router.push(APP_ROUTES.workOrdersNew);
      } else if (workOrderId) {
        router.push(`${APP_ROUTES.workOrders}/${workOrderId}`);
      } else {
        router.push(APP_ROUTES.workOrdersNew);
      }
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "VALIDATION") return;
      if (e instanceof ApiError && e.status === 401) {
        router.replace(APP_ROUTES.login);
        return;
      }
      if (e instanceof ApiError) {
        const fe = extractFieldErrorsFromPayload(e.payload);
        if (fe) {
          const msg = fe._;
          const { _, ...rest } = fe as Record<string, string>;
          if (Object.keys(rest).length) setFieldErrors(rest);
          if (msg) setSubmitError(msg);
          if (!msg && Object.keys(rest).length === 0) setSubmitError(e.message);
        } else {
          setSubmitError(getErrorMessage(e));
        }
        return;
      }
      setSubmitError(getErrorMessage(e));
    },
  });

  const pending = saveMutation.isPending;
  const disableSubmit = pending || !orgId || (mode === "edit" && !workOrderId);

  const cancelHref =
    mode === "edit" && workOrderId ? `${APP_ROUTES.workOrders}/${workOrderId}` : APP_ROUTES.workOrdersNew;

  const header = useMemo(() => {
    if (mode === "create") return "Add Work Order";
    return "Edit Work Order";
  }, [mode]);

  const orgLabel = useMemo(() => {
    if (!orgId) return "Select organization from header";
    if (selectedOrgId && selectedOrgId === orgId && selectedOrgName) return selectedOrgName;
    return orgId;
  }, [orgId, selectedOrgId, selectedOrgName]);

  if (mode === "edit" && !workOrderId) {
    return <div className="rounded-xl border bg-card p-4 text-sm text-destructive">Missing work order id.</div>;
  }

  if (mode === "edit" && detailsQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (mode === "edit" && detailsQuery.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{getErrorMessage(detailsQuery.error)}</p>
        <Button variant="outline" onClick={() => detailsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <form
      className="w-full"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitError(null);
        saveMutation.mutate();
      }}
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <CardTitle>{header}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {orgLabel}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            {fieldErrors.title ? <p className="text-xs text-destructive">{fieldErrors.title}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className={textareaClassName}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details"
            />
            {fieldErrors.description ? (
              <p className="text-xs text-destructive">{fieldErrors.description}</p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <div>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClassName}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                {fieldErrors.priority ? <p className="text-xs text-destructive">{fieldErrors.priority}</p> : null}
              </div>

            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <div>
                <select
                  value={mode === "create" ? "open" : status}
                  onChange={(e) => setStatus(e.target.value)}
                  className={selectClassName}
                  disabled={mode === "create"}
                  title={mode === "create" ? "Status is set to Open on creation" : undefined}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                </select>
                {fieldErrors.status ? <p className="text-xs text-destructive">{fieldErrors.status}</p> : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 relative z-50">
            <div className="space-y-2">
              <label className="text-sm font-medium">Asset</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setAssetOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{asset?.label ?? "Select asset"}</span>
                </Button>
                <InfiniteSelect
                  open={assetOpen}
                  onClose={() => setAssetOpen(false)}
                  onSelect={(item) => setAsset(item)}
                  valueLabel={asset?.label ?? ""}
                  placeholder="Search assets..."
                  pageSize={10}
                  cacheKey={orgId ? `wo-assets:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchAssetsPage({ organizationId: orgId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.asset_id ? <p className="text-xs text-destructive">{fieldErrors.asset_id}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Location</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setLocationOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{location?.label ?? "Select location"}</span>
                </Button>
                <InfiniteSelect
                  open={locationOpen}
                  onClose={() => setLocationOpen(false)}
                  onSelect={(item) => setLocation(item)}
                  valueLabel={location?.label ?? ""}
                  placeholder="Search locations..."
                  pageSize={10}
                  cacheKey={orgId ? `wo-locations:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchLocationsPage({ organizationId: orgId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.location_id ? (
                <p className="text-xs text-destructive">{fieldErrors.location_id}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 relative z-40">
            <div className="space-y-2">
              <label className="text-sm font-medium">Assigned Technician (Optional)</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setTechnicianOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{technician?.label ?? "Select technician"}</span>
                </Button>
                <InfiniteSelect
                  open={technicianOpen}
                  onClose={() => setTechnicianOpen(false)}
                  onSelect={(item) => setTechnician(item)}
                  valueLabel={technician?.label ?? ""}
                  placeholder="Search technicians..."
                  pageSize={10}
                  cacheKey={orgId ? `wo-technicians:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, signal }) =>
                    fetchTechniciansSelectPage({ organizationId: orgId, limit, offset, signal })
                  }
                />
              </div>
              {fieldErrors.assigned_technician ? (
                <p className="text-xs text-destructive">{fieldErrors.assigned_technician}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assigned Vendor (Optional)</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setVendorOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{vendor?.label ?? "Select vendor"}</span>
                </Button>
                <InfiniteSelect
                  open={vendorOpen}
                  onClose={() => setVendorOpen(false)}
                  onSelect={(item) => setVendor(item)}
                  valueLabel={vendor?.label ?? ""}
                  placeholder="Search vendors..."
                  pageSize={10}
                  cacheKey={orgId ? `wo-vendors:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, signal }) =>
                    fetchVendorsSelectPage({ organizationId: orgId, limit, offset, signal })
                  }
                />
              </div>
              {fieldErrors.assigned_vendor ? (
                <p className="text-xs text-destructive">{fieldErrors.assigned_vendor}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 relative z-30">
            <div className="space-y-2">
              <label className="text-sm font-medium">SLA (Optional)</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setSlaOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{sla?.label ?? "Select SLA policy"}</span>
                </Button>
                <InfiniteSelect
                  open={slaOpen}
                  onClose={() => setSlaOpen(false)}
                  onSelect={(item) => setSla(item)}
                  valueLabel={sla?.label ?? ""}
                  placeholder="Search SLA policies..."
                  pageSize={10}
                  cacheKey={orgId ? `wo-sla-policies:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchSlaPoliciesSelectPage({ organizationId: orgId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.sla_id ? <p className="text-xs text-destructive">{fieldErrors.sla_id}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">SLA Due Date (Optional)</label>
              <Input
                type="date"
                value={slaDueAtLocal}
                onChange={(e) => setSlaDueAtLocal(e.target.value)}
              />
              {fieldErrors.sla_due_at ? (
                <p className="text-xs text-destructive">{fieldErrors.sla_due_at}</p>
              ) : null}
            </div>
          </div>

          {mode === "edit" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Completed Date (Optional)</label>
              <Input
                type="date"
                value={completedAtLocal}
                onChange={(e) => setCompletedAtLocal(e.target.value)}
              />
              {fieldErrors.completed_at ? (
                <p className="text-xs text-destructive">{fieldErrors.completed_at}</p>
              ) : null}
            </div>
          ) : null}

          <WorkOrderTasksPanel
            mode={mode}
            workOrderId={workOrderId}
            assignedTechnicianId={technician?.id}
          />

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          {fieldErrors.organization_id ? (
            <p className="text-sm text-destructive">{fieldErrors.organization_id}</p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="secondary" disabled={disableSubmit}>
              <Link href={cancelHref}>Cancel</Link>
            </Button>
            <Button disabled={disableSubmit} type="submit">
              {pending ? "Saving..." : mode === "create" ? "Add Work Order" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
