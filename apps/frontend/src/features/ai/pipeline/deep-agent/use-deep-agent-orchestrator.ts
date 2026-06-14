"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { schemaMapperApi } from "@/features/ai/chat-api";

import {
  buildDeepAgentsWebSocketUrl,
  deepAgentsApi,
  DEEP_AGENT_SESSION_STORAGE_KEY,
  DOMAIN_LABELS,
  extractAmbientSchemaMappingIds,
  extractExplicitSchemaMappingIds,
  extractIngestedDocumentIds,
  extractIngestedMigrationIds,
  extractSchemaMappingIdsFromText,
  getDeepAgentsErrorMessage,
  useDeepAgentsResume,
  useDeepAgentsRunStateful,
  useDeepAgentsRunStatefulWithFiles,
  useDeepAgentsTools,
  type ToolCallRecord,
  type WorkflowResponse,
  type WorkflowStreamEvent,
  type WorkspaceStatus,
} from "@/features/ai/deep-agents-api";

import type { DeepAgentDocMatchContext } from "./deep-agent-doc-match-panel";
import type { DeepAgentMigrationContext } from "./deep-agent-migration-panel";
import type { DeepAgentSchemaContext } from "./deep-agent-schema-panel";

import type { DeepAgentProcessLogEntry } from "./deep-agent-process-log";
import {
  findSemanticallySimilarPin,
  loadCustomPins,
  PINNED_RUNS_CATALOG,
} from "./deep-agent-pinned-runs";
import {
  artifactHintFromResponse,
  classificationWithBackendAnchor,
  classifySessionFromSignals,
  classifySignalsFromAttachments,
  classifySignalsFromForcedRoute,
  classifySignalsFromIntentSpace,
  classifySignalsFromResponse,
  classifySignalsFromUserMessage,
  formatArtifactHint,
  isSavedSpaceId,
  countArtifactsFromResponse,
  type SavedSpaceId,
  type SpaceClassification,
} from "./deep-agent-spaces";
import { loadDeepAgentSessions } from "./deep-agent-sessions";
import { classifyUploadFiles } from "./single-door-ingest-progress";
import { buildOrchestratorContext, type UdrForcedRoute } from "./udr-route-context";

export type SendMessageOptions = {
  forcedRoute?: UdrForcedRoute;
  migrationId?: string;
  /** User-facing saved space this send belongs to (from intent chip / panel button /
   *  pinned run). Strongest pre-classification signal — dominant over forcedRoute. */
  intentSpace?: SavedSpaceId;
};
import {
  extractApprovalToolError,
  isApprovalInsightTool,
  parseApprovalToolOutput,
  pickLatestApprovalInsight,
  type ApprovalSuggestionInsight,
  type ApprovalToolError,
} from "./approval-suggestion-parse";

export type DeepAgentTurn = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  at?: string;
};

export type AgentSwitchEvent = {
  id: string;
  at: string;
  from: string;
  to: string;
};

export const DEEP_AGENT_TURNS_STORAGE_KEY = "plenum_deep_agent_turns_v1";
const DEEP_AGENT_SCHEMA_CTX_STORAGE_KEY = "plenum_deep_agent_schema_ctx_v1";

function loadSchemaContextForSession(sessionId: string): DeepAgentSchemaContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEEP_AGENT_SCHEMA_CTX_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, DeepAgentSchemaContext>;
    const ctx = map[sessionId];
    if (ctx?.schemaMappingIds?.length) return ctx;
  } catch {
    /* ignore */
  }
  return null;
}

