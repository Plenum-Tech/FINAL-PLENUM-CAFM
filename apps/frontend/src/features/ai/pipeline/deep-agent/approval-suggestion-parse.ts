/** Parses dynamic approval tool outputs from svc-work-order-management (via deep-agents). */

export const APPROVAL_INSIGHT_TOOLS = [
  "suggest_approval_chain",
  "request_approval_chain",
  "get_approval_chain",
  "create_work_order",
  "create_intelligent_work_order",
] as const;

export type ApprovalToolError = {
  id: string;
  at: string;
  sourceTool: string;
  message: string;
  statusCode?: number;
};

export function isApprovalInsightTool(tool: string): boolean {
  return APPROVAL_INSIGHT_TOOLS.includes(tool as (typeof APPROVAL_INSIGHT_TOOLS)[number]);
}

/** Extract error text from a failed WO / approval tool response. */
export function extractApprovalToolError(
  tool: string,
  output: unknown,
  at: string,
  id: string,
): ApprovalToolError | null {
  if (!isApprovalInsightTool(tool)) return null;
  const root = asRecord(output);
  if (!root?.error) return null;
  const raw = root.error;
  let message = typeof raw === "string" ? raw : JSON.stringify(raw);
  try {
    const parsed = JSON.parse(message) as { errors?: Array<{ message?: string }> };
    const first = parsed.errors?.[0]?.message;
    if (first) message = first;
  } catch {
    /* keep raw */
  }
  return {
    id,
    at,
    sourceTool: tool,
    message,
    statusCode: typeof root.status_code === "number" ? root.status_code : undefined,
  };
}

export type ApprovalChainStep = {
  step?: number;
  step_order?: number;
  level?: number;
  name?: string;
  email?: string;
  approver?: string;
  role?: string;
  status?: string;
  request_id?: string;
  approval_request_id?: string;
};

export type PreviousApprovalProcess = {
  work_order_id?: string;
  match_score?: number;
  chain_summary?: string;
  final_status?: string;
  total_approval_hours?: number;
};

export type ApprovalInsightSourceTool = (typeof APPROVAL_INSIGHT_TOOLS)[number];

export type ApprovalSuggestionInsight = {
  id: string;
  at: string;
  sourceTool: ApprovalInsightSourceTool;
  message?: string;
  confidence?: string;
  confidenceLabel?: string;
  matchScore?: number;
  riskScore?: number;
  recommendedSummary?: string;
  steps: ApprovalChainStep[];
  previousProcesses: PreviousApprovalProcess[];
  workOrderId?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseStep(raw: unknown): ApprovalChainStep | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    step: typeof r.step === "number" ? r.step : undefined,
    step_order: typeof r.step_order === "number" ? r.step_order : undefined,
    level: typeof r.level === "number" ? r.level : undefined,
    name: typeof r.name === "string" ? r.name : undefined,
    email: typeof r.email === "string" ? r.email : undefined,
    approver: typeof r.approver === "string" ? r.approver : undefined,
    role: typeof r.role === "string" ? r.role : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
    request_id: typeof r.request_id === "string" ? r.request_id : undefined,
    approval_request_id:
      typeof r.approval_request_id === "string" ? r.approval_request_id : undefined,
  };
}

function parseStepsFromChain(chain: unknown[]): ApprovalChainStep[] {
  return chain.map(parseStep).filter((s): s is ApprovalChainStep => s != null);
}

function parsePreviousApprovalProcesses(raw: unknown): PreviousApprovalProcess[] {
  const out: PreviousApprovalProcess[] = [];
  for (const p of asArray(raw)) {
    const row = asRecord(p);
    if (!row) continue;
    out.push({
      work_order_id: typeof row.work_order_id === "string" ? row.work_order_id : undefined,
      match_score: typeof row.match_score === "number" ? row.match_score : undefined,
      chain_summary: typeof row.chain_summary === "string" ? row.chain_summary : undefined,
      final_status: typeof row.final_status === "string" ? row.final_status : undefined,
      total_approval_hours:
        typeof row.total_approval_hours === "number" ? row.total_approval_hours : undefined,
    });
  }
  return out;
}

function stepLabel(step: ApprovalChainStep): string {
  const who = step.name || step.email || step.approver || "Approver";
  const role = step.role ? ` · ${step.role}` : "";
  const order = step.step_order ?? step.step ?? step.level;
  const prefix = order != null ? `Step ${order}: ` : "";
  return `${prefix}${who}${role}`;
}

export function formatApprovalStep(step: ApprovalChainStep): string {
  return stepLabel(step);
}

const WO_ID_RE = /WO-\d{14,}/i;

