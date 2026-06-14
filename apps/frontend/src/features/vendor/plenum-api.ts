"use client";

import { apiFetch } from "@/services/api";

export type PlenumVendor = {
  id: string;
  name: string;
  specialty: string | null;
  rate_card_hourly_aed: number | null;
  sla_response_mins: number | null;
  address: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PlenumPage<T> = {
  total: number;
  limit: number;
  offset: number;
  data: T[];
};

export type PlenumVendorContact = {
  id: string;
  vendor_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PlenumVendorContract = {
  id: string;
  organization_id: string | null;
  vendor_id: string;
  contract_name: string;
  contract_start: string | null;
  contract_end: string | null;
  contract_value: number | null;
  sla_terms: string | null;
  contract_document: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function parseVendor(x: unknown): PlenumVendor | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : typeof r.vendor_id === "string" ? r.vendor_id : "";
  if (!id.trim()) return null;

  const name =
    typeof r.vendor_name === "string"
      ? r.vendor_name
      : typeof r.name === "string"
        ? r.name
        : typeof r.company_name === "string"
          ? r.company_name
          : "";
  if (!name.trim()) return null;

  const rate =
    typeof r.rate_card_hourly_aed === "number"
      ? r.rate_card_hourly_aed
      : typeof r.rate_card_hourly_aed === "string"
        ? Number(r.rate_card_hourly_aed)
        : null;
  const rate_card_hourly_aed = rate === null || Number.isNaN(rate) ? null : rate;

  const sla =
    typeof r.sla_response_mins === "number"
      ? r.sla_response_mins
      : typeof r.sla_response_mins === "string"
        ? Number(r.sla_response_mins)
        : null;
  const sla_response_mins = sla === null || Number.isNaN(sla) ? null : sla;

  return {
    id,
    name,
    specialty: typeof r.specialty === "string" ? r.specialty : null,
    rate_card_hourly_aed,
    sla_response_mins,
    address: typeof r.address === "string" ? r.address : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

function parseVendorContact(x: unknown): PlenumVendorContact | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id =
    typeof r.id === "string"
      ? r.id
      : typeof r.contact_id === "string"
        ? r.contact_id
        : typeof r.vendor_contact_id === "string"
          ? r.vendor_contact_id
          : "";
  if (!id.trim()) return null;

  const vendor_id = typeof r.vendor_id === "string" ? r.vendor_id : "";
  const name = typeof r.name === "string" ? r.name : typeof r.contact_name === "string" ? r.contact_name : "";
  if (!vendor_id.trim() || !name.trim()) return null;

  return {
    id,
    vendor_id,
    name,
    email: typeof r.email === "string" ? r.email : null,
    phone: typeof r.phone === "string" ? r.phone : null,
    designation: typeof r.designation === "string" ? r.designation : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

function parseVendorContract(x: unknown): PlenumVendorContract | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;

  const id =
    typeof r.id === "string"
      ? r.id
      : typeof r.contract_id === "string"
        ? r.contract_id
        : typeof r.vendor_contract_id === "string"
          ? r.vendor_contract_id
          : "";
  if (!id.trim()) return null;

  const vendor_id = typeof r.vendor_id === "string" ? r.vendor_id : "";
  const contract_name =
    typeof r.contract_name === "string"
      ? r.contract_name
      : typeof r.name === "string"
        ? r.name
        : "";
  if (!vendor_id.trim() || !contract_name.trim()) return null;

  const contract_value =
    typeof r.contract_value === "number"
      ? r.contract_value
      : typeof r.contract_value === "string"
        ? Number(r.contract_value)
        : null;
  const normalizedValue = contract_value === null || Number.isNaN(contract_value) ? null : contract_value;

  return {
    id,
    organization_id: typeof r.organization_id === "string" ? r.organization_id : null,
    vendor_id,
    contract_name,
    contract_start: typeof r.contract_start === "string" ? r.contract_start : null,
    contract_end: typeof r.contract_end === "string" ? r.contract_end : null,
    contract_value: normalizedValue,
    sla_terms: typeof r.sla_terms === "string" ? r.sla_terms : null,
    contract_document: typeof r.contract_document === "string" ? r.contract_document : null,
    status: typeof r.status === "string" ? r.status : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

export async function listVendors(input: {
  organizationId: string;
  limit?: number;
  offset?: number;
  search?: string;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumVendor>> {
  const params = new URLSearchParams();
  params.set("organization_id", input.organizationId);
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));
  if (input.search?.trim()) params.set("search", input.search.trim());

  let payload: unknown;
  try {
    payload = await apiFetch<unknown>(`/api/v1/plenum/vendors?${params.toString()}`, {
      signal: input.signal,
    });
  } catch (e) {
    if (input.search?.trim()) {
      const fallback = new URLSearchParams();
      fallback.set("organization_id", input.organizationId);
      fallback.set("limit", String(input.limit ?? 50));
      fallback.set("offset", String(input.offset ?? 0));
      payload = await apiFetch<unknown>(`/api/v1/plenum/vendors?${fallback.toString()}`, {
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
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.vendors) ? obj.vendors : [];

  const data = raw.map(parseVendor).filter((v): v is PlenumVendor => Boolean(v));

  return { total, limit, offset, data };
}

export async function getVendor(input: { id: string; signal?: AbortSignal }): Promise<PlenumVendor> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/vendors/${encodeURIComponent(input.id)}`, {
    signal: input.signal,
  });
  const v = parseVendor(payload);
  if (!v) throw new Error("Invalid response.");
  return v;
}

export async function createVendor(input: {
  organization_id: string;
  vendor_id?: string;
  vendor_name: string;
  specialty?: string;
  rate_card_hourly_aed?: number;
  sla_response_mins?: number;
  address?: string;
}): Promise<PlenumVendor> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/vendors", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const v = parseVendor(payload);
  if (v) return v;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return getVendor({ id });
  }
  throw new Error("Invalid response.");
}

export async function updateVendor(input: {
  id: string;
  body: Partial<{
    vendor_id: string;
    vendor_name: string;
    address: string;
    specialty: string;
    rate_card_hourly_aed: number;
    sla_response_mins: number;
  }>;
}): Promise<PlenumVendor> {
  const payload = await apiFetch<unknown>(`/api/v1/plenum/vendors/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input.body,
  });
  const v = parseVendor(payload);
  if (v) return v;
  return getVendor({ id: input.id });
}

export async function deleteVendor(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/vendors/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}

export async function listVendorContacts(input: {
  vendorId: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumVendorContact>> {
  const params = new URLSearchParams();
  params.set("vendor_id", input.vendorId);
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));

  const payload = await apiFetch<unknown>(`/api/v1/plenum/vendor-contacts?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;

  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit ?? 50;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset ?? 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.vendor_contacts) ? obj.vendor_contacts : [];
  const data = raw.map(parseVendorContact).filter((v): v is PlenumVendorContact => Boolean(v));
  return { total, limit, offset, data };
}

export async function createVendorContact(input: {
  vendor_id: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
}): Promise<PlenumVendorContact> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/vendor-contacts", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const c = parseVendorContact(payload);
  if (c) return c;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) {
      return getVendorContact({ id });
    }
  }
  throw new Error("Invalid response.");
}

export async function getVendorContact(input: { id: string; signal?: AbortSignal }): Promise<PlenumVendorContact> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/vendor-contacts/${encodeURIComponent(input.id)}`,
    { signal: input.signal },
  );
  const c = parseVendorContact(payload);
  if (!c) throw new Error("Invalid response.");
  return c;
}

export async function updateVendorContact(input: {
  id: string;
  body: Partial<{
    name: string;
    email: string;
    phone: string;
    designation: string;
  }>;
}): Promise<PlenumVendorContact> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/vendor-contacts/${encodeURIComponent(input.id)}`,
    {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: input.body,
    },
  );
  const c = parseVendorContact(payload);
  if (c) return c;
  return getVendorContact({ id: input.id });
}

export async function deleteVendorContact(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/vendor-contacts/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}

export async function listVendorContracts(input: {
  vendorId: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<PlenumPage<PlenumVendorContract>> {
  const params = new URLSearchParams();
  params.set("vendor_id", input.vendorId);
  params.set("limit", String(input.limit ?? 50));
  params.set("offset", String(input.offset ?? 0));

  const payload = await apiFetch<unknown>(`/api/v1/plenum/vendor-contracts?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;

  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit ?? 50;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset ?? 0;
  const raw = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.vendor_contracts)
      ? obj.vendor_contracts
      : Array.isArray(obj.contracts)
        ? obj.contracts
        : [];
  const data = raw.map(parseVendorContract).filter((v): v is PlenumVendorContract => Boolean(v));
  return { total, limit, offset, data };
}

export async function getVendorContract(input: { id: string; signal?: AbortSignal }): Promise<PlenumVendorContract> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/vendor-contracts/${encodeURIComponent(input.id)}`,
    { signal: input.signal },
  );
  const c = parseVendorContract(payload);
  if (!c) throw new Error("Invalid response.");
  return c;
}

export async function createVendorContract(input: {
  organization_id: string;
  vendor_id: string;
  contract_name: string;
  contract_start: string;
  contract_end: string;
  contract_value: number;
  sla_terms: string;
  contract_document: string;
  status: string;
}): Promise<PlenumVendorContract> {
  const payload = await apiFetch<unknown>("/api/v1/plenum/vendor-contracts", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: input,
  });
  const c = parseVendorContract(payload);
  if (c) return c;
  if (typeof payload === "object" && payload !== null) {
    const id = (payload as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return getVendorContract({ id });
  }
  throw new Error("Invalid response.");
}

export async function updateVendorContract(input: {
  id: string;
  body: Partial<{
    contract_name: string;
    contract_start: string;
    contract_end: string;
    contract_value: number;
    sla_terms: string;
    contract_document: string;
    status: string;
  }>;
}): Promise<PlenumVendorContract> {
  const payload = await apiFetch<unknown>(
    `/api/v1/plenum/vendor-contracts/${encodeURIComponent(input.id)}`,
    {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: input.body,
    },
  );
  const c = parseVendorContract(payload);
  if (c) return c;
  return getVendorContract({ id: input.id });
}

export async function deleteVendorContract(input: { id: string }): Promise<void> {
  await apiFetch(`/api/v1/plenum/vendor-contracts/${encodeURIComponent(input.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}
