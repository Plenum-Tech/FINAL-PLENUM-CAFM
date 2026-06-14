"use client";

import { useMutation, useQuery, type UseMutationOptions, type UseQueryOptions } from "@tanstack/react-query";

import { env } from "@/config";

export class DeepAgentsApiError extends Error {
  status: number;
  payload: unknown;

  constructor(input: { status: number; message: string; payload: unknown }) {
    super(input.message);
    this.status = input.status;
    this.payload = input.payload;
  }
}

export type ToolDomain = "meta" | "udr" | "wo_engine" | "migration" | "doc_rag" | "compliance" | "unknown";

export type ToolCallRecord = {
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
};

export type WorkflowRequest = {
  message: string;
  session_id?: string | null;
  context?: string | null;
};

export type WorkflowWithFilesRequest = {
  message: string;
  session_id: string;
  context?: string | null;
  organization_id?: string | null;
  cmms_name?: string | null;
  /** `files` (default) or `fiix` for live CMMS sync without attachments */
  ingest_source?: "files" | "fiix" | null;
  schema_mapping_id?: string | null;
  /** When true, backend indexes only; row↔chunk matching runs in orchestrator UI */
  interactive_doc_match?: boolean;
  /** When true, migration stops at first HITL gate for orchestrator Migration panel */
  interactive_migration?: boolean;
  files: File[];
};

export type WorkspaceStatus = {
  session_id: string;
  ingestion_complete: boolean;
  documents_ingested_count: number;
  mapping_status: string;
  hierarchy_status: string;
  mapping_pending: boolean;
  hierarchy_pending: boolean;
  wo_candidate_detected: boolean;
  pending_batch_ids: string[];
  active_batch_id: string;
  last_route_intent?: string;
  active_schema_mapping_id?: string;
  schema_mapping_ids?: string[];
  pending_schema_gate_confirm?: boolean;
  fiix_credentials_configured?: boolean;
  fiix_subdomain?: string;
  /** FM-facing saved space (work_orders, udr, schema, …) — backend anchor (Option A). */
  saved_space?: string;
  last_domain?: string;
  last_tool?: string;
};

export type RouteMetadata = {
  route_intent: string;
  selected_domain: string;
  selected_tool: string;
  next_step_prompt?: string | null;
};

export type IngestBatchStatus = {
  batch_id: string;
  session_id: string;
  status: string;
  total_files: number;
  completed_count: number;
  failed_count: number;
  progress_pct: number;
  items?: Array<{
    file_name?: string;
    status?: string;
    kind?: string;
    summary?: string;
    error?: string | null;
  }>;
};

export type WorkflowResponse = {
  session_id: string;
  answer: string;
  tool_calls: ToolCallRecord[];
  success: boolean;
  error?: string | null;
  interrupted?: boolean;
  interrupt_payload?: Record<string, unknown> | null;
  batch_id?: string | null;
  batch_status?: string | null;
  batch_progress_pct?: number | null;
  route_metadata?: RouteMetadata | null;
  workspace_status?: WorkspaceStatus | null;
  ingested_document_ids?: string[];
  ingested_migration_ids?: string[];
  ingested_schema_mapping_ids?: string[];
};