/** Latest work order id from approval / create tool outputs. */
export function extractWorkOrderIdFromToolCalls(
  calls: Array<{ tool: string; output?: unknown }>,
): string | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const { tool, output } = calls[i];
    const insight = parseApprovalToolOutput(tool, output, "", "");
    if (insight?.workOrderId) return insight.workOrderId;

    const root = asRecord(output);
    if (!root) {
      if (typeof output === "string") {
        const m = output.match(WO_ID_RE);
        if (m) return m[0].toUpperCase();
      }
      continue;
    }
    if (typeof root.work_order_id === "string") return root.work_order_id;
    const nested = asRecord(root.work_order);
    if (typeof nested?.work_order_id === "string") return nested.work_order_id;
  }
  return null;
}

function approvalPayloadFromCreateOutput(output: unknown): Record<string, unknown> | null {
  const root = asRecord(output);
  if (!root || root.error) return null;

  const nestedWo = asRecord(root.work_order);
  const suggestion =
    asRecord(root.approval_suggestion) ??
    asRecord(nestedWo?.approval_suggestion) ??
    (root.auto_suggestion || nestedWo?.auto_suggestion ? root : null);

  if (suggestion && (suggestion.chain || suggestion.auto_suggestion || suggestion.previous_approval_processes)) {
    return suggestion;
  }

  if (root.auto_suggestion || nestedWo?.auto_suggestion) {
    return {
      ...root,
      work_order_id:
        (typeof root.work_order_id === "string" && root.work_order_id) ||
        (typeof nestedWo?.work_order_id === "string" ? nestedWo.work_order_id : undefined),
      auto_suggestion: root.auto_suggestion ?? nestedWo?.auto_suggestion,
      chain: root.chain ?? nestedWo?.chain,
      previous_approval_processes:
        root.previous_approval_processes ?? nestedWo?.previous_approval_processes,
      message:
        (typeof root.message === "string" && root.message) ||
        (typeof nestedWo?.message === "string" ? nestedWo.message : undefined),
    };
  }

  return null;
}

export function parseApprovalToolOutput(
  tool: string,
  output: unknown,
  at: string,
  id: string,
): ApprovalSuggestionInsight | null {
  if (!isApprovalInsightTool(tool)) {
    return null;
  }

  const root = asRecord(output);
  if (!root || root.error) return null;

  if (tool === "create_work_order" || tool === "create_intelligent_work_order") {
    const payload = approvalPayloadFromCreateOutput(output);
    if (!payload) return null;
    const insight = parseApprovalToolOutput(
      "suggest_approval_chain",
      payload,
      at,
      id,
    );
    if (!insight) return null;
    return { ...insight, sourceTool: tool as ApprovalInsightSourceTool };
  }

  if (tool === "get_approval_chain") {
    const woId = typeof root.work_order_id === "string" ? root.work_order_id : undefined;
    const chain = parseStepsFromChain(asArray(root.chain));
    if (!chain.length && !woId) return null;
    return {
      id,
      at,
      sourceTool: "get_approval_chain",
      workOrderId: woId,
      steps: chain,
      previousProcesses: [],
      recommendedSummary: chain.map((s) => stepLabel(s)).join(" → "),
    };
  }

  const auto = asRecord(root.auto_suggestion);
  const message =
    (typeof auto?.message === "string" && auto.message) ||
    (typeof root.message === "string" ? root.message : undefined);
  const recommendedSummary =
    (typeof auto?.recommended_chain_summary === "string" && auto.recommended_chain_summary) ||
    undefined;

  const chainRaw = asArray(root.chain).length
    ? asArray(root.chain)
    : asArray(auto?.recommended_steps);

  const steps = parseStepsFromChain(chainRaw);

  const previousProcesses = parsePreviousApprovalProcesses(root.previous_approval_processes);

  const woNested = asRecord(root.work_order);
  const workOrderId =
    (typeof root.work_order_id === "string" && root.work_order_id) ||
    (typeof woNested?.work_order_id === "string" ? woNested.work_order_id : undefined);

  if (!message && !steps.length && !previousProcesses.length && !recommendedSummary) {
    return null;
  }

  return {
    id,
    at,
    sourceTool: tool as ApprovalInsightSourceTool,
    message,
    confidence: typeof root.confidence === "string" ? root.confidence : undefined,
    confidenceLabel:
      typeof auto?.confidence_label === "string" ? auto.confidence_label : undefined,
    matchScore: typeof root.match_score === "number" ? root.match_score : undefined,
    riskScore: typeof root.risk_score === "number" ? root.risk_score : undefined,
    recommendedSummary,
    steps,
    previousProcesses,
    workOrderId: typeof workOrderId === "string" ? workOrderId : undefined,
  };
}

export function pickLatestApprovalInsight(
  toolCalls: { tool: string; output?: unknown }[],
): ApprovalSuggestionInsight | null {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const tc = toolCalls[i];
    const insight = parseApprovalToolOutput(
      tc.tool,
      tc.output,
      new Date().toISOString(),
      `insight_${i}`,
    );
    if (insight) return insight;
  }
  return null;
}
