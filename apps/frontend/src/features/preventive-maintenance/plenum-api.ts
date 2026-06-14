"use client";

import { apiFetch, ApiError } from "@/services/api";

export type PlenumPage<T> = {
  total: number;
  limit: number;
  offset: number;
  data: T[];
};

export type PlenumMaintenancePlan = {
  id: string;
  organization_id: string | null;
  asset_id: string | null;
  maintenance_type: string | null;
  frequency_type: string | null;
  frequency_value: number | null;
  next_due_date: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PlenumMaintenanceHistory = {
  id: string;
  asset_id: string | null;
  work_order_id: string | null;
  performed_by: string | null;
  performed_at: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function parseMaintenancePlan(x: unknown): PlenumMaintenancePlan | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id =
    typeof r.id === "string"
      ? r.id
      : typeof r.plan_id === "string"
        ? r.plan_id
        : typeof r.maintenance_plan_id === "string"
          ? r.maintenance_plan_id
          : "";
  if (!id.trim()) return null;

  const frequency_value =
    typeof r.frequency_value === "number"
      ? r.frequency_value
      : typeof r.frequency_value === "string"
        ? Number(r.frequency_value)
        : typeof r.frequencyValue === "number"
          ? r.frequencyValue
          : null;
  const normalizedFrequencyValue =
    frequency_value === null || Number.isNaN(frequency_value) ? null : frequency_value;

  return {
    id,
    organization_id: typeof r.organization_id === "string" ? r.organization_id : null,
    asset_id: typeof r.asset_id === "string" ? r.asset_id : null,
    maintenance_type: typeof r.maintenance_type === "string" ? r.maintenance_type : null,
    frequency_type: typeof r.frequency_type === "string" ? r.frequency_type : null,
    frequency_value: normalizedFrequencyValue,
    next_due_date: typeof r.next_due_date === "string" ? r.next_due_date : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

function parseMaintenanceHistory(x: unknown): PlenumMaintenanceHistory | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id =
    typeof r.id === "string"
      ? r.id
      : typeof r.mh_id === "string"
        ? r.mh_id
        : typeof r.maintenance_history_id === "string"
          ? r.maintenance_history_id
          : "";
  if (!id.trim()) return null;

  return {
    id,
    asset_id: typeof r.asset_id === "string" ? r.asset_id : null,
    work_order_id: typeof r.work_order_id === "string" ? r.work_order_id : null,
    performed_by: typeof r.performed_by === "string" ? r.performed_by : null,
    performed_at: typeof r.performed_at === "string" ? r.performed_at : null,
    notes: typeof r.notes === "string" ? r.notes : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

export async function listMaintenancePlans(input: {
  organizationId: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumMaintenancePlan>> {
  const params = new URLSearchParams();
  params.set("organization_id", input.organizationId);
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));

  const payload = await apiFetch<unknown>(`/api/v1/plenum/maintenance-plans?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;

  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit ?? 50;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset ?? 0;
  const raw = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.maintenance_plans)
      ? obj.maintenance_plans
      : Array.isArray(obj.maintenancePlans)
        ? obj.maintenancePlans
        : [];

  const data = raw.map(parseMaintenancePlan).filter((v): v is PlenumMaintenancePlan => Boolean(v));
  return { total, limit, offset, data };
}

export async function getMaintenancePlan(input: {
  id: string;
  signal?: AbortSignal;
}): Promise<PlenumMaintenancePlan> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/maintenance-plans/${encodeURIComponent(input.id)}`,
    { signal: input.signal },
  );
  const plan = parseMaintenancePlan(payload);
  if (!plan) throw new Error("Invalid response.");
  return plan;
}

export async function createMaintenancePlan(input: {
  organization_id: string;
  asset_id: string;
  maintenance_type: string;
  frequency_type: string;
  frequency_value: number;
  next_due_date: string;
}): Promise<PlenumMaintenancePlan> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/maintenance-plans", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const plan = parseMaintenancePlan(payload);
  if (plan) return plan;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return getMaintenancePlan({ id });
  }
  throw new Error("Invalid response.");
}

export async function updateMaintenancePlan(input: {
  id: string;
  body: Partial<{
    asset_id: string;
    maintenance_type: string;
    frequency_type: string;
    frequency_value: number;
    next_due_date: string;
  }>;
}): Promise<PlenumMaintenancePlan> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/maintenance-plans/${encodeURIComponent(input.id)}`,
    {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: input.body,
    },
  );
  const plan = parseMaintenancePlan(payload);
  if (plan) return plan;
  return getMaintenancePlan({ id: input.id });
}

export async function deleteMaintenancePlan(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/maintenance-plans/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}

export async function listMaintenanceHistory(input: {
  assetId?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumMaintenanceHistory>> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));
  if (input.assetId?.trim()) params.set("asset_id", input.assetId.trim());

  let payload: unknown;
  try {
    payload = await apiFetch<unknown>(`/api/v1/plenum/maintenance-history?${params.toString()}`, {
      signal: input.signal,
    });
  } catch (e) {
    if (e instanceof ApiError && input.assetId?.trim()) {
      const fallback = new URLSearchParams();
      fallback.set("limit", String(input.limit ?? 50));
      fallback.set("offset", String(input.offset ?? 0));
      payload = await apiFetch<unknown>(`/api/v1/plenum/maintenance-history?${fallback.toString()}`, {
        signal: input.signal,
      });
    } else {
      throw e;
    }
  }

  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;

  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit ?? 50;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset ?? 0;
  const raw = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.maintenance_history)
      ? obj.maintenance_history
      : Array.isArray(obj.maintenanceHistory)
        ? obj.maintenanceHistory
        : [];
  const data = raw.map(parseMaintenanceHistory).filter((v): v is PlenumMaintenanceHistory => Boolean(v));
  return { total, limit, offset, data };
}

export async function getMaintenanceHistory(input: {
  id: string;
  signal?: AbortSignal;
}): Promise<PlenumMaintenanceHistory> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/maintenance-history/${encodeURIComponent(input.id)}`,
    { signal: input.signal },
  );
  const mh = parseMaintenanceHistory(payload);
  if (!mh) throw new Error("Invalid response.");
  return mh;
}

export async function createMaintenanceHistory(input: {
  asset_id: string;
  work_order_id: string;
  performed_by: string;
  performed_at: string;
  notes: string;
}): Promise<PlenumMaintenanceHistory> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/maintenance-history", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const mh = parseMaintenanceHistory(payload);
  if (mh) return mh;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return getMaintenanceHistory({ id });
  }
  throw new Error("Invalid response.");
}

export async function updateMaintenanceHistory(input: {
  id: string;
  body: Partial<{
    asset_id: string;
    work_order_id: string;
    performed_by: string;
    performed_at: string;
    notes: string;
  }>;
}): Promise<PlenumMaintenanceHistory> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/maintenance-history/${encodeURIComponent(input.id)}`,
    {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: input.body,
    },
  );
  const mh = parseMaintenanceHistory(payload);
  if (mh) return mh;
  return getMaintenanceHistory({ id: input.id });
}

export async function deleteMaintenanceHistory(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/maintenance-history/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}