/** Collect document_id values from index_document tool calls (or API field). */
export function extractIngestedDocumentIds(res: WorkflowResponse): string[] {
  if (res.ingested_document_ids?.length) return [...res.ingested_document_ids];
  const ids: string[] = [];
  for (const tc of res.tool_calls ?? []) {
    if (tc.tool !== "index_document") continue;
    const out = tc.output as Record<string, unknown> | null | undefined;
    if (!out || typeof out !== "object") continue;
    const id = out.document_id ?? out.doc_id ?? out.id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return ids;
}

const MIGRATION_TOOLS = new Set(["start_migration", "start_migration_multi", "run_migration"]);

export function extractIngestedMigrationIds(res: WorkflowResponse): string[] {
  if (res.ingested_migration_ids?.length) return [...res.ingested_migration_ids];
  const ids: string[] = [];
  for (const tc of res.tool_calls ?? []) {
    if (!MIGRATION_TOOLS.has(tc.tool)) continue;
    const out = parseToolOutput(tc.output);
    if (!out) continue;
    const id = out.migration_id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
    const arr = out.migration_ids;
    if (Array.isArray(arr)) {
      for (const x of arr) if (typeof x === "string" && x.trim()) ids.push(x.trim());
    }
  }
  return collapseMigrationIdsForUpload(ids);
}

/** One migration per uploaded workbook — collapse duplicate start_migration IDs. */
export function collapseMigrationIdsForUpload(migrationIds: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of migrationIds) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);
  }
  if (ordered.length <= 1) return ordered;
  return [ordered[0]];
}

