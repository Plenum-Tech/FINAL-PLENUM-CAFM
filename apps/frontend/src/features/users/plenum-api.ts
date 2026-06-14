"use client";

import { apiFetch } from "@/services/api";

export type PlenumUser = {
  id: string;
  organization_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  email_verified: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PlenumPage<T> = {
  total: number;
  limit: number;
  offset: number;
  data: T[];
};

function parseUser(x: unknown): PlenumUser | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : typeof r.user_id === "string" ? r.user_id : "";
  if (!id.trim()) return null;

  return {
    id,
    organization_id: typeof r.organization_id === "string" ? r.organization_id : null,
    full_name: typeof r.full_name === "string" ? r.full_name : typeof r.name === "string" ? r.name : null,
    email: typeof r.email === "string" ? r.email : null,
    phone: typeof r.phone === "string" ? r.phone : null,
    status: typeof r.status === "string" ? r.status : null,
    email_verified: typeof r.email_verified === "boolean" ? r.email_verified : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

export async function listUsers(input: {
  organizationId: string;
  limit?: number;
  offset?: number;
  search?: string;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumUser>> {
  const params = new URLSearchParams();
  params.set("organization_id", input.organizationId);
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));
  if (input.search?.trim()) params.set("search", input.search.trim());

  let payload: unknown;
  try {
    payload = await apiFetch<unknown>(`/api/v1/plenum/users?${params.toString()}`, { signal: input.signal });
  } catch (e) {
    if (input.search?.trim()) {
      const fallback = new URLSearchParams();
      fallback.set("organization_id", input.organizationId);
      fallback.set("limit", String(input.limit ?? 50));
      fallback.set("offset", String(input.offset ?? 0));
      payload = await apiFetch<unknown>(`/api/v1/plenum/users?${fallback.toString()}`, { signal: input.signal });
    } else {
      throw e;
    }
  }

  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;

  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit ?? 50;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset ?? 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.users) ? obj.users : [];

  const data = raw.map(parseUser).filter((v): v is PlenumUser => Boolean(v));
  return { total, limit, offset, data };
}

export async function getUser(input: { id: string; signal?: AbortSignal }): Promise<PlenumUser> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/users/${encodeURIComponent(input.id)}`, {
    signal: input.signal,
  });
  const u = parseUser(payload);
  if (!u) throw new Error("Invalid response.");
  return u;
}

export async function createUser(input: {
  organization_id: string;
  full_name: string;
  email: string;
  password_hash: string;
  phone: string;
  status: "active" | "inactive" | (string & {});
  email_verified: boolean;
}): Promise<PlenumUser> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/users", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const u = parseUser(payload);
  if (u) return u;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return getUser({ id });
  }
  throw new Error("Invalid response.");
}

export async function updateUser(input: {
  id: string;
  body: Partial<{
    full_name: string;
    email: string;
    password_hash: string;
    phone: string;
    status: "active" | "inactive" | (string & {});
    email_verified: boolean;
  }>;
}): Promise<PlenumUser> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/users/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input.body,
  });
  const u = parseUser(payload);
  if (u) return u;
  return getUser({ id: input.id });
}

export async function deleteUser(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/users/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}

