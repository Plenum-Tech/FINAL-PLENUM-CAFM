export const runtime = "nodejs";

import { woServerUrl } from "@/lib/wo-server-base-url";

// ─── Types ───────────────────────────────────────────────────────────────────

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type ApiMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type WoProcessLogEntry = {
  id: string;
  at: string;
  step: number;
  phase: "started" | "completed";
  tool: string;
  toolLabel: string;
  status: "running" | "success" | "error";
  title: string;
  detail: string;
  input?: Record<string, unknown>;
  output?: string;
  durationMs?: number;
};

function formatToolLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncateText(text: string, max = 6000): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n… (truncated)`;
}

function describeToolInput(name: string, input: Record<string, unknown>): string {
  if (name === "search_assets" || name === "search_locations") {
    return `Query: "${String(input.query ?? "")}"`;
  }
  if (name === "create_work_order") {
    const parts = ["asset", "location", "issue_description", "requester_name", "priority", "source"]
      .map((k) => (input[k] != null && input[k] !== "" ? `${k}=${String(input[k])}` : null))
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : "Collecting required work order fields";
  }
  if (name === "list_work_orders") {
    const filters = ["status", "priority", "asset", "page", "limit"]
      .filter((k) => input[k] != null)
      .map((k) => `${k}=${String(input[k])}`);
    return filters.length ? filters.join(" · ") : "No filters (default list)";
  }
  const keys = Object.keys(input);
  if (keys.length === 0) return "No parameters";
  if (keys.length <= 4) {
    return keys.map((k) => `${k}=${JSON.stringify(input[k])}`).join(" · ");
  }
  return `${keys.length} parameters: ${keys.slice(0, 4).join(", ")}…`;
}

function summarizeToolResult(
  name: string,
  content: string,
): { status: "success" | "error"; detail: string; output: string } {
  const output = truncateText(content);
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.error) {
      return { status: "error", detail: String(parsed.error), output };
    }
    if (typeof parsed.work_order_id === "string") {
      return {
        status: "success",
        detail: `Created work order ${parsed.work_order_id}`,
        output,
      };
    }
    if (Array.isArray(parsed)) {
      return {
        status: "success",
        detail: `Returned ${parsed.length} record(s)`,
        output,
      };
    }
    if (parsed.success === false) {
      return {
        status: "error",
        detail: String(parsed.error ?? `${formatToolLabel(name)} failed`),
        output,
      };
    }
    const keys = Object.keys(parsed);
    return {
      status: "success",
      detail: keys.length ? `Response keys: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "…" : ""}` : `${formatToolLabel(name)} completed`,
      output,
    };
  } catch {
    const preview = content.replace(/\s+/g, " ").trim().slice(0, 280);
    return {
      status: "success",
      detail: preview || `${formatToolLabel(name)} completed`,
      output,
    };
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are an elite CMMS work order assistant for operations teams.

You can both:
- create new work orders conversationally, and
- operate the work order system via backend tools (list, status updates, approvals, dashboard, journeys, email ops).

REQUIRED fields you must collect before creating a work order:
- source: how the request originated — default to "manual" unless specified
- asset: the equipment/asset name or code (use search_assets to find the exact name)
- location: where the asset is (use search_locations to find the exact location)
- issue_description: a clear description of the problem or work needed

Requester details:
- If requester_name / requester_email are not provided, default to:
  requester_name="System", requester_email="system@plenum-tech.com"

OPTIONAL fields (ask only if relevant):
- priority: low / medium (default) / high / urgent / critical
- request_type: repair (default) / maintenance / inspection / installation
- requester_phone: phone number

GUIDELINES:
1. Be conversational and friendly — don't dump all fields at once
2. When the user mentions an asset name or code, call search_assets to find matches; show the results and confirm which one they mean
3. When the user mentions a location, call search_locations to find matches
4. If the user asks to review/update existing work, use operational tools (list/get/update/transition/approve/prepare/close/history/dashboard/journeys)
5. If the user provides multiple pieces of info in one message, extract them all — never ask for something already provided
6. Once you have ALL required fields, present a clear summary and ask for confirmation (e.g. "Ready to create this work order?")
7. ONLY call create_work_order after the user explicitly confirms (yes / confirm / go ahead / looks good / etc.)
8. After creating, mention the WO ID and that it's awaiting approval
9. Keep responses concise and practical
10. If asset or location search returns no results, tell the user and let them type freely
11. If the user's message contains an email-style maintenance request, you may use process_email_payload or extract details and create manually
12. If the user message includes a WORK ORDER CONTEXT block with work_order_id, treat that ID as the active record. Prefer get_work_order / approval / prepare / transition / update / close / history / journey tools for THAT id. Do not create another work order unless the user explicitly asks for a new one.`;

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_assets",
    description: "Search for assets in the CMMS by name or code. Use this whenever the user mentions an asset.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (asset name or code)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_locations",
    description: "Search for locations in the CMMS. Use this when the user describes a location.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_work_order",
    description: "Create a work order. Only call this AFTER the user has confirmed all the details.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["manual", "email", "ppm", "tenant", "internal", "remediation"],
          description: "How the WO was initiated",
        },
        asset: { type: "string", description: "Asset name or code" },
        location: { type: "string", description: "Location name" },
        issue_description: { type: "string", description: "Description of the work needed" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent", "critical"],
          description: "Priority level (default: medium)",
        },
        request_type: {
          type: "string",
          enum: ["repair", "maintenance", "inspection", "installation"],
          description: "Type of work (default: repair)",
        },
        requester_name: { type: "string", description: "Full name of the requester" },
        requester_email: { type: "string", description: "Email address of the requester" },
        requester_phone: { type: "string", description: "Phone number (optional)" },
      },
      required: ["source", "asset", "location", "issue_description"],
    },
  },
  {
    name: "list_work_orders",
    description: "List work orders with optional filters.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        priority: { type: "string" },
        asset: { type: "string" },
        page: { type: "number" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_work_order",
    description: "Get a single work order by ID.",
    input_schema: {
      type: "object",
      properties: { work_order_id: { type: "string" } },
      required: ["work_order_id"],
    },
  },
  {
    name: "update_work_order",
    description: "Update work order details (vendor, schedule, etc).",
    input_schema: {
      type: "object",
      properties: {
        work_order_id: { type: "string" },
        vendor: { type: "string" },
        scheduled_date: { type: "string" },
        scheduled_time: { type: "string" },
        estimated_duration: { type: "number" },
        inspection_required: { type: "boolean" },
        special_requirements: { type: "string" },
        cmms_work_order_id: { type: "string" },
      },
      required: ["work_order_id"],
    },
  },
  {
    name: "transition_work_order_status",
    description: "Transition work order status via workflow state machine.",
    input_schema: {
      type: "object",
      properties: {
        work_order_id: { type: "string" },
        new_status: { type: "string" },
        notes: { type: "string" },
      },
      required: ["work_order_id", "new_status"],
    },
  },
  {
    name: "approve_work_order",
    description: "Approve a pending work order.",
    input_schema: {
      type: "object",
      properties: { work_order_id: { type: "string" } },
      required: ["work_order_id"],
    },
  },
  {
    name: "prepare_work_order",
    description: "Move work order to prepared and set preparation details.",
    input_schema: {
      type: "object",
      properties: {
        work_order_id: { type: "string" },
        vendor: { type: "string" },
        scheduled_date: { type: "string" },
        scheduled_time: { type: "string" },
        estimated_duration: { type: "number" },
      },
      required: ["work_order_id"],
    },
  },
  {
    name: "close_work_order",
    description: "Close a work order.",
    input_schema: {
      type: "object",
      properties: { work_order_id: { type: "string" } },
      required: ["work_order_id"],
    },
  },
  {
    name: "get_work_order_history",
    description: "Get status transition history for a work order.",
    input_schema: {
      type: "object",
      properties: { work_order_id: { type: "string" } },
      required: ["work_order_id"],
    },
  },
  {
    name: "bulk_update_work_order_status",
    description: "Bulk update status for multiple work orders.",
    input_schema: {
      type: "object",
      properties: {
        work_order_ids: { type: "array", items: { type: "string" } },
        new_status: { type: "string" },
        notes: { type: "string" },
      },
      required: ["work_order_ids", "new_status"],
    },
  },
  {
    name: "respond_approval_request",
    description: "Respond to an approval request id (approve or reject).",
    input_schema: {
      type: "object",
      properties: {
        approval_request_id: { type: "string" },
        approved: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["approval_request_id", "approved"],
    },
  },
  {
    name: "get_dashboard_stats",
    description: "Get dashboard aggregate stats.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_journeys",
    description: "List journey logs with optional filters.",
    input_schema: {
      type: "object",
      properties: {
        work_order_id: { type: "string" },
        status: { type: "string" },
        page: { type: "number" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_journey_by_work_order",
    description: "Get journey details for a work order.",
    input_schema: {
      type: "object",
      properties: { work_order_id: { type: "string" } },
      required: ["work_order_id"],
    },
  },
  {
    name: "get_journey_health",
    description: "Get health metrics by journey log ID.",
    input_schema: {
      type: "object",
      properties: { journey_log_id: { type: "string" } },
      required: ["journey_log_id"],
    },
  },
  {
    name: "get_journey_analytics",
    description: "Get journey analytics summary.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_email_status",
    description: "Check Outlook connection status.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "poll_email_inbox",
    description: "Poll unread emails and process work orders.",
    input_schema: {
      type: "object",
      properties: { max_emails: { type: "number" } },
    },
  },
  {
    name: "process_email_payload",
    description: "Process a raw email payload and create/assess a work order.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
        from: { type: "string" },
        from_name: { type: "string" },
        id: { type: "string" },
      },
      required: ["subject", "body", "from"],
    },
  },
];

// ─── Tool executors ───────────────────────────────────────────────────────────

async function searchAssets(query: string): Promise<string> {
  try {
    const res = await fetch(woServerUrl(`/api/assets?q=${encodeURIComponent(query)}&limit=6`));
    if (!res.ok) return "No assets found";
    const data = (await res.json()) as Array<{ asset_name: string; asset_code: string; category?: string }>;
    if (!Array.isArray(data) || data.length === 0) return "No matching assets found";
    return JSON.stringify(
      data.map((a) => ({ name: a.asset_name, code: a.asset_code, category: a.category ?? "" })),
    );
  } catch {
    return "Error searching assets";
  }
}

async function searchLocations(query: string): Promise<string> {
  try {
    const res = await fetch(woServerUrl(`/api/locations?q=${encodeURIComponent(query)}&limit=6`));
    if (!res.ok) return "No locations found";
    const data = (await res.json()) as Array<{ name: string }>;
    if (!Array.isArray(data) || data.length === 0) return "No matching locations found";
    return JSON.stringify(data.map((l) => l.name));
  } catch {
    return "Error searching locations";
  }
}

function pickString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function pickNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickRecordWithoutKeys(
  input: Record<string, unknown>,
  keysToSkip: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (keysToSkip.includes(key)) continue;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function woRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(woServerUrl(path), {
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errList = payload.errors;
    const msg =
      Array.isArray(errList) && errList.length > 0
        ? String((errList[0] as Record<string, unknown>).message ?? "Unknown error")
        : String(payload.detail ?? res.statusText);
    throw new Error(msg);
  }
  return payload;
}

async function createWorkOrder(
  input: Record<string, unknown>,
): Promise<{ success: boolean; work_order_id?: string; error?: string }> {
  try {
    const payload: Record<string, unknown> = { ...input };
    if (typeof payload.source !== "string" || !payload.source.trim()) payload.source = "manual";
    if (typeof payload.priority !== "string" || !payload.priority.trim()) payload.priority = "medium";
    if (typeof payload.request_type !== "string" || !payload.request_type.trim()) payload.request_type = "repair";
    if (typeof payload.requester_name !== "string" || !payload.requester_name.trim()) {
      payload.requester_name = "System";
    }
    if (typeof payload.requester_email !== "string" || !payload.requester_email.trim()) {
      payload.requester_email = "system@plenum-tech.com";
    }

    const res = await fetch(woServerUrl("/api/work-orders/"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const errList = err.errors;
      const msg =
        Array.isArray(errList) && errList.length > 0
          ? String((errList[0] as Record<string, unknown>).message ?? "Unknown error")
          : String(err.detail ?? res.statusText);
      return { success: false, error: msg };
    }
    const data = (await res.json()) as { work_order_id: string };
    return { success: true, work_order_id: data.work_order_id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; createdWoId?: string | null }> {
  try {
    if (name === "search_assets") return { content: await searchAssets(String(input.query ?? "")) };
    if (name === "search_locations") return { content: await searchLocations(String(input.query ?? "")) };

    if (name === "create_work_order") {
      const created = await createWorkOrder(input);
      if (!created.success) return { content: JSON.stringify({ success: false, error: created.error }) };
      return {
        content: JSON.stringify({ success: true, work_order_id: created.work_order_id }),
        createdWoId: created.work_order_id ?? null,
      };
    }

    if (name === "list_work_orders") {
      const params = new URLSearchParams();
      const status = pickString(input, "status");
      const priority = pickString(input, "priority");
      const asset = pickString(input, "asset");
      const page = pickNumber(input, "page");
      const limit = pickNumber(input, "limit");
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);
      if (asset) params.set("asset", asset);
      if (page !== undefined) params.set("page", String(page));
      if (limit !== undefined) params.set("limit", String(limit));
      const data = await woRequest(`/api/work-orders/${params.size ? `?${params.toString()}` : ""}`);
      return { content: JSON.stringify(data) };
    }

    if (name === "get_work_order") {
      const workOrderId = pickString(input, "work_order_id");
      const data = await woRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}`);
      return { content: JSON.stringify(data) };
    }

    if (name === "update_work_order") {
      const workOrderId = pickString(input, "work_order_id");
      const body = pickRecordWithoutKeys(input, ["work_order_id"]);
      const data = await woRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return { content: JSON.stringify(data) };
    }

    if (name === "transition_work_order_status") {
      const workOrderId = pickString(input, "work_order_id");
      const body = pickRecordWithoutKeys(input, ["work_order_id"]);
      const data = await woRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/status`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return { content: JSON.stringify(data) };
    }

    if (name === "approve_work_order") {
      const workOrderId = pickString(input, "work_order_id");
      const data = await woRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/approve`, {
        method: "POST",
      });
      return { content: JSON.stringify(data) };
    }

    if (name === "prepare_work_order") {
      const workOrderId = pickString(input, "work_order_id");
      const body = pickRecordWithoutKeys(input, ["work_order_id"]);
      const data = await woRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/prepare`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: JSON.stringify(data) };
    }

    if (name === "close_work_order") {
      const workOrderId = pickString(input, "work_order_id");
      const data = await woRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/close`, {
        method: "POST",
      });
      return { content: JSON.stringify(data) };
    }

    if (name === "get_work_order_history") {
      const workOrderId = pickString(input, "work_order_id");
      const data = await woRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/history`);
      return { content: JSON.stringify(data) };
    }

    if (name === "bulk_update_work_order_status") {
      const data = await woRequest("/api/work-orders/bulk/status", {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      return { content: JSON.stringify(data) };
    }

    if (name === "respond_approval_request") {
      const approvalRequestId = pickString(input, "approval_request_id");
      const approvedRaw = input.approved;
      const approved = approvedRaw === true;
      const notes = pickString(input, "notes");
      const params = new URLSearchParams();
      params.set("approved", String(approved));
      if (notes) params.set("notes", notes);
      const data = await woRequest(
        `/api/work-orders/approvals/${encodeURIComponent(approvalRequestId)}/respond?${params.toString()}`,
        { method: "POST" },
      );
      return { content: JSON.stringify(data) };
    }

    if (name === "get_dashboard_stats") {
      const data = await woRequest("/api/dashboard/stats");
      return { content: JSON.stringify(data) };
    }

    if (name === "list_journeys") {
      const params = new URLSearchParams();
      const workOrderId = pickString(input, "work_order_id");
      const status = pickString(input, "status");
      const page = pickNumber(input, "page");
      const limit = pickNumber(input, "limit");
      if (workOrderId) params.set("work_order_id", workOrderId);
      if (status) params.set("status", status);
      if (page !== undefined) params.set("page", String(page));
      if (limit !== undefined) params.set("limit", String(limit));
      const data = await woRequest(`/api/journeys/${params.size ? `?${params.toString()}` : ""}`);
      return { content: JSON.stringify(data) };
    }

    if (name === "get_journey_by_work_order") {
      const workOrderId = pickString(input, "work_order_id");
      const data = await woRequest(`/api/journeys/by-work-order/${encodeURIComponent(workOrderId)}`);
      return { content: JSON.stringify(data) };
    }

    if (name === "get_journey_health") {
      const journeyLogId = pickString(input, "journey_log_id");
      const data = await woRequest(`/api/journeys/${encodeURIComponent(journeyLogId)}/health`);
      return { content: JSON.stringify(data) };
    }

    if (name === "get_journey_analytics") {
      const data = await woRequest("/api/journeys/analytics/summary");
      return { content: JSON.stringify(data) };
    }

    if (name === "check_email_status") {
      const data = await woRequest("/api/email/status");
      return { content: JSON.stringify(data) };
    }

    if (name === "poll_email_inbox") {
      const maxEmails = pickNumber(input, "max_emails");
      const query = maxEmails !== undefined ? `?max_emails=${maxEmails}` : "";
      const data = await woRequest(`/api/email/poll${query}`, { method: "POST" });
      return { content: JSON.stringify(data) };
    }

    if (name === "process_email_payload") {
      const data = await woRequest("/api/email/process", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const asRecord = data as Record<string, unknown>;
      const created = typeof asRecord.work_order_id === "string" ? asRecord.work_order_id : null;
      return { content: JSON.stringify(data), createdWoId: created };
    }

    return { content: "Unknown tool" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: JSON.stringify({ success: false, error: message }) };
  }
}

// ─── Claude call ──────────────────────────────────────────────────────────────

async function callClaude(
  messages: ApiMessage[],
  apiKey: string,
): Promise<{ content: ContentBlock[]; stop_reason: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
      tools: TOOLS,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Anthropic API error ${res.status}`);
  }

  return res.json() as Promise<{ content: ContentBlock[]; stop_reason: string }>;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it to .env.local and restart the server." },
      { status: 500 },
    );
  }

  const body = (await req.json()) as { messages: ApiMessage[] };
  let messages: ApiMessage[] = body.messages ?? [];
  let createdWoId: string | null = null;
  const processLog: WoProcessLogEntry[] = [];
  let logStep = 0;

  // Tool loop — run until Claude gives a pure text response (max 8 iterations)
  for (let i = 0; i < 8; i++) {
    const result = await callClaude(messages, ANTHROPIC_API_KEY);
    const assistantContent = result.content;

    // Append assistant message to the conversation
    messages = [...messages, { role: "assistant", content: assistantContent }];

    if (result.stop_reason === "end_turn") {
      const textBlock = assistantContent.find((b): b is TextBlock => b.type === "text");
      return Response.json({
        message: textBlock?.text ?? "",
        messages,
        woId: createdWoId,
        processLog,
      });
    }

    if (result.stop_reason === "tool_use") {
      const toolCalls = assistantContent.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const toolResults: ToolResultBlock[] = [];

      for (const call of toolCalls) {
        logStep += 1;
        const toolLabel = formatToolLabel(call.name);
        const startedAt = new Date().toISOString();
        const inputDetail = describeToolInput(call.name, call.input);

        processLog.push({
          id: `${call.id}-start`,
          at: startedAt,
          step: logStep,
          phase: "started",
          tool: call.name,
          toolLabel,
          status: "running",
          title: `${toolLabel} — started`,
          detail: inputDetail,
          input: call.input,
        });

        const t0 = Date.now();
        const toolRun = await runTool(call.name, call.input);
        const durationMs = Date.now() - t0;
        if (toolRun.createdWoId) createdWoId = toolRun.createdWoId;

        const { status, detail, output } = summarizeToolResult(call.name, toolRun.content);
        processLog.push({
          id: call.id,
          at: new Date().toISOString(),
          step: logStep,
          phase: "completed",
          tool: call.name,
          toolLabel,
          status,
          title: `${toolLabel} — ${status === "success" ? "completed" : "failed"}`,
          detail,
          input: call.input,
          output,
          durationMs,
        });

        toolResults.push({ type: "tool_result", tool_use_id: call.id, content: toolRun.content });
      }

      // Add tool results as a user message and continue the loop
      messages = [...messages, { role: "user", content: toolResults }];
    }
  }

  return Response.json({
    message: "Sorry, I ran into an issue. Please try again.",
    messages,
    woId: createdWoId,
    processLog,
  });
}