function parseToolOutput(output: unknown): Record<string, unknown> | null {
  if (!output) return null;
  if (typeof output === "object" && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

const SCHEMA_MAPPING_UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Pull schema_mapping UUIDs from chat text (e.g. "started (61ec527f-...)"). */
export function extractSchemaMappingIdsFromText(...chunks: string[]): string[] {
  const ids: string[] = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    for (const m of chunk.matchAll(SCHEMA_MAPPING_UUID_RE)) {
      const id = m[0]?.trim().toLowerCase();
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

const SCHEMA_TOOLS = new Set([
  "start_schema_mapping",
  "start_fiix_schema_mapping",
  "continue_schema_mapping_gate",
  "get_schema_mapping_status",
]);

/**
 * IDs that came from an EXPLICIT schema-mapping tool call or were echoed in
 * the assistant answer. These are unambiguous schema flows — safe to populate
 * schemaContext without further checks.
 */
export function extractExplicitSchemaMappingIds(res: WorkflowResponse): string[] {
  const ids: string[] = [];
  for (const tc of res.tool_calls ?? []) {
    if (!SCHEMA_TOOLS.has(tc.tool)) continue;
    const out = parseToolOutput(tc.output);
    if (!out) continue;
    let id = out.schema_mapping_id;
    if (!id && tc.tool === "continue_schema_mapping_gate") {
      const nested = out.status;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        id = (nested as Record<string, unknown>).schema_mapping_id;
      }
    }
    if (typeof id === "string" && id.trim() && !ids.includes(id.trim())) ids.push(id.trim());
  }
  for (const id of extractSchemaMappingIdsFromText(res.answer ?? "")) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * IDs that came AMBIENTLY from workspace_status. The backend reuses
 * ``active_schema_mapping_id`` and ``schema_mapping_ids`` as a generic
 * "current pipeline" pointer for migration / doc indexing / work orders too,
 * so callers MUST gate these with a real schema-flow indicator (Fiix /
 * saved_space=schema / schema_pipeline_kind) before populating schemaContext.
 * Otherwise an XLSX upload spawns a phantom Schema task that gets stuck on
 * "Loading schema mapping status…" because the id isn't a schema mapping.
 */
export function extractAmbientSchemaMappingIds(res: WorkflowResponse): string[] {
  const ids: string[] = [];
  if (res.ingested_schema_mapping_ids?.length) ids.push(...res.ingested_schema_mapping_ids);
  const ws = res.workspace_status as
    | { active_schema_mapping_id?: string; schema_mapping_ids?: string[] }
    | null
    | undefined;
  if (ws?.active_schema_mapping_id?.trim() && !ids.includes(ws.active_schema_mapping_id.trim())) {
    ids.push(ws.active_schema_mapping_id.trim());
  }
  if (ws?.schema_mapping_ids?.length) {
    for (const id of ws.schema_mapping_ids) {
      if (id?.trim() && !ids.includes(id.trim())) ids.push(id.trim());
    }
  }
  return ids;
}

/**
 * @deprecated Use ``extractExplicitSchemaMappingIds`` and ``extractAmbientSchemaMappingIds``
 * separately so the caller can gate the ambient set with a real schema-flow
 * signal. This helper is kept only for backwards compatibility with code that
 * was using the unguarded union — new call sites should not use it.
 */
export function extractIngestedSchemaMappingIds(res: WorkflowResponse): string[] {
  const explicit = extractExplicitSchemaMappingIds(res);
  const ambient = extractAmbientSchemaMappingIds(res);
  const out = [...explicit];
  for (const id of ambient) if (!out.includes(id)) out.push(id);
  return out;
}

export type ResumeRequest = {
  decision: Record<string, unknown>;
};

export type ThreadStatusResponse = {
  session_id: string;
  interrupted: boolean;
  interrupt_payload?: Record<string, unknown> | null;
};

export type ToolInfo = {
  name: string;
  description: string;
  domain: string;
};

export type HealthResponse = {
  status: string;
  service: string;
  version: string;
};

export type WorkflowStreamEvent =
  | { type: "tool_started"; tool: string; domain: string; input: Record<string, unknown> }
  | { type: "tool_completed"; tool: string; domain: string; output: unknown }
  | { type: "agent_switch"; from_domain: string; to_domain: string }
  | { type: "gate_interrupt"; payload: Record<string, unknown>; session_id: string }
  | {
      type: "workflow_completed";
      answer: string;
      session_id: string;
      tool_calls?: ToolCallRecord[];
      workspace_status?: WorkspaceStatus | null;
      ingested_schema_mapping_ids?: string[];
    }
  | { type: "error"; error: string; session_id: string };

export type MappingApprovalField = {
  source_field?: string;
  canonical_field?: string;
  confidence?: number;
  [key: string]: unknown;
};

export const DEEP_AGENTS_API_PREFIX = "/api/workflow";

/** Persists orchestrator session across refresh (HITL resume). */
export const DEEP_AGENT_SESSION_STORAGE_KEY = "plenum_deep_agent_session_id";

function isAbsoluteUrl(v: string) {
  return v.startsWith("http://") || v.startsWith("https://");
}

function resolveDeepAgentsBase() {
  const base = (env.deepAgentsBaseUrl ?? "/backend/deep-agents").replace(/\/+$/, "");
  return base;
}

export function buildDeepAgentsUrl(path: string) {
  const base = resolveDeepAgentsBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isAbsoluteUrl(base)) return `${base}${p}`;
  return `${base}${p}`;
}

export function buildDeepAgentsWebSocketUrl(sessionId: string) {
  const base = resolveDeepAgentsBase();
  const suffix = `${DEEP_AGENTS_API_PREFIX}/ws/${encodeURIComponent(sessionId)}`;
  if (typeof window === "undefined") return "";

  if (isAbsoluteUrl(base)) {
    const url = new URL(suffix, base.endsWith("/") ? base : `${base}/`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  const path = `${base}${suffix}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

export function getDeepAgentsErrorMessage(err: unknown) {
  if (err instanceof DeepAgentsApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

async function parseJsonResponse(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  const isJson = ct.includes("application/json") || ct.includes("+json");
  return isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
}

function detailMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("detail" in payload)) return null;
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const parts: string[] = [];
    for (const it of detail) {
      if (typeof it === "string" && it.trim()) parts.push(it.trim());
      else if (it && typeof it === "object" && typeof (it as { msg?: string }).msg === "string") {
        const msg = (it as { msg: string }).msg.trim();
        if (msg) parts.push(msg);
      }
    }
    return parts.length ? parts.join("\n") : null;
  }
  return null;
}

export async function deepAgentsRequest<TResponse = unknown, TBody = unknown>(opts: {
  method?: "GET" | "POST";
  path: string;
  body?: TBody;
  signal?: AbortSignal;
}): Promise<TResponse> {
  const method = opts.method ?? "POST";
  const url = buildDeepAgentsUrl(opts.path);

  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (method === "POST" && opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, { method, headers, body, signal: opts.signal });
  const payload = await parseJsonResponse(res);

  if (!res.ok) {
    const msg = detailMessage(payload) ?? `Deep Agents request failed (${res.status})`;
    throw new DeepAgentsApiError({ status: res.status, message: msg, payload });
  }

  return payload as TResponse;
}

export const deepAgentsApi = {
  health: () =>
    deepAgentsRequest<HealthResponse>({ method: "GET", path: "/health" }),

  listTools: () =>
    deepAgentsRequest<ToolInfo[]>({ method: "GET", path: `${DEEP_AGENTS_API_PREFIX}/tools` }),

  runWorkflow: (body: WorkflowRequest) =>
    deepAgentsRequest<WorkflowResponse, WorkflowRequest>({
      method: "POST",
      path: `${DEEP_AGENTS_API_PREFIX}/run`,
      body,
    }),

  runStatefulWorkflow: (body: WorkflowRequest & { session_id: string }) =>
    deepAgentsRequest<WorkflowResponse, WorkflowRequest>({
      method: "POST",
      path: `${DEEP_AGENTS_API_PREFIX}/run-stateful`,
      body,
    }),

  runStatefulWorkflowWithFiles: async (body: WorkflowWithFilesRequest) => {
    const form = new FormData();
    form.set("message", body.message);
    form.set("session_id", body.session_id);
    if (body.context) form.set("context", body.context);
    if (body.organization_id) form.set("organization_id", body.organization_id);
    form.set("cmms_name", body.cmms_name || "Custom");
    if (body.ingest_source) form.set("ingest_source", body.ingest_source);
    if (body.schema_mapping_id) form.set("schema_mapping_id", body.schema_mapping_id);
    if (body.interactive_doc_match) form.set("interactive_doc_match", "true");
    if (body.interactive_migration) form.set("interactive_migration", "true");
    for (const f of body.files) form.append("files", f);
    const url = buildDeepAgentsUrl(`${DEEP_AGENTS_API_PREFIX}/run-stateful-with-files`);
    const res = await fetch(url, { method: "POST", body: form });
    const payload = await parseJsonResponse(res);
    if (!res.ok) {
      const msg = detailMessage(payload) ?? `Deep Agents request failed (${res.status})`;
      throw new DeepAgentsApiError({ status: res.status, message: msg, payload });
    }
    return payload as WorkflowResponse;
  },

  resumeWorkflow: (sessionId: string, body: ResumeRequest) =>
    deepAgentsRequest<WorkflowResponse, ResumeRequest>({
      method: "POST",
      path: `${DEEP_AGENTS_API_PREFIX}/resume/${encodeURIComponent(sessionId)}`,
      body,
    }),

  getIngestBatch: (batchId: string) =>
    deepAgentsRequest<IngestBatchStatus>({
      method: "GET",
      path: `/api/ingest/batches/${encodeURIComponent(batchId)}`,
    }),

  getWorkspaceStatus: (sessionId: string, migrationIds?: string[]) => {
    const params = new URLSearchParams();
    for (const id of migrationIds ?? []) {
      if (id.trim()) params.append("migration_id", id.trim());
    }
    const qs = params.toString();
    return deepAgentsRequest<WorkspaceStatus>({
      method: "GET",
      path: `${DEEP_AGENTS_API_PREFIX}/workspace/${encodeURIComponent(sessionId)}${qs ? `?${qs}` : ""}`,
    });
  },

  getWorkflowStatus: (sessionId: string) =>
    deepAgentsRequest<ThreadStatusResponse>({
      method: "GET",
      path: `${DEEP_AGENTS_API_PREFIX}/status/${encodeURIComponent(sessionId)}`,
    }),
};

export function useDeepAgentsHealth(
  opts?: { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<HealthResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<HealthResponse, unknown>({
    queryKey: ["deep-agents", "health"],
    enabled: opts?.enabled ?? true,
    queryFn: ({ signal }) =>
      deepAgentsRequest<HealthResponse>({ method: "GET", path: "/health", signal }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    ...(queryOptions ?? {}),
  });
}

export function useDeepAgentsWorkflowStatus(
  sessionId: string | null | undefined,
  opts?: { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<ThreadStatusResponse, unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<ThreadStatusResponse, unknown>({
    queryKey: ["deep-agents", "status", sessionId],
    enabled: (opts?.enabled ?? true) && !!sessionId,
    queryFn: ({ signal }) =>
      deepAgentsRequest<ThreadStatusResponse>({
        method: "GET",
        path: `${DEEP_AGENTS_API_PREFIX}/status/${encodeURIComponent(sessionId as string)}`,
        signal,
      }),
    staleTime: 0,
    retry: false,
    ...(queryOptions ?? {}),
  });
}

export function useDeepAgentsTools(
  opts?: { enabled?: boolean },
  queryOptions?: Omit<UseQueryOptions<ToolInfo[], unknown>, "queryKey" | "queryFn" | "enabled">,
) {
  return useQuery<ToolInfo[], unknown>({
    queryKey: ["deep-agents", "tools"],
    enabled: opts?.enabled ?? true,
    queryFn: ({ signal }) =>
      deepAgentsRequest<ToolInfo[]>({
        method: "GET",
        path: `${DEEP_AGENTS_API_PREFIX}/tools`,
        signal,
      }),
    staleTime: 5 * 60_000,
    ...(queryOptions ?? {}),
  });
}

export function useDeepAgentsRunStateful(
  mutationOptions?: UseMutationOptions<WorkflowResponse, unknown, WorkflowRequest & { session_id: string }>,
) {
  return useMutation<WorkflowResponse, unknown, WorkflowRequest & { session_id: string }>({
    mutationFn: (body) => deepAgentsApi.runStatefulWorkflow(body),
    ...(mutationOptions ?? {}),
  });
}

export function useDeepAgentsRunStatefulWithFiles(
  mutationOptions?: UseMutationOptions<WorkflowResponse, unknown, WorkflowWithFilesRequest>,
) {
  return useMutation<WorkflowResponse, unknown, WorkflowWithFilesRequest>({
    mutationFn: (body) => deepAgentsApi.runStatefulWorkflowWithFiles(body),
    ...(mutationOptions ?? {}),
  });
}

export function useDeepAgentsResume(
  mutationOptions?: UseMutationOptions<
    WorkflowResponse,
    unknown,
    { sessionId: string; body: ResumeRequest }
  >,
) {
  return useMutation<WorkflowResponse, unknown, { sessionId: string; body: ResumeRequest }>({
    mutationFn: ({ sessionId, body }) => deepAgentsApi.resumeWorkflow(sessionId, body),
    ...(mutationOptions ?? {}),
  });
}

export const DOMAIN_LABELS: Record<string, string> = {
  meta: "Meta",
  udr: "UDR",
  wo_engine: "Work Orders",
  migration: "Migration",
  fiix: "Fiix CMMS",
  ingest_batch: "Bulk Ingest",
  connector: "Connectors",
  doc_rag: "Doc RAG",
  compliance: "Compliance",
  unknown: "Other",
};

export const DOMAIN_COLORS: Record<string, string> = {
  meta: "bg-slate-100 text-slate-700 border-slate-200",
  udr: "bg-teal-50 text-teal-800 border-teal-200",
  wo_engine: "bg-indigo-50 text-indigo-800 border-indigo-200",
  migration: "bg-emerald-50 text-emerald-800 border-emerald-200",
  doc_rag: "bg-rose-50 text-rose-800 border-rose-200",
  compliance: "bg-amber-50 text-amber-800 border-amber-200",
  unknown: "bg-slate-50 text-slate-600 border-slate-200",
};
