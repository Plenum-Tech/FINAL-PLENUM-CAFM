"use client";

import { env } from "@/config";

/**
 * Client for svc-udr run versioning (WP-4).
 * Talks to nginx `/backend/udr/` → svc-udr; the FE persists the last N versions
 * server-side so a saved UDR run survives across devices.
 */
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

export type UdrRunVersion = {
  id: string;
  session_id: string;
  organization_id: string | null;
  version_no: number;
  custom_name: string | null;
  phase: string | null;
  mapping_status: string | null;
  hierarchy_status: string | null;
  migration_ids: string[];
  document_ids: string[];
  batch_ids: string[];
  snapshot: Record<string, unknown> | null;
  created_at: string;
};

export type CreateUdrRunPayload = {
  sessionId: string;
  organizationId?: string | null;
  customName?: string | null;
  phase?: string | null;
  mappingStatus?: string | null;
  hierarchyStatus?: string | null;
  migrationIds?: string[];
  documentIds?: string[];
  batchIds?: string[];
  snapshot?: Record<string, unknown> | null;
};

async function udrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${UDR_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `UDR request failed (${res.status})`;
    try {
      const body = (await res.json()) as {
        errors?: { message?: string }[];
        detail?: string;
      };
      detail = body?.errors?.[0]?.message ?? body?.detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function listUdrRuns(sessionId: string, limit = 3): Promise<UdrRunVersion[]> {
  if (!sessionId) return [];
  const data = await udrFetch<{ versions: UdrRunVersion[] }>(
    `/api/udr/runs?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`,
  );
  return data.versions ?? [];
}

export async function createUdrRun(payload: CreateUdrRunPayload): Promise<UdrRunVersion> {
  return udrFetch<UdrRunVersion>(`/api/udr/runs`, {
    method: "POST",
    body: JSON.stringify({
      session_id: payload.sessionId,
      organization_id: payload.organizationId ?? null,
      custom_name: payload.customName ?? null,
      phase: payload.phase ?? null,
      mapping_status: payload.mappingStatus ?? null,
      hierarchy_status: payload.hierarchyStatus ?? null,
      migration_ids: payload.migrationIds ?? [],
      document_ids: payload.documentIds ?? [],
      batch_ids: payload.batchIds ?? [],
      snapshot: payload.snapshot ?? null,
    }),
  });
}

export async function renameUdrRun(runId: string, customName: string): Promise<UdrRunVersion> {
  return udrFetch<UdrRunVersion>(`/api/udr/runs/${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: JSON.stringify({ custom_name: customName }),
  });
}
