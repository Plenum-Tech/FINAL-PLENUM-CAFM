"use client";

import { apiFetch } from "@/services/api";

export type PlenumOrganization = {
  id: string;
  name: string;
  industry: string | null;
  address: string | null;
  country: string | null;
  timezone: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PlenumPage<T> = {
  total: number;
  limit: number;
  offset: number;
  data: T[];
};

function normalizeId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Parse one organization row from the connector list/detail JSON. */
export function parseOrganization(x: unknown): PlenumOrganization | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id = normalizeId(r.id) || normalizeId(r.organization_id);
  const name = typeof r.name === "string" ? r.name : "";
  if (!id.trim() || !name.trim()) return null;

  return {
    id,
    name,
    industry: typeof r.industry === "string" ? r.industry : null,
    address: typeof r.address === "string" ? r.address : null,
    country: typeof r.country === "string" ? r.country : null,
    timezone: typeof r.timezone === "string" ? r.timezone : null,
    status: typeof r.status === "string" ? r.status : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

export async function listOrganizations(input: {
  limit?: number;
  offset?: number;
  search?: string;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumOrganization>> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));
  if (input.search?.trim()) params.set("search", input.search.trim());

  const payload = await apiFetch<unknown>(`/api/v1/plenum/organizations?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit ?? 50;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset ?? 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.organizations) ? obj.organizations : [];
  const data = raw.map(parseOrganization).filter((v): v is PlenumOrganization => Boolean(v));
  if (total > 0 && raw.length > 0 && data.length === 0) {
    console.warn("[plenum-api] listOrganizations: rows were dropped by parser", { total, sample: raw[0] });
  }
  return { total, limit, offset, data };
}

export async function getOrganization(input: { id: string; signal?: AbortSignal }): Promise<PlenumOrganization> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/organizations/${encodeURIComponent(input.id)}`, {
    signal: input.signal,
  });
  const org = parseOrganization(payload);
  if (!org) throw new Error("Invalid response.");
  return org;
}

export async function createOrganization(input: {
  name: string;
  industry: string;
  address: string;
  country: string;
  timezone: string;
  status: "active" | "suspended" | "trial" | (string & {});
}): Promise<PlenumOrganization> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/organizations", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const org = parseOrganization(payload);
  if (org) return org;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return getOrganization({ id });
  }
  throw new Error("Invalid response.");
}

export async function updateOrganization(input: {
  id: string;
  body: Partial<{
    name: string;
    industry: string;
    address: string;
    country: string;
    timezone: string;
    status: "active" | "suspended" | "trial" | (string & {});
  }>;
}): Promise<PlenumOrganization> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/organizations/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input.body,
  });
  const org = parseOrganization(payload);
  if (org) return org;
  return getOrganization({ id: input.id });
}

export async function deleteOrganization(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/organizations/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}

