"use client";

import { apiFetch } from "@/services/api";

export type PlenumTechnician = {
  id: string;
  name: string;
  availability_status?: string | null;
};

export type PlenumPage<T> = {
  total: number;
  limit: number;
  offset: number;
  data: T[];
};

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

  const data: PlenumTechnician[] = raw
    .map((x): PlenumTechnician | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id =
        typeof r.id === "string"
          ? r.id
          : typeof r.technician_id === "string"
            ? r.technician_id
            : "";

      const firstName = typeof r.first_name === "string" ? r.first_name : "";
      const lastName = typeof r.last_name === "string" ? r.last_name : "";
      const full = `${firstName} ${lastName}`.trim();
      const baseLocation = typeof r.base_location === "string" ? r.base_location : "";
      const userId = typeof r.user_id === "string" ? r.user_id : "";
      const name =
        full ||
        (typeof r.name === "string" ? r.name : "") ||
        (typeof r.technician_name === "string" ? r.technician_name : "") ||
        (typeof r.full_name === "string" ? r.full_name : "") ||
        baseLocation ||
        userId;

      if (!id.trim() || !name.trim()) return null;

      return {
        id,
        name,
        availability_status: typeof r.availability_status === "string" ? r.availability_status : null,
      };
    })
    .filter((v): v is PlenumTechnician => Boolean(v));

  return { total, limit, offset, data };
}