function saveSchemaContextForSession(sessionId: string, ctx: DeepAgentSchemaContext | null) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(DEEP_AGENT_SCHEMA_CTX_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, DeepAgentSchemaContext>) : {};
    if (ctx?.schemaMappingIds?.length) map[sessionId] = ctx;
    else delete map[sessionId];
    window.localStorage.setItem(DEEP_AGENT_SCHEMA_CTX_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function schemaContextFromTurns(turns: DeepAgentTurn[]): DeepAgentSchemaContext | null {
  const ids = extractSchemaMappingIdsFromText(...turns.map((t) => t.text));
  if (!ids.length) return null;
  // The UUID regex matches any UUID in the chat text, including migration IDs
  // logged in tool outputs. Don't claim a schemaContext just because some UUID
  // exists — require an explicit Fiix / Schema Mapper signal in the turns.
  // Without this, refreshing during a migration would seed schemaContext from
  // turn text, hijack the center tab to Schema Mapping, and infinite-loop on
  // "Loading schema mapping status…" because that ID is the migration's id.
  const lowered = turns.map((t) => t.text.toLowerCase());
  const hasSchemaSignal = lowered.some(
    (txt) =>
      txt.includes("fiix") ||
      txt.includes("schema mapping started") ||
      txt.includes("schema mapping completed") ||
      txt.includes("live cmms") ||
      txt.includes("schema mapper"),
  );
  if (!hasSchemaSignal) return null;
  // If the most recent strong signal is migration, the schema-shaped UUIDs are
  // almost certainly the migration's own schema ids — don't expose them.
  const lastMigrationSignal = lowered.findIndex((txt) =>
    txt.includes("migration started") ||
    txt.includes("migration completed") ||
    txt.includes("ingest started") ||
    txt.includes("ingest completed"),
  );
  const lastSchemaSignal = lowered.findIndex(
    (txt) =>
      txt.includes("fiix") ||
      txt.includes("schema mapping started") ||
      txt.includes("schema mapping completed") ||
      txt.includes("live cmms") ||
      txt.includes("schema mapper"),
  );
  if (lastMigrationSignal !== -1 && lastSchemaSignal !== -1 && lastMigrationSignal > lastSchemaSignal) {
    return null;
  }
  const fiix = lowered.some((txt) => txt.includes("fiix") || txt.includes("schema mapping started"));
  return {
    schemaMappingIds: ids,
    labels: ids.map((_, i) => (fiix && i === 0 ? "Fiix CMMS" : ids[i].slice(0, 8))),
  };
}

const GREETING: DeepAgentTurn = {
  id: "greeting",
  role: "assistant",
  text: "Ask about work orders, assets, compliance, migrations, or documents. I route to the right domain agents and show each step in the process log.",
};

const STARTER_PROMPTS = [
  "Morning ops briefing: critical WOs, today's PM, zero-stock parts, compliance rate.",
  "List open work orders with urgent or critical priority.",
  "Who should approve an urgent HVAC repair at Building A Roof? Show similar past approvals.",
  "Which assets are most at risk — overdue PM, critical WOs, compliance?",
  "Is asset MOB-AHU-001 compliant? Summarize only.",
];

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function formatToolOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

type PendingTool = {
  input: Record<string, unknown>;
  domain: string;
  startedAt: number;
};

function loadTurnsForSession(sessionId: string): DeepAgentTurn[] {
  if (typeof window === "undefined") return [GREETING];
  try {
    const raw = window.localStorage.getItem(DEEP_AGENT_TURNS_STORAGE_KEY);
    if (!raw) return [GREETING];
    const map = JSON.parse(raw) as Record<string, DeepAgentTurn[]>;
    const saved = map[sessionId];
    if (saved?.length) return saved;
  } catch {
    /* ignore */
  }
  return [GREETING];
}

function saveTurnsForSession(sessionId: string, turns: DeepAgentTurn[]) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(DEEP_AGENT_TURNS_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, DeepAgentTurn[]>) : {};
    map[sessionId] = turns;
    window.localStorage.setItem(DEEP_AGENT_TURNS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function createDeepAgentSessionId() {
  return crypto.randomUUID();
}

export function loadStoredDeepAgentSessionId(): string {
  if (typeof window === "undefined") return createDeepAgentSessionId();
  try {
    const stored = window.localStorage.getItem(DEEP_AGENT_SESSION_STORAGE_KEY);
    if (stored?.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return createDeepAgentSessionId();
}

export function persistDeepAgentSessionId(sessionId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEEP_AGENT_SESSION_STORAGE_KEY, sessionId);
  } catch {
    /* ignore */
  }
}

export function useDeepAgentOrchestrator(options: {
  sessionId: string;
  orgId?: string;
  serviceAvailable?: boolean | null;
  useStreaming?: boolean;
}) {
  const { sessionId, orgId, serviceAvailable, useStreaming = true } = options;

  const [turns, setTurns] = useState<DeepAgentTurn[]>(() => loadTurnsForSession(sessionId));
  const [pending, setPending] = useState(false);
  const [interruptPayload, setInterruptPayload] = useState<Record<string, unknown> | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [processLog, setProcessLog] = useState<DeepAgentProcessLogEntry[]>([]);
  const [liveEvents, setLiveEvents] = useState<
    Array<{ id: string; label: string; domain: string; status: "running" | "done" }>
  >([]);
  const [activeDomain, setActiveDomain] = useState("meta");
  const [lastRouteIntent, setLastRouteIntent] = useState("");
  const [sessionSpace, setSessionSpace] = useState<SavedSpaceId>("general");
  const [sessionClassification, setSessionClassification] = useState<SpaceClassification | null>(
    null,
  );
  /** Option A — canonical primary from backend infer_saved_space (workspace poll + response). */
  const [backendSavedSpace, setBackendSavedSpace] = useState<SavedSpaceId | null>(null);
  const [lastArtifactHint, setLastArtifactHint] = useState<string | undefined>();
  const [lastArtifactDelta, setLastArtifactDelta] = useState<
    Partial<Record<SavedSpaceId, number>>
  >({});
  const [domainHeat, setDomainHeat] = useState<Record<string, number>>({ meta: Date.now() });
  const [switchTrail, setSwitchTrail] = useState<AgentSwitchEvent[]>([]);
  const [runningToolCount, setRunningToolCount] = useState(0);
  const [approvalInsight, setApprovalInsight] = useState<ApprovalSuggestionInsight | null>(null);
  const [approvalToolError, setApprovalToolError] = useState<ApprovalToolError | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<import("@/features/ai/deep-agents-api").IngestBatchStatus | null>(
    null,
  );
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);

  const processStepRef = useRef(0);
  const sessionClassificationRef = useRef<SpaceClassification | null>(null);
  const pendingToolStacks = useRef<Record<string, PendingTool[]>>({});
  const lastDocUploadNamesRef = useRef<string[]>([]);
  const lastMigrationUploadNamesRef = useRef<string[]>([]);
  const lastSchemaUploadNamesRef = useRef<string[]>([]);
  const [docMatchContext, setDocMatchContext] = useState<DeepAgentDocMatchContext | null>(null);
  const [migrationContext, setMigrationContext] = useState<DeepAgentMigrationContext | null>(null);
  const [schemaContext, setSchemaContext] = useState<DeepAgentSchemaContext | null>(() => {
    const turns = loadTurnsForSession(sessionId);
    const persisted = loadSchemaContextForSession(sessionId);
    if (persisted) {
      // Earlier builds populated this cache from any UUID-shaped string in
      // turn text (including migration ids). Validate the persisted value
      // against the same hardened signals schemaContextFromTurns uses before
      // trusting it. If the persisted ctx isn't backed by a real schema
      // signal in the current turn store, drop it and clear the cache so
      // refresh stops landing on Schema Mapping for migration-only sessions.
      const verified = schemaContextFromTurns(turns);
      if (verified) return persisted;
      saveSchemaContextForSession(sessionId, null);
      return null;
    }
    return schemaContextFromTurns(turns);
  });
  const { data: toolsCatalog = [] } = useDeepAgentsTools({ enabled: true });

  const pulseDomain = useCallback((domain: string) => {
    setActiveDomain(domain);
    setDomainHeat((prev) => ({ ...prev, [domain]: Date.now() }));
  }, []);

  /**
   * Backend workspace_status.saved_space is a SOFT signal (heuristic inference from
   * route + active tool). It can UPGRADE general → specific, but it should not
   * overwrite a specific frontend classification — those come from explicit user
   * signals (intent chip forced route, file extension, user text) and are usually
   * more accurate than the backend's inference. Hard anchors driven by confirmed
   * artefacts (migration_id / document_id) live in applyResponse and remain
   * authoritative. Always pulse the route/domain regardless.
   */
  const anchorFromBackendWorkspace = useCallback(
    (ws: WorkspaceStatus, priorClassification: SpaceClassification | null) => {
      if (ws.last_route_intent) setLastRouteIntent(ws.last_route_intent);
      if (ws.last_domain) pulseDomain(ws.last_domain);
      if (!ws.saved_space || !isSavedSpaceId(ws.saved_space)) return;
      const space = ws.saved_space;
      const priorPrimary = priorClassification?.primarySpace ?? "general";
      const priorConfidence = priorClassification?.confidence ?? 0;
      // Skip when the frontend already has a confident specific classification —
      // backend inference shouldn't move chip/file-tagged sessions to a different space.
      if (priorPrimary !== "general" && priorPrimary !== space && priorConfidence >= 0.5) {
        return;
      }
      // Never downgrade a specific frontend space to "general".
      if (space === "general" && priorPrimary !== "general") {
        return;
      }
      const anchored = classificationWithBackendAnchor(space, priorClassification);
      setBackendSavedSpace(space);
      setSessionSpace(space);
      setSessionClassification(anchored);
      sessionClassificationRef.current = anchored;
    },
    [pulseDomain],
  );

  useEffect(() => {
    sessionClassificationRef.current = sessionClassification;
  }, [sessionClassification]);

  const applyApprovalFromToolCalls = useCallback((calls: ToolCallRecord[]) => {
    setApprovalInsight(pickLatestApprovalInsight(calls));
    for (let i = calls.length - 1; i >= 0; i--) {
      const tc = calls[i];
      const err = extractApprovalToolError(
        tc.tool,
        tc.output,
        new Date().toISOString(),
        nowId("approval_err"),
      );
      if (err) {
        setApprovalToolError(err);
        return;
      }
    }
    setApprovalToolError(null);
  }, []);

  const applyApprovalFromSingleTool = useCallback((tool: string, output: unknown) => {
    const at = new Date().toISOString();
    const err = extractApprovalToolError(tool, output, at, nowId("approval_err"));
    if (err) {
      setApprovalToolError(err);
      return;
    }
    setApprovalToolError(null);
    const insight = parseApprovalToolOutput(tool, output, at, nowId("approval"));
    if (insight) setApprovalInsight(insight);
  }, []);

  const appendProcessLog = useCallback(
    (partial: Omit<DeepAgentProcessLogEntry, "id" | "at" | "step"> & { id?: string }) => {
      processStepRef.current += 1;
      const entry: DeepAgentProcessLogEntry = {
        id: partial.id ?? nowId("plog"),
        at: new Date().toISOString(),
        step: processStepRef.current,
        ...partial,
      };
      setProcessLog((prev) => [...prev, entry]);
    },
    [],
  );

  const logToolCompletion = useCallback(
    (
      tool: string,
      input: Record<string, unknown>,
      output: unknown,
      durationMs?: number,
    ) => {
      const at = new Date().toISOString();
      const approvalErr = extractApprovalToolError(tool, output, at, nowId("plog_err"));
      let errMsg: string | null = approvalErr?.message ?? null;
      if (!errMsg && output && typeof output === "object" && !Array.isArray(output) && "error" in output) {
        errMsg = String((output as Record<string, unknown>).error);
      }

      if (isApprovalInsightTool(tool)) {
        if (approvalErr) setApprovalToolError(approvalErr);
        else if (errMsg) {
          setApprovalToolError({ id: nowId("approval_err"), at, sourceTool: tool, message: errMsg });
        } else setApprovalToolError(null);
      }

      appendProcessLog({
        phase: "completed",
        tool,
        toolLabel: tool,
        status: errMsg ? "error" : "success",
        title: errMsg ? `${tool} failed` : `${tool} completed`,
        detail: errMsg ?? "Returned successfully",
        input,
        output: formatToolOutput(output),
        durationMs,
      });
    },
    [appendProcessLog],
  );

  const logToolCallsFromRest = useCallback(
    (calls: ToolCallRecord[]) => {
      for (const tc of calls) {
        const domain = toolsCatalog.find((t) => t.name === tc.tool)?.domain ?? "unknown";
        pulseDomain(domain);
        appendProcessLog({
          phase: "started",
          tool: tc.tool,
          toolLabel: tc.tool,
          status: "running",
          title: `Calling ${tc.tool}`,
          detail: DOMAIN_LABELS[domain] ?? domain,
          input: tc.input,
        });
        logToolCompletion(tc.tool, tc.input, tc.output);
      }
    },
    [logToolCompletion, pulseDomain, toolsCatalog],
  );

  useEffect(() => {
    setTurns(loadTurnsForSession(sessionId));
    setInterruptPayload(null);
    setToolCalls([]);
    setProcessLog([]);
    setLiveEvents([]);
    setSwitchTrail([]);
    setRunningToolCount(0);
    setApprovalInsight(null);
    setApprovalToolError(null);
    setActiveDomain("meta");
    setLastRouteIntent("");
    setSessionSpace("general");
    setSessionClassification(null);
    setBackendSavedSpace(null);
    setLastArtifactHint(undefined);
    setDomainHeat({ meta: Date.now() });
    processStepRef.current = 0;
    pendingToolStacks.current = {};
    setDocMatchContext(null);
    setMigrationContext(null);
    const loadedTurns = loadTurnsForSession(sessionId);
    const persisted = loadSchemaContextForSession(sessionId);
    const fromTurns = schemaContextFromTurns(loadedTurns);
    if (persisted) {
      // Same validation as the useState initializer — drop stale persisted
      // contexts that aren't backed by a real schema signal in the turns.
      if (fromTurns) {
        setSchemaContext(persisted);
      } else {
        saveSchemaContextForSession(sessionId, null);
        setSchemaContext(null);
      }
    } else {
      setSchemaContext(fromTurns);
    }
    const stored = loadDeepAgentSessions().find((s) => s.id === sessionId);
    if (stored?.documentIds?.length) {
      setDocMatchContext({
        documentIds: stored.documentIds,
        fileNames: stored.documentIds.map((id) => id.slice(0, 8)),
      });
    }
    // Restore the migration flow too (parity with documentIds) so the Migration
    // panel survives session reloads — e.g. after Output Generation completes, or
    // when both an Excel migration and a PDF doc ran in the same session.
    if (stored?.migrationIds?.length) {
      setMigrationContext({
        migrationIds: stored.migrationIds,
        fileNames: stored.migrationIds.map((id) => id.slice(0, 8)),
      });
    }
    if (stored?.spaceWeights) {
      const restored = classifySessionFromSignals(stored.spaceWeights);
      setSessionClassification(restored);
      setSessionSpace(stored.userOverrideSpace ?? restored.primarySpace);
      if (stored.artifactHint) setLastArtifactHint(stored.artifactHint);
    }
    lastDocUploadNamesRef.current = [];
    lastMigrationUploadNamesRef.current = [];
    lastSchemaUploadNamesRef.current = [];
  }, [sessionId]);

  useEffect(() => {
    saveSchemaContextForSession(sessionId, schemaContext);
  }, [sessionId, schemaContext]);

  useEffect(() => {
    const fromTurns = schemaContextFromTurns(turns);
    if (!fromTurns) return;
    setSchemaContext((prev) => {
      const merged = [...new Set([...(prev?.schemaMappingIds ?? []), ...fromTurns.schemaMappingIds])];
      if (
        prev &&
        prev.schemaMappingIds.length === merged.length &&
        prev.schemaMappingIds.every((id, i) => id === merged[i])
      ) {
        return prev;
      }
      return {
        schemaMappingIds: merged,
        labels: merged.map((_, i) => fromTurns.labels[i] ?? prev?.labels[i] ?? merged[i].slice(0, 8)),
      };
    });
  }, [turns]);

  useEffect(() => {
    saveTurnsForSession(sessionId, turns);
  }, [sessionId, turns]);

  useEffect(() => {
    if (!activeBatchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const status = await deepAgentsApi.getIngestBatch(activeBatchId);
        if (cancelled) return;
        setBatchProgress(status);
        if (["completed", "failed", "cancelled"].includes(status.status)) {
          setActiveBatchId(null);
          setTurns((prev) => [
            ...prev,
            {
              id: nowId("assistant"),
              role: "assistant",
              text:
                `Bulk ingest ${status.status}: ${status.completed_count} succeeded, ` +
                `${status.failed_count} failed (${status.total_files} total).`,
              at: new Date().toISOString(),
            },
          ]);
          return;
        }
        timer = setTimeout(() => void poll(), 2500);
      } catch {
        if (!cancelled) timer = setTimeout(() => void poll(), 4000);
      }
    };

    timer = setTimeout(() => void poll(), 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeBatchId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await deepAgentsApi.getWorkflowStatus(sessionId);
        if (cancelled) return;
        if (status.interrupted && status.interrupt_payload) {
          setInterruptPayload(status.interrupt_payload);
        }
      } catch {
        /* new session */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    const syncSchemaRail = async () => {
      try {
        const ws = await deepAgentsApi.getWorkspaceStatus(sessionId);
        if (cancelled) return;
        anchorFromBackendWorkspace(ws, sessionClassificationRef.current);
        const active = ws.active_schema_mapping_id?.trim();
        const ids = ws.schema_mapping_ids?.length
          ? ws.schema_mapping_ids
          : active
            ? [active]
            : [];
        if (!ids.length) return;
        // Backend reuses active_schema_mapping_id for non-schema pipelines (migration,
        // doc indexing, work orders). Only populate schemaContext when the flow is
        // actually a schema mapping (Fiix flow, saved_space="schema", or schema_pipeline_kind set).
        const isFiixFlow = Boolean(ws.fiix_subdomain);
        const isSchemaSpace = ws.saved_space === "schema";
        const isExplicitSchemaPipeline = Boolean(
          (ws as { schema_pipeline_kind?: string }).schema_pipeline_kind,
        );
        if (!isFiixFlow && !isSchemaSpace && !isExplicitSchemaPipeline) return;
        setSchemaContext((prev) => {
          const merged = [...new Set([...(prev?.schemaMappingIds ?? []), ...ids])];
          if (
            prev &&
            prev.schemaMappingIds.length === merged.length &&
            prev.schemaMappingIds.every((id, i) => id === merged[i])
          ) {
            return prev;
          }
          const fiix = isFiixFlow || Boolean(prev?.labels.some((l) => l === "Fiix CMMS"));
          return {
            schemaMappingIds: merged,
            labels: merged.map((_, i) =>
              fiix && i === 0 ? "Fiix CMMS" : prev?.labels[i] ?? merged[i].slice(0, 8),
            ),
          };
        });
      } catch {
        /* workspace optional */
      }
    };
    void syncSchemaRail();
    const timer = setInterval(() => void syncSchemaRail(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [anchorFromBackendWorkspace, sessionId]);

  const applySchemaContext = useCallback((res: WorkflowResponse, fiixFromChat = false) => {
    // Two-tier extraction — see deep-agents-api.ts for the rationale.
    //   1. Explicit schema-mapping tool calls / answer-text echoes are
    //      always honoured: the user really did start a schema flow.
    //   2. Ambient workspace_status ids are ONLY honoured when a real
    //      schema-flow indicator fires (Fiix subdomain, saved_space="schema",
    //      or schema_pipeline_kind). Without this gate, an XLSX migration
    //      reuses the same ``active_schema_mapping_id`` field and spawns a
    //      phantom Schema task that gets stuck on "Loading…" because the id
    //      is actually a migration id.
    const explicit = extractExplicitSchemaMappingIds(res);
    const ws = res.workspace_status as
      | {
          active_schema_mapping_id?: string;
          schema_mapping_ids?: string[];
          fiix_subdomain?: string;
          saved_space?: string;
          schema_pipeline_kind?: string;
        }
      | null
      | undefined;
    const isFiixFlow = fiixFromChat || Boolean(ws?.fiix_subdomain);
    const isSchemaSpace = ws?.saved_space === "schema";
    const isExplicitSchemaPipeline = Boolean(ws?.schema_pipeline_kind);
    const allowAmbient = isFiixFlow || isSchemaSpace || isExplicitSchemaPipeline;
    const ambient = allowAmbient ? extractAmbientSchemaMappingIds(res) : [];
    const schemaIds = [...new Set([...explicit, ...ambient])];
    if (!schemaIds.length) return;
    setSchemaContext((prev) => {
      const merged = [...new Set([...(prev?.schemaMappingIds ?? []), ...schemaIds])];
      const fiix = isFiixFlow || Boolean(prev?.labels.some((l) => l === "Fiix CMMS"));
      return {
        schemaMappingIds: merged,
        labels: merged.map((_, i) =>
          fiix && i === 0 ? "Fiix CMMS" : prev?.labels[i] ?? merged[i].slice(0, 8),
        ),
      };
    });
    appendProcessLog({
      phase: "started",
      tool: "schema_pipeline",
      toolLabel: "Schema mapper",
      status: "running",
      title: fiixFromChat ? "Fiix → schema mapping" : "Schema mapping",
      detail: "canonical → ingest → gates → hierarchy → artifacts",
    });
  }, [appendProcessLog]);

  const applyResponse = useCallback(
    (res: WorkflowResponse) => {
      const routeIntent = res.route_metadata?.route_intent ?? "";
      const routeDomain = res.route_metadata?.selected_domain ?? "";
      if (routeIntent) setLastRouteIntent(routeIntent);
      if (routeDomain) pulseDomain(routeDomain);

      const docIds = extractIngestedDocumentIds(res);
      const migrationIds = extractIngestedMigrationIds(res);

      let classification = classifySessionFromSignals(
        sessionClassification?.spaceWeights,
        classifySignalsFromResponse(res),
      );
      if (docIds.length) {
        classification = classificationWithBackendAnchor("documents", classification);
      } else if (migrationIds.length) {
        classification = classificationWithBackendAnchor("migration", classification);
      }
      setSessionClassification(classification);
      if (res.workspace_status?.saved_space && isSavedSpaceId(res.workspace_status.saved_space)) {
        anchorFromBackendWorkspace(res.workspace_status, classification);
      } else {
        setSessionSpace(classification.primarySpace);
      }
      let hint = artifactHintFromResponse(res);
      if (!hint && docIds.length) hint = formatArtifactHint("Doc", docIds[0]);
      if (hint) setLastArtifactHint(hint);
      setLastArtifactDelta(countArtifactsFromResponse(res));

      if (res.tool_calls?.length) {
        setToolCalls(res.tool_calls);
        logToolCallsFromRest(res.tool_calls);
        applyApprovalFromToolCalls(res.tool_calls);
      } else {
        setToolCalls([]);
      }
      if (docIds.length) {
        setDocMatchContext({
          documentIds: docIds,
          fileNames: lastDocUploadNamesRef.current.length
            ? lastDocUploadNamesRef.current
            : docIds.map((id) => id.slice(0, 8)),
        });
      }
      if (migrationIds.length) {
        setMigrationContext({
          migrationIds,
          fileNames: lastMigrationUploadNamesRef.current.length
            ? lastMigrationUploadNamesRef.current
            : migrationIds.map((id) => id.slice(0, 8)),
        });
      }
      const fiixFromChat = (res.tool_calls ?? []).some((tc) =>
        [
          "start_fiix_schema_mapping",
          "fetch_fiix_schema",
          "configure_fiix_credentials",
          "get_schema_mapping_status",
          "continue_schema_mapping_gate",
        ].includes(tc.tool),
      );
      applySchemaContext(res, fiixFromChat);
      setLiveEvents([]);
      setRunningToolCount(0);
      if (res.interrupted && res.interrupt_payload) {
        setInterruptPayload(res.interrupt_payload);
        return;
      }
      setInterruptPayload(null);
      const docIdNote =
        docIds.length > 0
          ? `\n\n**Document ID:** \`${docIds.join("`, `")}\`\nOpen the **Documents** tab for extraction, row matching, and Q&A.`
          : "";
      if (res.answer?.trim()) {
        setTurns((prev) => [
          ...prev,
          {
            id: nowId("assistant"),
            role: "assistant",
            text: `${res.answer.trim()}${docIdNote}`,
            at: new Date().toISOString(),
          },
        ]);
      } else if (docIds.length) {
        setTurns((prev) => [
          ...prev,
          {
            id: nowId("assistant"),
            role: "assistant",
            text: `Document indexed.${docIdNote}`,
            at: new Date().toISOString(),
          },
        ]);
      } else if (!res.success && res.error) {
        setTurns((prev) => [
          ...prev,
          { id: nowId("error"), role: "error", text: res.error ?? "Request failed", at: new Date().toISOString() },
        ]);
      }
      return res.batch_id ?? null;
    },
    [
      anchorFromBackendWorkspace,
      applyApprovalFromToolCalls,
      applySchemaContext,
      logToolCallsFromRest,
      pulseDomain,
      sessionClassification?.spaceWeights,
    ],
  );

  const { mutateAsync: runStateful } = useDeepAgentsRunStateful();
  const { mutateAsync: runStatefulWithFiles } = useDeepAgentsRunStatefulWithFiles();
  const { mutateAsync: resumeWorkflow, isPending: resuming } = useDeepAgentsResume();

  const runViaRest = useCallback(
    async (message: string, files?: File[], sendOpts?: SendMessageOptions) => {
      const context = buildOrchestratorContext({
        orgId,
        forcedRoute: sendOpts?.forcedRoute,
        migrationId: sendOpts?.migrationId,
      });
      if (files?.length) {
        setUploadingFiles(files);
        const kinds = classifyUploadFiles(files);
        if (kinds.docRag) {
          lastDocUploadNamesRef.current = files
            .filter((f) => /\.(pdf|docx?|txt|png|jpe?g|webp|tiff?|gif)$/i.test(f.name))
            .map((f) => f.name);
        } else {
          lastDocUploadNamesRef.current = [];
        }
        if (kinds.migration) {
          lastMigrationUploadNamesRef.current = files
            .filter((f) => /\.(csv|xlsx|xls|xlsm)$/i.test(f.name))
            .map((f) => f.name);
        } else {
          lastMigrationUploadNamesRef.current = [];
        }
        if (kinds.schema) {
          lastSchemaUploadNamesRef.current = files
            .filter((f) => /\.(ya?ml|json)$/i.test(f.name))
            .map((f) => f.name);
        } else {
          lastSchemaUploadNamesRef.current = [];
        }
        if (kinds.migration) {
          appendProcessLog({
            phase: "started",
            tool: "migration_pipeline",
            toolLabel: "Migration pipeline",
            status: "running",
            title: "CSV/Excel → migration",
            detail: "start → gates → mapping → hierarchy",
          });
        }
        if (kinds.docRag) {
          appendProcessLog({
            phase: "started",
            tool: "doc_rag_pipeline",
            toolLabel: "Doc RAG pipeline",
            status: "running",
            title: "PDF/Word/TXT/image → Doc RAG",
            detail: "index → verify → query → evidence",
          });
        }
        if (kinds.schema) {
          appendProcessLog({
            phase: "started",
            tool: "schema_pipeline",
            toolLabel: "Schema mapper",
            status: "running",
            title: "YAML/JSON → schema mapping",
            detail: "ingest → pre-semantic → field mapping → hierarchy",
          });
        }
      }
      try {
        const kinds = files?.length ? classifyUploadFiles(files) : null;
        const res = files?.length
          ? await runStatefulWithFiles({
              message,
              session_id: sessionId,
              context,
              organization_id: orgId || undefined,
              files,
              interactive_doc_match: !!kinds?.docRag,
              interactive_migration: !!kinds?.migration,
            })
          : await runStateful({ message, session_id: sessionId, context });
        const batchId = applyResponse(res);
        if (batchId) {
          setActiveBatchId(batchId);
          setBatchProgress(null);
        }
      } finally {
        setUploadingFiles([]);
      }
    },
    [appendProcessLog, applyResponse, orgId, runStateful, runStatefulWithFiles, sessionId],
  );

  const runViaWebSocket = useCallback(
    async (message: string, files?: File[], sendOpts?: SendMessageOptions) => {
      if (files?.length) {
        await runViaRest(message, files, sendOpts);
        return;
      }
      const context = buildOrchestratorContext({
        orgId,
        forcedRoute: sendOpts?.forcedRoute,
        migrationId: sendOpts?.migrationId,
      });
      const url = buildDeepAgentsWebSocketUrl(sessionId);
      if (!url) {
        await runViaRest(message, undefined, sendOpts);
        return;
      }

      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const collected: ToolCallRecord[] = [];
        const live: typeof liveEvents = [];
        let answer = "";
        let settled = false;
        let running = 0;

        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          setRunningToolCount(0);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          if (err) reject(err);
          else resolve();
        };

        ws.onopen = () => {
          ws.send(JSON.stringify({ message, context: context ?? null }));
        };

        ws.onmessage = (ev) => {
          let data: WorkflowStreamEvent;
          try {
            data = JSON.parse(String(ev.data)) as WorkflowStreamEvent;
          } catch {
            return;
          }

          if (data.type === "tool_started") {
            running += 1;
            setRunningToolCount(running);
            const stack = pendingToolStacks.current[data.tool] ?? [];
            stack.push({ input: data.input, domain: data.domain, startedAt: Date.now() });
            pendingToolStacks.current[data.tool] = stack;
            pulseDomain(data.domain);

            const id = nowId(`live_${data.tool}`);
            live.push({ id, label: data.tool, domain: data.domain, status: "running" });
            setLiveEvents([...live]);

            appendProcessLog({
              phase: "started",
              tool: data.tool,
              toolLabel: data.tool,
              status: "running",
              title: `Calling ${data.tool}`,
              detail: DOMAIN_LABELS[data.domain] ?? data.domain,
              input: data.input,
            });
            return;
          }

          if (data.type === "tool_completed") {
            running = Math.max(0, running - 1);
            setRunningToolCount(running);

            const stack = pendingToolStacks.current[data.tool] ?? [];
            const pendingMeta = stack.shift();
            if (stack.length) pendingToolStacks.current[data.tool] = stack;
            else delete pendingToolStacks.current[data.tool];

            const durationMs = pendingMeta ? Date.now() - pendingMeta.startedAt : undefined;
            const input = pendingMeta?.input ?? {};

            const idx = live.findIndex((e) => e.label === data.tool && e.status === "running");
            if (idx >= 0) live[idx] = { ...live[idx], status: "done" };
            else live.push({ id: nowId(`live_${data.tool}`), label: data.tool, domain: data.domain, status: "done" });

            collected.push({ tool: data.tool, input, output: data.output });
            setLiveEvents([...live]);
            setToolCalls([...collected]);
            applyApprovalFromSingleTool(data.tool, data.output);
            if (
              [
                "start_fiix_schema_mapping",
                "start_schema_mapping",
                "continue_schema_mapping_gate",
                "get_schema_mapping_status",
              ].includes(data.tool)
            ) {
              applySchemaContext(
                {
                  session_id: sessionId,
                  answer: "",
                  tool_calls: collected,
                  success: true,
                },
                [
                  "start_fiix_schema_mapping",
                  "fetch_fiix_schema",
                  "configure_fiix_credentials",
                ].includes(data.tool),
              );
            }
            pulseDomain(data.domain);
            logToolCompletion(data.tool, input, data.output, durationMs);
            return;
          }

          if (data.type === "agent_switch") {
            setSwitchTrail((prev) => [
              ...prev.slice(-8),
              {
                id: nowId("sw"),
                at: new Date().toISOString(),
                from: data.from_domain,
                to: data.to_domain,
              },
            ]);
            pulseDomain(data.to_domain);
            appendProcessLog({
              phase: "completed",
              tool: "agent_switch",
              toolLabel: "Handoff",
              status: "success",
              title: "Agent handoff",
              detail: `${DOMAIN_LABELS[data.from_domain] ?? data.from_domain} → ${DOMAIN_LABELS[data.to_domain] ?? data.to_domain}`,
              input: { from_domain: data.from_domain, to_domain: data.to_domain },
            });
            return;
          }

          if (data.type === "gate_interrupt") {
            setInterruptPayload(data.payload);
            setLiveEvents([]);
            setRunningToolCount(0);
            finish();
            return;
          }

          if (data.type === "workflow_completed") {
            answer = data.answer ?? "";
            const finalToolCalls = data.tool_calls?.length ? data.tool_calls : collected;
            if (finalToolCalls.length) {
              setToolCalls(finalToolCalls);
              applyApprovalFromToolCalls(finalToolCalls);
            }
            applySchemaContext(
              {
                session_id: data.session_id ?? sessionId,
                answer,
                tool_calls: finalToolCalls,
                success: true,
                workspace_status: data.workspace_status ?? null,
                ingested_schema_mapping_ids: data.ingested_schema_mapping_ids,
              },
              finalToolCalls.some((tc) =>
                [
                  "start_fiix_schema_mapping",
                  "fetch_fiix_schema",
                  "configure_fiix_credentials",
                  "continue_schema_mapping_gate",
                ].includes(tc.tool),
              ),
            );
            setLiveEvents([]);
            setInterruptPayload(null);
            if (answer.trim()) {
              setTurns((prev) => [
                ...prev,
                { id: nowId("assistant"), role: "assistant", text: answer.trim(), at: new Date().toISOString() },
              ]);
            }
            finish();
            return;
          }

          if (data.type === "error") {
            setTurns((prev) => [
              ...prev,
              { id: nowId("error"), role: "error", text: data.error, at: new Date().toISOString() },
            ]);
            finish(new Error(data.error));
          }
        };

        ws.onerror = () => finish(new Error("WebSocket connection failed"));
        ws.onclose = () => {
          if (!settled) finish();
        };
      }).catch(async () => {
        await runViaRest(message, undefined, sendOpts);
      });
    },
    [
      applyApprovalFromSingleTool,
      applyApprovalFromToolCalls,
      applySchemaContext,
      logToolCompletion,
      orgId,
      pulseDomain,
      runViaRest,
      sessionId,
    ],
  );

  const sendMessage = useCallback(
    async (text: string, files?: File[], sendOpts?: SendMessageOptions) => {
      const trimmed = text.trim();
      if (!trimmed || pending || resuming || interruptPayload) return;
      if (serviceAvailable === false) return;

      const userSignals = classifySignalsFromUserMessage(trimmed);
      const attachmentSignals = classifySignalsFromAttachments(files);
      const forcedRouteSignals = classifySignalsFromForcedRoute(sendOpts?.forcedRoute);
      const intentSpaceSignals = classifySignalsFromIntentSpace(sendOpts?.intentSpace);
      const preClass = classifySessionFromSignals(
        sessionClassification?.spaceWeights,
        userSignals,
        attachmentSignals,
        forcedRouteSignals,
        intentSpaceSignals,
      );
      setSessionClassification(preClass);
      if (preClass.primarySpace !== "general") setSessionSpace(preClass.primarySpace);
      const allPins = [...loadCustomPins(), ...PINNED_RUNS_CATALOG];
      const similarPin = findSemanticallySimilarPin(trimmed, allPins);
      if (similarPin?.domain) pulseDomain(similarPin.domain);
      else if (sendOpts?.forcedRoute?.startsWith("udr")) pulseDomain("udr");
      else pulseDomain("meta");

      setTurns((prev) => [
        ...prev,
        { id: nowId("user"), role: "user", text: trimmed, at: new Date().toISOString() },
      ]);
      setPending(true);
      setLiveEvents([]);

      try {
        if (useStreaming) await runViaWebSocket(trimmed, files, sendOpts);
        else await runViaRest(trimmed, files, sendOpts);
      } catch (err: unknown) {
        setTurns((prev) => [
          ...prev,
          {
            id: nowId("error"),
            role: "error",
            text: getDeepAgentsErrorMessage(err),
            at: new Date().toISOString(),
          },
        ]);
      } finally {
        setPending(false);
      }
    },
    [
      interruptPayload,
      pending,
      pulseDomain,
      resuming,
      runViaRest,
      runViaWebSocket,
      serviceAvailable,
      useStreaming,
    ],
  );

  const submitHitlDecision = useCallback(
    async (decision: Record<string, unknown>) => {
      setPending(true);
      try {
        const res = await resumeWorkflow({ sessionId, body: { decision } });
        applyResponse(res);
      } catch (err: unknown) {
        setTurns((prev) => [
          ...prev,
          {
            id: nowId("error"),
            role: "error",
            text: getDeepAgentsErrorMessage(err),
            at: new Date().toISOString(),
          },
        ]);
      } finally {
        setPending(false);
      }
    },
    [applyResponse, resumeWorkflow, sessionId],
  );

  const resetSession = useCallback(() => {
    setTurns([GREETING]);
    setInterruptPayload(null);
    setToolCalls([]);
    setProcessLog([]);
    setLiveEvents([]);
    setSwitchTrail([]);
    setRunningToolCount(0);
    setApprovalInsight(null);
    setApprovalToolError(null);
    setActiveBatchId(null);
    setBatchProgress(null);
    setDocMatchContext(null);
    setMigrationContext(null);
    setSchemaContext(null);
    saveSchemaContextForSession(sessionId, null);
    lastDocUploadNamesRef.current = [];
    lastMigrationUploadNamesRef.current = [];
    lastSchemaUploadNamesRef.current = [];
    setActiveDomain("meta");
    setLastRouteIntent("");
    setSessionSpace("general");
    setSessionClassification(null);
    setBackendSavedSpace(null);
    setLastArtifactHint(undefined);
    setDomainHeat({ meta: Date.now() });
    processStepRef.current = 0;
    pendingToolStacks.current = {};
    saveTurnsForSession(sessionId, [GREETING]);
  }, [sessionId]);

  const busy = pending || resuming;

  return {
    turns,
    pending,
    busy,
    resuming,
    interruptPayload,
    toolCalls,
    processLog,
    appendProcessLog,
    liveEvents,
    activeDomain,
    lastRouteIntent,
    sessionSpace,
    backendSavedSpace,
    sessionClassification,
    lastArtifactHint,
    lastArtifactDelta,
    domainHeat,
    switchTrail,
    runningToolCount,
    toolsCatalog,
    approvalInsight,
    approvalToolError,
    activeBatchId,
    batchProgress,
    uploadingFiles,
    docMatchContext,
    clearDocMatchContext: () => setDocMatchContext(null),
    migrationContext,
    clearMigrationContext: () => setMigrationContext(null),
    openMigrationFromId: async (migrationId: string, label?: string): Promise<boolean> => {
      const id = migrationId.trim();
      if (!id) return false;
      try {
        await schemaMapperApi.getMigrationStatus(id);
      } catch {
        return false;
      }
      setMigrationContext((prev) => {
        const ids = [...new Set([...(prev?.migrationIds ?? []), id])];
        const names = [...(prev?.fileNames ?? [])];
        while (names.length < ids.length) names.push(ids[names.length]?.slice(0, 8) ?? "run");
        if (label && names.length) names[ids.indexOf(id)] = label;
        return { migrationIds: ids, fileNames: names };
      });
      return true;
    },
    schemaContext,
    clearSchemaContext: () => {
      setSchemaContext(null);
      saveSchemaContextForSession(sessionId, null);
    },
    openSchemaFromId: (schemaMappingId: string, label = "Fiix CMMS") => {
      const id = schemaMappingId.trim();
      if (!id) return;
      setSchemaContext((prev) => {
        const merged = [...new Set([...(prev?.schemaMappingIds ?? []), id])];
        return {
          schemaMappingIds: merged,
          labels: merged.map((_, i) => (i === 0 ? label : prev?.labels[i] ?? merged[i].slice(0, 8))),
        };
      });
    },
    starterPrompts: STARTER_PROMPTS,
    sendMessage,
    submitHitlDecision,
    resetSession,
  };
}
