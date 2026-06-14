"use client";

import { env } from "@/config";

export class WoApiError extends Error {
  status: number;
  payload: unknown;

  constructor(input: { status: number; message: string; payload: unknown }) {
    super(input.message);
    this.status = input.status;
    this.payload = input.payload;
  }
}

export interface WorkOrderResponse {
  work_order_id: string;
  source: string | null;
  status: string | null;
  priority: string | null;
  asset: string | null;
  location: string | null;
  issue_description: string | null;
  request_type: string | null;
  requester_name: string | null;
  requester_email: string | null;
  vendor: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  estimated_duration: number | null;
  inspection_required: boolean | null;
  special_requirements: string | null;
  cmms_work_order_id: string | null;
  journey_log_id: string | null;
  created_at: string | null;
  approved_at: string | null;
  prepared_at: string | null;
}

export interface JourneyMilestone {
  name: string;
  status: "pending" | "current" | "completed" | "skipped";
  timestamp: string | null;
}

export interface JourneyResponse {
  jlog_id: string;
  work_order_id: string;
  status: string;
  journey_status: string;
  current_step: string;
  milestones: JourneyMilestone[];
  assigned_technician_name: string | null;
  expected_timeline: { duration_hours?: number } | null;
  created_at: string | null;
}

export interface JourneyHealth {
  health_status: "on_track" | "in_progress" | "at_risk" | "completed";
  completion_percentage: number;
  cost_overrun: boolean;
  time_overrun: boolean;
}

export interface StatusHistoryItem {
  work_order_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  notes: string | null;
}

export interface DashboardStats {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_source: Record<string, number>;
  created_today: number;
  assets_by_category: Record<string, number>;
}

export interface SSEEvent {
  step: string;
  status: "running" | "complete" | "error" | "warning";
  message: string;
  data?: Record<string, unknown>;
}

export interface OutlookStatus {
  connected: boolean;
  display_name?: string;
  email?: string;
  error?: string;
}

export interface EmailPollResult {
  fetched: number;
  created: number;
  approved: number;
  rejected: number;
  missing_info: number;
  skipped: number;
  errors: number;
  work_orders: string[];
}

function buildWoUrl(path: string): string {
  let base = env.woBaseUrl.replace(/\/+$/, "");
  if (base === "/work-order" || base.startsWith("/work-order/")) {
    base = `/backend${base}`;
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export async function woFetch<T>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T> {
  const url = buildWoUrl(path);
  const headers = new Headers(options.headers as Record<string, string>);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers, body });
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const errPayload = payload as Record<string, unknown> | null;
    const firstError =
      Array.isArray(errPayload?.errors) && errPayload.errors.length > 0
        ? (errPayload.errors[0] as Record<string, unknown>)?.message
        : undefined;
    const msg = firstError ?? errPayload?.detail ?? res.statusText;
    throw new WoApiError({ status: res.status, message: String(msg), payload });
  }

  return payload as T;
}

/** List endpoint returns a JSON array and optional X-Total-Count (filtered total rows). */
export async function woFetchWorkOrderList<T extends WorkOrderResponse>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<{ items: T[]; total: number }> {
  const url = buildWoUrl(path);
  const headers = new Headers(options.headers as Record<string, string>);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers, body });
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const errPayload = payload as Record<string, unknown> | null;
    const firstError =
      Array.isArray(errPayload?.errors) && errPayload.errors.length > 0
        ? (errPayload.errors[0] as Record<string, unknown>)?.message
        : undefined;
    const msg = firstError ?? errPayload?.detail ?? res.statusText;
    throw new WoApiError({ status: res.status, message: String(msg), payload });
  }

  if (!Array.isArray(payload)) {
    throw new WoApiError({
      status: 500,
      message: "Expected work order list response to be a JSON array",
      payload,
    });
  }
  const rawTotal = res.headers.get("X-Total-Count");
  const parsed = rawTotal ? parseInt(rawTotal, 10) : NaN;
  const total = Number.isFinite(parsed) ? parsed : payload.length;
  return { items: payload as T[], total };
}

export function buildWoSseUrl(path: string): string {
  return buildWoUrl(path);
}

export function getWoErrorMessage(err: unknown): string {
  if (err instanceof WoApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
