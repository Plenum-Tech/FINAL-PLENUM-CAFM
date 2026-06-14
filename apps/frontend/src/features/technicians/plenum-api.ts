"use client";

import { apiFetch } from "@/services/api";

export type PlenumTechnician = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  tech_id: string | null;
  tech_name: string | null;
  primary_skill: string | null;
  secondary_skill: string | null;
  level: string | null;
  shift: string | null;
  base_site_id: string | null;
  employment_type: string | null;
  hourly_cost_aed: number | null;
  base_location: string | null;
  availability_status: string | null;
  performance_score: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PlenumPage<T> = {
  total: number;
  limit: number;
  offset: number;
  data: T[];
};

function parseTechnician(x: unknown): PlenumTechnician | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id =
    typeof r.id === "string"
      ? r.id
      : typeof r.tech_id === "string"
        ? r.tech_id
        : typeof r.technician_id === "string"
          ? r.technician_id
          : "";
  if (!id.trim()) return null;

  const organization_id = typeof r.organization_id === "string" ? r.organization_id : null;
  const user_id = typeof r.user_id === "string" ? r.user_id : null;
  const tech_id = typeof r.tech_id === "string" ? r.tech_id : null;
  const tech_name = typeof r.tech_name === "string" ? r.tech_name : null;
  const primary_skill = typeof r.primary_skill === "string" ? r.primary_skill : null;
  const secondary_skill = typeof r.secondary_skill === "string" ? r.secondary_skill : null;
  const level = typeof r.level === "string" ? r.level : null;
  const shift = typeof r.shift === "string" ? r.shift : null;
  const base_site_id = typeof r.base_site_id === "string" ? r.base_site_id : null;
  const employment_type = typeof r.employment_type === "string" ? r.employment_type : null;
  const hourly_cost_aed = typeof r.hourly_cost_aed === "number" ? r.hourly_cost_aed : null;
  const base_location = typeof r.base_location === "string" ? r.base_location : null;
  const availability_status = typeof r.availability_status === "string" ? r.availability_status : null;
  const performance_score = typeof r.performance_score === "number" ? r.performance_score : null;
  const created_at = typeof r.created_at === "string" ? r.created_at : null;
  const updated_at = typeof r.updated_at === "string" ? r.updated_at : null;

  return {
    id,
    organization_id,
    user_id,
    tech_id,
    tech_name,
    primary_skill,
    secondary_skill,
    level,
    shift,
    base_site_id,
    employment_type,
    hourly_cost_aed,
    base_location,
    availability_status,
    performance_score,
    created_at,
    updated_at,
  };
}

export function technicianDisplayName(t: PlenumTechnician): string {
  const n = t.tech_name?.trim();
  if (n) return n;
  const base = t.base_location?.trim();
  if (base) return base;
  const u = t.user_id?.trim();
  if (u) return u;
  return t.id;
}

export async function listTechnicians(input: {
  organizationId: string;
  availabilityStatus?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumTechnician>> {
  const params = new URLSearchParams();
  params.set("organization_id", input.organizationId);
  if (input.availabilityStatus) params.set("availability_status", input.availabilityStatus);
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));

  const payload = await apiFetch<unknown>(`/api/v1/plenum/technicians?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;

  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit ?? 50;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset ?? 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.technicians) ? obj.technicians : [];

  const data = raw.map(parseTechnician).filter((v): v is PlenumTechnician => Boolean(v));
  return { total, limit, offset, data };
}

export async function getTechnician(input: { id: string; signal?: AbortSignal }): Promise<PlenumTechnician> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/technicians/${encodeURIComponent(input.id)}`, {
    signal: input.signal,
  });
  const t = parseTechnician(payload);
  if (!t) throw new Error("Invalid response.");
  return t;
}

export async function createTechnician(input: {
  organization_id: string;
  user_id: string;
  tech_id: string;
  tech_name: string;
  primary_skill: string;
  secondary_skill?: string;
  level: string;
  shift: string;
  base_site_id: string;
  employment_type: string;
  hourly_cost_aed: number;
  base_location?: string;
  availability_status: string;
  performance_score: number;
}): Promise<PlenumTechnician> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/technicians", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const t = parseTechnician(payload);
  if (t) return t;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return getTechnician({ id });
  }
  throw new Error("Invalid response.");
}

export async function updateTechnician(input: {
  id: string;
  body: {
    user_id: string;
    tech_id?: string;
    tech_name: string;
    primary_skill: string;
    secondary_skill?: string;
    level: string;
    shift: string;
    base_site_id: string;
    employment_type: string;
    hourly_cost_aed: number;
    base_location?: string;
    availability_status: string;
    performance_score: number;
  };
}): Promise<PlenumTechnician> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/technicians/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input.body,
  });
  const t = parseTechnician(payload);
  if (!t) return getTechnician({ id: input.id });
  return t;
}

export async function deleteTechnician(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/technicians/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}
