"use client";

import { useCallback, useEffect, useState } from "react";

import { env } from "@/config";

/**
 * Customer-named saved spaces (WP-3).
 *
 * Dynamic LHS buckets the FM creates (e.g. "Tower 3 certificates"), beyond the fixed
 * built-in spaces. Persisted server-side (svc-udr /api/spaces) so the named spaces show
 * up across devices; mirrored to localStorage for instant render / offline.
 *
 * Custom spaces are a parallel layer to the built-in `SavedSpaceId` classification — a
 * session lands in a custom space only by explicit assignment (`customSpaceId`), so the
 * built-in auto-classification is untouched.
 */
export type CustomSpace = {
  id: string;
  name: string;
  organization_id: string | null;
  kind: string;
  created_by: string | null;
  created_at: string;
};

const CACHE_KEY = "plenum_custom_spaces_v1";

function getUdrBase(): string {
  const explicit = (env.udrBaseUrl ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const da = env.deepAgentsBaseUrl.trim();
  if (da.startsWith("http://") || da.startsWith("https://")) {
    if (da.includes("/backend/deep-agents")) return da.replace(/\/deep-agents\/?$/, "/udr");
    return `${da.replace(/\/+$/, "")}/udr`;
  }
  return "/backend/udr";
}

const UDR_BASE = getUdrBase();

async function spacesFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${UDR_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `Saved-spaces request failed (${res.status})`;
    try {
      const body = (await res.json()) as { errors?: { message?: string }[]; detail?: string };
      detail = body?.errors?.[0]?.message ?? body?.detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function listCustomSpaces(orgId?: string | null): Promise<CustomSpace[]> {
  const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : "";
  const data = await spacesFetch<{ spaces: CustomSpace[] }>(`/api/spaces${qs}`);
  return data.spaces ?? [];
}

export async function createCustomSpace(name: string, orgId?: string | null): Promise<CustomSpace> {
  return spacesFetch<CustomSpace>(`/api/spaces`, {
    method: "POST",
    body: JSON.stringify({ name, organization_id: orgId ?? null }),
  });
}

export async function renameCustomSpace(id: string, name: string): Promise<CustomSpace> {
  return spacesFetch<CustomSpace>(`/api/spaces/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteCustomSpace(id: string): Promise<void> {
  await spacesFetch<{ deleted: boolean }>(`/api/spaces/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── localStorage cache (instant render + offline fallback) ─────────────────────

export function loadCustomSpacesCache(): CustomSpace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomSpace[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistCustomSpacesCache(spaces: CustomSpace[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(spaces.slice(0, 100)));
  } catch {
    /* ignore quota */
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useCustomSpaces(orgId: string | null | undefined) {
  const [customSpaces, setCustomSpaces] = useState<CustomSpace[]>(() => loadCustomSpacesCache());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const remote = await listCustomSpaces(orgId ?? undefined);
      setCustomSpaces(remote);
      persistCustomSpacesCache(remote);
      setError(null);
    } catch (e) {
      // keep the cached list; only surface a soft error
      setError(e instanceof Error ? e.message : "Could not load saved spaces.");
    }
  }, [orgId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (name: string): Promise<CustomSpace | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      try {
        const created = await createCustomSpace(trimmed, orgId ?? undefined);
        setCustomSpaces((prev) => {
          const next = [created, ...prev.filter((s) => s.id !== created.id)];
          persistCustomSpacesCache(next);
          return next;
        });
        setError(null);
        return created;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create space.");
        return null;
      }
    },
    [orgId],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await deleteCustomSpace(id);
    } catch {
      /* delete best-effort; still drop locally */
    }
    setCustomSpaces((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistCustomSpacesCache(next);
      return next;
    });
  }, []);

  return { customSpaces, customSpacesError: error, createCustomSpace: create, deleteCustomSpace: remove, reloadCustomSpaces: reload };
}
