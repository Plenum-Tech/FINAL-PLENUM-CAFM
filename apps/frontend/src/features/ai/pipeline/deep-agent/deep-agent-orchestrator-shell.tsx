"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Bot, Loader2, Paperclip, Send, Sparkles, X } from "lucide-react";

import { Button, toast } from "@/components/ui";
import { useDeepAgentsHealth } from "@/features/ai/deep-agents-api";
import { listOrganizations } from "@/features/organizations/plenum-api";
import { useOrganizationStore } from "@/store/organizationStore";
import { cn } from "@/utils/cn";

import { DeepAgentPinnedRunsBar } from "./deep-agent-pinned-runs-bar";
import {
  loadCustomPins,
  selectVisiblePins,
  type PinnedRun,
} from "./deep-agent-pinned-runs";
import {
  DeepAgentTaskBucketsPanel,
  type ActiveTaskItem,
  type CompletedTaskItem,
  type DeepAgentTaskBuckets,
} from "./deep-agent-task-buckets";
import {
  loadWorkflowQueue,
  persistWorkflowQueue,
  registerUploads,
  removeUpload,
  updateWorkflowStatus,
  upsertWorkflowRun,
  type WorkflowQueueRun,
  type WorkflowQueueState,
  type WorkflowQueueUpload,
} from "./deep-agent-workflow-queue";
import { DeepAgentQueueChatCard } from "./deep-agent-queue-chat-card";
import { computeMigrationProgress } from "./deep-agent-migration-progress";
import { DeepAgentTaskBucketStrip } from "./deep-agent-task-strip";
import {
  buildActivityLogEvents,
  pickInlineActivityEvent,
  type ActivityInlineAction,
  type ActivityLogEvent,
} from "./deep-agent-activity-events";
import {
  loadActivityEvents,
  mergeActivityEvents,
  persistActivityEvents,
} from "./deep-agent-activity-store";
import {
  DeepAgentInlineActivityCard,
  DeepAgentStructuredActivityLog,
} from "./deep-agent-structured-activity-log";
import { DeepAgentSavedSpacesPanel } from "./deep-agent-saved-spaces-panel";
import { useCustomSpaces } from "./deep-agent-custom-spaces";
import { DeepAgentServiceStatus } from "./deep-agent-service-status";
import { SingleDoorIngestProgress, classifyUploadFiles } from "./single-door-ingest-progress";
import { DeepAgentIntentChips, DeepAgentNextTrackChip } from "./deep-agent-intent-chips";
import { INTENT_BY_KIND, splitFilesByTrack, type IntentKind } from "./intent-menu";
import { useIntentClarification } from "./use-intent-clarification";
import type { UdrForcedRoute } from "./udr-route-context";
import { DeepAgentDocMatchPanel } from "./deep-agent-doc-match-panel";
import { DeepAgentDocumentsPanel } from "./deep-agent-documents-panel";
import { DeepAgentMigrationPanel } from "./deep-agent-migration-panel";
import {
  MigrationCompletionCard,
  type CompletedMigrationSnapshot,
} from "./deep-agent-migration-completion-card";
import {
  DocumentsCompletionCard,
  type CompletedDocumentsSnapshot,
} from "./deep-agent-documents-completion-card";
import {
  SchemaCompletionCard,
  type CompletedSchemaSnapshot,
} from "./deep-agent-schema-completion-card";
import {
  WorkOrderCompletionCard,
  type CompletedWorkOrderSnapshot,
} from "./deep-agent-work-order-completion-card";
// ActiveMigrationCard / ActiveDocumentsCard / ActiveSchemaCard removed from
// the chat sticky strip — DeepAgentQueueChatCard now carries the same data
// (status + gate label + step + progress bar) inside the chat stream itself.
import { DeepAgentProcessLogPanel } from "./deep-agent-process-log";
import { DeepAgentSchemaPanel } from "./deep-agent-schema-panel";
import { DeepAgentUdrPanel, syncUdrScriptFromContext, type UdrRunPinOptions } from "./deep-agent-udr-panel";
import { DeepAgentWorkOrdersPanel } from "./deep-agent-work-orders-panel";
import { useMigrationStatus, useSchemaMappingStatus } from "@/features/ai/chat-api";
import { useDocList } from "@/features/ai/doc-rag-api";
import { isSchemaEffectivelyComplete } from "@/features/ai/pipeline/schema/schema-gate-state";
import {
  ensureSessionInList,
  loadDeepAgentSessions,
  persistDeepAgentSessions,
  sessionTitleFromTurns,
  upsertDeepAgentSession,
  type DeepAgentSessionMeta,
} from "./deep-agent-sessions";
import {
  classificationWithBackendAnchor,
  classifySessionFromSignals,
  classifySignalsFromUserMessage,
  effectiveSpace,
  mergeSessionClassification,
  setSessionSpaceOverride,
  type SavedSpaceId,
} from "./deep-agent-spaces";
import {
  createDeepAgentSessionId,
  loadStoredDeepAgentSessionId,
  persistDeepAgentSessionId,
  useDeepAgentOrchestrator,
} from "./use-deep-agent-orchestrator";
import {
  OrchestratorFlowEmptyState,
  OrchestratorHero,
  OrchestratorHitlBanner,
  OrchestratorMessageBubble,
  OrchestratorOrgBanner,
  type CenterTabId,
} from "./orchestrator-shell-ui";

const LEFT_RAIL_W_KEY = "plenum_orch_left_rail_w";
const RIGHT_RAIL_W_KEY = "plenum_orch_right_rail_w";
const CENTER_TAB_KEY = "plenum_orch_center_tab";

const VALID_CENTER_TABS: readonly CenterTabId[] = [
  "chat",
  "tasks",
  "activity",
  "schema",
  "udr",
  "work_orders",
  "documents",
  "migration",
] as const;

function loadCenterTabForSession(sessionId: string): CenterTabId | null {
  if (typeof window === "undefined" || !sessionId) return null;
  try {
    const raw = window.localStorage.getItem(`${CENTER_TAB_KEY}:${sessionId}`);
    if (!raw) return null;
    return (VALID_CENTER_TABS as readonly string[]).includes(raw) ? (raw as CenterTabId) : null;
  } catch {
    return null;
  }
}

function saveCenterTabForSession(sessionId: string, tab: CenterTabId) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    window.localStorage.setItem(`${CENTER_TAB_KEY}:${sessionId}`, tab);
  } catch {
    /* ignore quota / SSR */
  }
}

function initialCenterTab(sessionId: string, initialSpace?: SavedSpaceId): CenterTabId {
  // Explicit URL/route preference wins (user clicked a workspace link).
  if (initialSpace === "migration") return "migration";
  if (initialSpace === "documents") return "documents";
  if (initialSpace === "schema") return "schema";
  if (initialSpace === "work_orders") return "work_orders";
  if (initialSpace === "udr") return "udr";
  const persisted = loadCenterTabForSession(sessionId);
  return persisted ?? "chat";
}

// Single-door spec: the orchestrator NEVER auto-opens an application. When a
// migration / document batch / schema mapping starts, the chat surfaces an
// ActiveMigrationCard / ActiveDocumentsCard / ActiveSchemaCard with an explicit
// "Open workflow" button. The user clicking that button is the only way the
// center tab leaves "chat" for a workflow panel.

const LEFT_RAIL_DEFAULT = 220;
const RIGHT_RAIL_DEFAULT = 264;
const LEFT_RAIL_MIN = 180;
const LEFT_RAIL_MAX = 360;
const RIGHT_RAIL_MIN = 220;
const RIGHT_RAIL_MAX = 400;

function loadStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(max, Math.max(min, n));
  } catch {
    return fallback;
  }
}

function ResizeHandle({
  width,
  setWidth,
  min,
  max,
  invert = false,
  ariaLabel,
}: {
  width: number;
  setWidth: (w: number) => void;
  min: number;
  max: number;
  invert?: boolean;
  ariaLabel: string;
}) {
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const delta = invert ? -dx : dx;
      const next = Math.min(max, Math.max(min, dragRef.current.startW + delta));
      setWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, invert, max, min, setWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={-1}
      onMouseDown={(e) => {
        dragRef.current = { startX: e.clientX, startW: width };
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="hidden md:flex shrink-0 w-1.5 -mx-0.5 cursor-col-resize items-stretch justify-center group select-none"
    >
      <span
        aria-hidden
        className={cn(
          "w-px transition-colors",
          dragging || hovering ? "bg-indigo-400" : "bg-slate-200",
        )}
      />
    </div>
  );
}

// Routing/meta states the orchestrator uses internally — never user-facing.
const INTERNAL_DOMAINS = new Set([
  "meta",
  "router",
  "routing",
  "general",
  "orchestrator",
  "supervisor",
  "unknown",
]);

function TypingIndicator({ domain }: { domain: string }) {
  // "meta"/"router"/"general"/etc. are internal routing states — don't surface them
  // as "Routing via meta…"; show a neutral "Thinking…" instead. Real domains still show.
  // Trim + set-membership so variants ("meta ", "Meta", "orchestrator") never leak.
  const d = (domain || "").trim().toLowerCase();
  const isInternal = !d || INTERNAL_DOMAINS.has(d);
  const label = isInternal ? "Thinking" : `Routing via ${domain.replace(/_/g, " ")}`;
  return (
    <div
      className="flex gap-3.5 items-center animate-in fade-in slide-in-from-bottom-1 duration-300"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div
        aria-hidden
        className="shrink-0 h-7 w-7 rounded-full bg-indigo-50 flex items-center justify-center"
      >
        <Bot size={14} className="text-indigo-600" />
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <div aria-hidden className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400 [animation-delay:0ms] animate-bounce" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400 [animation-delay:150ms] animate-bounce" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400 [animation-delay:300ms] animate-bounce" />
        </div>
        <span className="tracking-tight">
          {isInternal ? (
            "Thinking…"
          ) : (
            <>
              Routing via <span className="text-slate-700 capitalize">{domain.replace(/_/g, " ")}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

export function DeepAgentOrchestratorShell({
  embedded = false,
  initialSpace,
}: {
  embedded?: boolean;
  initialSpace?: SavedSpaceId;
}) {
  const orgId = useOrganizationStore((s) => s.selected?.id ?? "");
  const orgName = useOrganizationStore((s) => s.selected?.name ?? "");
  const setSelectedOrg = useOrganizationStore((s) => s.setSelected);
  const [sessionId, setSessionId] = useState(loadStoredDeepAgentSessionId);
  const [sessions, setSessions] = useState<DeepAgentSessionMeta[] | null>(null);
  const [leftRailWidth, setLeftRailWidth] = useState(() =>
    loadStoredWidth(LEFT_RAIL_W_KEY, LEFT_RAIL_DEFAULT, LEFT_RAIL_MIN, LEFT_RAIL_MAX),
  );
  const [rightRailWidth, setRightRailWidth] = useState(() =>
    loadStoredWidth(RIGHT_RAIL_W_KEY, RIGHT_RAIL_DEFAULT, RIGHT_RAIL_MIN, RIGHT_RAIL_MAX),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(LEFT_RAIL_W_KEY, String(leftRailWidth));
    } catch {
      /* ignore */
    }
  }, [leftRailWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RIGHT_RAIL_W_KEY, String(rightRailWidth));
    } catch {
      /* ignore */
    }
  }, [rightRailWidth]);
  const [activeSpace, setActiveSpace] = useState<SavedSpaceId>(initialSpace ?? "general");
  const [composer, setComposer] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const intent = useIntentClarification(sessionId);
  const { customSpaces, createCustomSpace, deleteCustomSpace } = useCustomSpaces(orgId);
  // centerTab is persisted per session so a refresh lands on the workflow the
  // user was actually viewing. Without this, refresh during a migration would
  // race the schema auto-switch (schemaContext can be seeded from stored turns
  // before migrationContext loads from the API) and land on Schema Mapping
  // with infinite "Loading schema mapping status…".
  const [centerTab, setCenterTab] = useState<CenterTabId>(() =>
    initialCenterTab(sessionId, initialSpace),
  );

  useEffect(() => {
    saveCenterTabForSession(sessionId, centerTab);
  }, [sessionId, centerTab]);

  // When the user opens a different chat from Saved Spaces (sessionId change),
  // restore that session's last-active centerTab.
  const lastSessionForCenterTab = useRef(sessionId);
  useEffect(() => {
    if (lastSessionForCenterTab.current === sessionId) return;
    lastSessionForCenterTab.current = sessionId;
    setCenterTab(initialCenterTab(sessionId, initialSpace));
  }, [sessionId, initialSpace]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activityRailRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastMergedArtifactDeltaKey = useRef("");
  const lastUserMessageRef = useRef("");
  // Per-workflow-id refs that record which terminal completions we've already
  // auto-returned for. Refs so they don't trigger re-renders and the user can
  // navigate manually back into a panel after completion without being kicked
  // out again on the next poll.
  const autoReturnedMigrationsRef = useRef<Set<string>>(new Set());
  const autoReturnedDocBatchesRef = useRef<Set<string>>(new Set());
  const autoReturnedSchemaRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (orgId) return;
    let cancelled = false;
    void listOrganizations({ limit: 1 })
      .then((page) => {
        if (cancelled) return;
        const first = page.data[0];
        if (first) setSelectedOrg({ id: first.id, name: first.name });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId, setSelectedOrg]);

  useEffect(() => {
    if (!initialSpace || initialSpace === "general") return;
    setActiveSpace(initialSpace);
    if (initialSpace === "udr") setCenterTab("udr");
    else if (initialSpace === "work_orders") setCenterTab("work_orders");
    else if (initialSpace === "schema") setCenterTab("schema");
    else if (initialSpace === "documents") setCenterTab("documents");
    else if (initialSpace === "migration") setCenterTab("migration");
  }, [initialSpace]);

  const {
    data: health,
    isLoading: healthLoading,
    isError: healthError,
  } = useDeepAgentsHealth({ enabled: true });

  const serviceAvailable = healthLoading ? null : !healthError && !!health;

  const orch = useDeepAgentOrchestrator({
    sessionId,
    orgId,
    serviceAvailable,
  });

  useEffect(() => {
    const loaded = loadDeepAgentSessions();
    const withCurrent = ensureSessionInList(loaded, sessionId, activeSpace);
    setSessions(withCurrent);
    persistDeepAgentSessions(withCurrent);
  }, [sessionId]);

  useEffect(() => {
    persistDeepAgentSessionId(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessions) return;
    const title = sessionTitleFromTurns(orch.turns);
    const existing = sessions.find((s) => s.id === sessionId);
    const lastUser = [...orch.turns].reverse().find((t) => t.role === "user");
    const signalBatches = [];
    if (orch.sessionClassification) {
      signalBatches.push(orch.sessionClassification.spaceWeights ?? {});
    } else if (existing?.spaceWeights) {
      signalBatches.push(existing.spaceWeights);
    }
    if (lastUser?.text) signalBatches.push(classifySignalsFromUserMessage(lastUser.text));
    const frontendClassification =
      orch.sessionClassification ??
      classifySessionFromSignals(existing?.spaceWeights, ...signalBatches);

    // Backend workspace anchor is a soft heuristic; it can upgrade general → specific
    // but should not overwrite a confident specific frontend classification (intent
    // chip + file type signals). Hard anchors driven by confirmed artefacts
    // (migration_id / document_id) are already baked into orch.sessionClassification
    // upstream in applyResponse, so this guard only affects the soft inference path.
    const frontPrimary = frontendClassification.primarySpace;
    const frontConfident = frontPrimary !== "general" && (frontendClassification.confidence ?? 0) >= 0.5;
    const backendCanAnchor =
      !!orch.backendSavedSpace &&
      !existing?.userOverrideSpace &&
      !(orch.backendSavedSpace === "general" && frontPrimary !== "general") &&
      !(orch.backendSavedSpace !== frontPrimary && frontConfident);
    const classification = backendCanAnchor
      ? classificationWithBackendAnchor(orch.backendSavedSpace!, frontendClassification)
      : frontendClassification;

    const hint = orch.lastArtifactHint ?? existing?.artifactHint;

    const deltaKey = JSON.stringify(orch.lastArtifactDelta);
    const artifactDelta =
      deltaKey !== "{}" && deltaKey !== lastMergedArtifactDeltaKey.current
        ? orch.lastArtifactDelta
        : undefined;
    if (artifactDelta) lastMergedArtifactDeltaKey.current = deltaKey;

    const meta = mergeSessionClassification(
      {
        ...existing,
        id: sessionId,
        title,
        updatedAt: Date.now(),
        lastDomain: orch.activeDomain,
        lastRouteIntent: orch.lastRouteIntent,
        documentIds: orch.docMatchContext?.documentIds.length
          ? orch.docMatchContext.documentIds
          : existing?.documentIds,
        migrationIds: orch.migrationContext?.migrationIds.length
          ? orch.migrationContext.migrationIds
          : existing?.migrationIds,
      },
      classification,
      {
        ...(hint ? { artifactHint: hint } : {}),
        artifactDelta,
      },
    );
    const updated = upsertDeepAgentSession(sessions, meta);
    setSessions(updated);
    persistDeepAgentSessions(updated);
    // Pick the LHS nav target — prefer the strongest signal in priority order:
    // user override > confident frontend > backend (only when specific) > frontend.
    // Confident frontend wins over backend so a chip+attachment classification doesn't
    // get visually moved to the backend-inferred space.
    const backendNav =
      orch.backendSavedSpace && orch.backendSavedSpace !== "general"
        ? orch.backendSavedSpace
        : null;
    const confidentFrontNav = frontConfident ? frontPrimary : null;
    const navSpace =
      existing?.userOverrideSpace ??
      confidentFrontNav ??
      backendNav ??
      classification.primarySpace;
    if (!existing?.userOverrideSpace && navSpace !== "general") {
      setActiveSpace(navSpace);
    }
  }, [
    orch.turns,
    orch.sessionClassification,
    orch.backendSavedSpace,
    orch.lastRouteIntent,
    orch.lastArtifactHint,
    orch.lastArtifactDelta,
    orch.activeDomain,
    orch.docMatchContext?.documentIds.join(","),
    orch.migrationContext?.migrationIds.join(","),
    sessionId,
  ]);

  useEffect(() => {
    lastMergedArtifactDeltaKey.current = "";
  }, [sessionId]);

  useEffect(() => {
    if (!sessions) return;
    const current = sessions.find((s) => s.id === sessionId);
    if (current) setActiveSpace(effectiveSpace(current));
  }, [sessionId, sessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [orch.turns, orch.pending, orch.interruptPayload, orch.approvalInsight, orch.approvalToolError]);

  // When the user navigates back to the chat tab from any workflow panel,
  // the chat tree remounts and the message-list scroll resets to the top.
  // Scroll the chat's own scroll container (the `role="log"` div) directly
  // — using `scrollIntoView` here would walk every scrollable ancestor and
  // also shift the outer AppShell <main>, which the user reads as the
  // page scrolling instead of the tab switching.
  //
  // Two rAFs lets the message tree paint and the centered max-w-3xl column
  // settle its final height before measuring scrollHeight.
  useEffect(() => {
    if (centerTab !== "chat") return;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const log =
          (bottomRef.current?.closest('[role="log"]') as HTMLElement | null) ?? null;
        if (!log) return;
        // Bypass the `scroll-smooth` CSS so the position snaps instantly on
        // a tab switch — smooth animation would look like the chat is
        // scrolling away from the user as they land on it.
        const prevBehavior = log.style.scrollBehavior;
        log.style.scrollBehavior = "auto";
        log.scrollTop = log.scrollHeight;
        // Restore the next frame so live-message smooth-scroll still works.
        window.requestAnimationFrame(() => {
          log.style.scrollBehavior = prevBehavior;
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [centerTab]);

  const hasSchemaPipeline = (orch.schemaContext?.schemaMappingIds.length ?? 0) > 0;

  const primaryUdrMigrationId = orch.migrationContext?.migrationIds[0] ?? "";
  const { data: udrMigrationStatus } = useMigrationStatus(primaryUdrMigrationId, {
    enabled: Boolean(primaryUdrMigrationId),
  });

  // Completion cards are durable timeline events: once a migration reaches a
  // terminal status the shell snapshots it into per-session localStorage
  // (keyed by sessionId), then renders one card per snapshot in the chat
  // stream. Cards never auto-dismiss; users can revisit the migration any
  // time via View History / Open Details and the card stays. localStorage
  // (not sessionStorage) so cards survive tab close, browser restart, and
  // re-login — the spec requires session restoration to show the cards.
  const COMPLETED_MIGRATIONS_KEY = `plenum-orch-completed-migrations:${sessionId}`;

  const loadCompletedMigrations = useCallback((): CompletedMigrationSnapshot[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(COMPLETED_MIGRATIONS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is CompletedMigrationSnapshot =>
          !!s && typeof s === "object" && typeof (s as { migration_id?: unknown }).migration_id === "string",
      );
    } catch {
      return [];
    }
  }, [COMPLETED_MIGRATIONS_KEY]);

  const [completedMigrations, setCompletedMigrations] = useState<CompletedMigrationSnapshot[]>(
    loadCompletedMigrations,
  );

  // Rehydrate when sessionId changes (saved-space switch).
  useEffect(() => {
    setCompletedMigrations(loadCompletedMigrations());
  }, [loadCompletedMigrations]);

  const persistCompletedMigrations = useCallback(
    (snapshots: CompletedMigrationSnapshot[]) => {
      try {
        if (snapshots.length === 0) {
          window.localStorage.removeItem(COMPLETED_MIGRATIONS_KEY);
        } else {
          window.localStorage.setItem(COMPLETED_MIGRATIONS_KEY, JSON.stringify(snapshots));
        }
      } catch {
        /* ignore quota / private mode */
      }
    },
    [COMPLETED_MIGRATIONS_KEY],
  );

  const migrationCompletionStatus = (udrMigrationStatus?.status ?? "").toLowerCase();
  const migrationIsTerminal =
    migrationCompletionStatus === "complete" ||
    migrationCompletionStatus === "failed" ||
    migrationCompletionStatus === "ddl_failed" ||
    migrationCompletionStatus === "cancelled";

  // When the polled migration hits a terminal state, snapshot it into the log
  // exactly once. The card stays forever; rerunning the migration creates a
  // new snapshot only if the migration_id is genuinely new.
  useEffect(() => {
    if (!migrationIsTerminal || !udrMigrationStatus || !primaryUdrMigrationId) return;
    setCompletedMigrations((prev) => {
      if (prev.some((s) => s.migration_id === primaryUdrMigrationId)) return prev;
      const snapshot: CompletedMigrationSnapshot = {
        migration_id: primaryUdrMigrationId,
        status: udrMigrationStatus.status,
        cmms_name: udrMigrationStatus.cmms_name,
        t1_mapped_count: udrMigrationStatus.t1_mapped_count,
        t2_auto_count: udrMigrationStatus.t2_auto_count,
        t2_human_count: udrMigrationStatus.t2_human_count,
        unmapped_count: udrMigrationStatus.unmapped_count,
        total_fields: udrMigrationStatus.total_fields,
        progress_pct: udrMigrationStatus.progress_pct,
        pending_gate_type:
          typeof udrMigrationStatus.pending_gate_type === "string"
            ? udrMigrationStatus.pending_gate_type
            : null,
        error_message: udrMigrationStatus.error_message,
        started_at: udrMigrationStatus.started_at,
        completed_at: udrMigrationStatus.completed_at,
        output_json_url: udrMigrationStatus.output_json_url,
        output_csv_url: udrMigrationStatus.output_csv_url,
        output_sql_url: udrMigrationStatus.output_sql_url,
        fileNames: orch.migrationContext?.fileNames ?? [],
        capturedAt: udrMigrationStatus.completed_at
          ? new Date(udrMigrationStatus.completed_at).getTime() || Date.now()
          : Date.now(),
      };
      const next = [...prev, snapshot];
      persistCompletedMigrations(next);
      return next;
    });
  }, [
    migrationIsTerminal,
    primaryUdrMigrationId,
    udrMigrationStatus,
    orch.migrationContext?.fileNames,
    persistCompletedMigrations,
  ]);

  // Auto-return to chat when a migration the user is actively viewing
  // completes. Once-per-id via a ref so manual navigation back to the panel
  // after the auto-return stays put (no loop).
  useEffect(() => {
    if (!migrationIsTerminal || !primaryUdrMigrationId) return;
    if (autoReturnedMigrationsRef.current.has(primaryUdrMigrationId)) return;
    autoReturnedMigrationsRef.current.add(primaryUdrMigrationId);
    if (centerTab === "migration") {
      setCenterTab("chat");
    }
  }, [migrationIsTerminal, primaryUdrMigrationId, centerTab]);

  // Show the active-migration banner whenever a migration is in flight — the
  // user can leave the migration tab via "Back to chat" and the chat must keep
  // a one-click path back. Banner flips off automatically when status reaches
  // a terminal state (the completion log takes over in the message stream).
  const showActiveMigrationCard =
    !!udrMigrationStatus &&
    !!primaryUdrMigrationId &&
    !migrationIsTerminal &&
    !!migrationCompletionStatus;

  // ── Documents completion log ───────────────────────────────────────────────
  // Same pattern as completedMigrations: snapshot once when all tracked
  // documents in the active batch reach indexed/error, render durable cards.
  const COMPLETED_DOCS_KEY = `plenum-orch-completed-documents:${sessionId}`;

  const loadCompletedDocs = useCallback((): CompletedDocumentsSnapshot[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(COMPLETED_DOCS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is CompletedDocumentsSnapshot =>
          !!s &&
          typeof s === "object" &&
          Array.isArray((s as { documentIds?: unknown }).documentIds),
      );
    } catch {
      return [];
    }
  }, [COMPLETED_DOCS_KEY]);

  const [completedDocBatches, setCompletedDocBatches] = useState<CompletedDocumentsSnapshot[]>(
    loadCompletedDocs,
  );

  useEffect(() => {
    setCompletedDocBatches(loadCompletedDocs());
  }, [loadCompletedDocs]);

  const persistCompletedDocs = useCallback(
    (snapshots: CompletedDocumentsSnapshot[]) => {
      try {
        if (snapshots.length === 0) {
          window.localStorage.removeItem(COMPLETED_DOCS_KEY);
        } else {
          window.localStorage.setItem(COMPLETED_DOCS_KEY, JSON.stringify(snapshots));
        }
      } catch {
        /* ignore */
      }
    },
    [COMPLETED_DOCS_KEY],
  );

  const docMatchDocIds = orch.docMatchContext?.documentIds ?? [];
  const docMatchKey = docMatchDocIds.join(",");
  const docMatchFileNames = orch.docMatchContext?.fileNames ?? [];
  const { data: liveDocs = [] } = useDocList({
    refetchInterval: docMatchDocIds.length > 0 ? 2000 : false,
    enabled: docMatchDocIds.length > 0,
  });

  useEffect(() => {
    if (docMatchDocIds.length === 0) return;
    const tracked = new Set(docMatchDocIds);
    const ours = liveDocs.filter((d) => tracked.has(d.id));
    if (ours.length === 0) return;
    const allDone = ours.every(
      (d) => d.status === "indexed" || d.status === "error",
    );
    if (!allDone) return;
    // Snapshot key — set of document ids — ensures the same batch isn't
    // logged twice.
    const batchKey = [...tracked].sort().join("|");
    setCompletedDocBatches((prev) => {
      if (prev.some((s) => [...s.documentIds].sort().join("|") === batchKey)) return prev;
      const indexedCount = ours.filter((d) => d.status === "indexed").length;
      const errorCount = ours.filter((d) => d.status === "error").length;
      const totalPages = ours.reduce((sum, d) => sum + (d.num_pages ?? 0), 0);
      const totalChunks = ours.reduce((sum, d) => sum + (d.num_chunks ?? 0), 0);
      const snapshot: CompletedDocumentsSnapshot = {
        documentIds: docMatchDocIds,
        fileNames: docMatchFileNames.length ? docMatchFileNames : ours.map((d) => d.file_name),
        totalDocs: ours.length,
        indexedCount,
        errorCount,
        totalPages,
        totalChunks,
        capturedAt: Date.now(),
      };
      const next = [...prev, snapshot];
      persistCompletedDocs(next);
      return next;
    });
    // We depend on docMatchKey rather than the array so React sees a stable
    // primitive when the array reference flips but contents are identical.
  }, [docMatchKey, liveDocs, persistCompletedDocs, docMatchFileNames.join(",")]);

  // Auto-return to chat when an in-flight document batch finishes while the
  // user is viewing the Documents panel.
  useEffect(() => {
    if (docMatchDocIds.length === 0) return;
    const tracked = new Set(docMatchDocIds);
    const ours = liveDocs.filter((d) => tracked.has(d.id));
    if (ours.length === 0) return;
    const allDone = ours.every((d) => d.status === "indexed" || d.status === "error");
    if (!allDone) return;
    const batchKey = [...tracked].sort().join("|");
    if (autoReturnedDocBatchesRef.current.has(batchKey)) return;
    autoReturnedDocBatchesRef.current.add(batchKey);
    if (centerTab === "documents") {
      setCenterTab("chat");
    }
  }, [docMatchDocIds, liveDocs, centerTab]);

  // ── Schema mapping completion log ──────────────────────────────────────────
  const COMPLETED_SCHEMA_KEY = `plenum-orch-completed-schema:${sessionId}`;

  const loadCompletedSchema = useCallback((): CompletedSchemaSnapshot[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(COMPLETED_SCHEMA_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is CompletedSchemaSnapshot =>
          !!s &&
          typeof s === "object" &&
          typeof (s as { schemaMappingId?: unknown }).schemaMappingId === "string",
      );
    } catch {
      return [];
    }
  }, [COMPLETED_SCHEMA_KEY]);

  const [completedSchema, setCompletedSchema] = useState<CompletedSchemaSnapshot[]>(
    loadCompletedSchema,
  );

  useEffect(() => {
    setCompletedSchema(loadCompletedSchema());
  }, [loadCompletedSchema]);

  const persistCompletedSchema = useCallback(
    (snapshots: CompletedSchemaSnapshot[]) => {
      try {
        if (snapshots.length === 0) {
          window.localStorage.removeItem(COMPLETED_SCHEMA_KEY);
        } else {
          window.localStorage.setItem(COMPLETED_SCHEMA_KEY, JSON.stringify(snapshots));
        }
      } catch {
        /* ignore */
      }
    },
    [COMPLETED_SCHEMA_KEY],
  );

  // A schema workflow is "real" only when the backend is genuinely running a
  // schema-mapping flow. The backend reuses ``active_schema_mapping_id`` for
  // migration / doc indexing too, so without this guard an XLSX upload spawns
  // a phantom Schema task whose status poll loads forever. "Fiix CMMS" is the
  // orchestrator's marker for real schema flows; see applySchemaContext.
  const isRealSchemaFlow = useMemo(() => {
    const labels = orch.schemaContext?.labels ?? [];
    return labels.some((l) => l === "Fiix CMMS");
  }, [orch.schemaContext?.labels]);

  const primarySchemaId = isRealSchemaFlow
    ? (orch.schemaContext?.schemaMappingIds?.[0] ?? "")
    : "";
  const primarySchemaLabel = orch.schemaContext?.labels?.[0];
  const { data: liveSchemaSession } = useSchemaMappingStatus(primarySchemaId, {
    enabled: !!primarySchemaId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!primarySchemaId || !liveSchemaSession) return;
    const status = String(liveSchemaSession.status ?? "").toLowerCase();
    const terminal =
      status === "complete" ||
      status === "failed" ||
      status === "ddl_failed" ||
      status === "cancelled" ||
      isSchemaEffectivelyComplete(liveSchemaSession);
    if (!terminal) return;
    setCompletedSchema((prev) => {
      if (prev.some((s) => s.schemaMappingId === primarySchemaId)) return prev;
      const stats =
        (liveSchemaSession.stats as Record<string, unknown> | undefined | null) ?? {};
      const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);
      const lastNodeWithSchema = (liveSchemaSession.nodes ?? [])
        .slice()
        .reverse()
        .find((n) => {
          const out = n.output as Record<string, unknown> | null | undefined;
          return out && typeof out === "object" && typeof out.new_schema_name === "string";
        });
      const newSchemaName =
        (lastNodeWithSchema?.output as { new_schema_name?: string } | undefined)?.new_schema_name ?? null;
      const snapshot: CompletedSchemaSnapshot = {
        schemaMappingId: primarySchemaId,
        label: primarySchemaLabel,
        status: liveSchemaSession.status,
        external_cmms_name: liveSchemaSession.external_cmms_name,
        newSchemaName,
        tier1Mapped: numOrNull(stats.tier1_mapped),
        tier2AutoMapped: numOrNull(stats.tier2_auto_mapped),
        tier2Flagged: numOrNull(stats.tier2_flagged),
        unmapped: numOrNull(stats.unmapped),
        totalFields: numOrNull(stats.total_fields),
        coveragePct: numOrNull(stats.mapping_coverage_pct),
        outputJsonUrl: liveSchemaSession.output_json_url,
        outputCsvUrl: liveSchemaSession.output_csv_url,
        outputSqlUrl: liveSchemaSession.output_sql_url,
        errorMessage: liveSchemaSession.error_message,
        capturedAt: Date.now(),
      };
      const next = [...prev, snapshot];
      persistCompletedSchema(next);
      return next;
    });
  }, [primarySchemaId, liveSchemaSession, primarySchemaLabel, persistCompletedSchema]);

  // Auto-return to chat when a schema mapping finishes while the user is
  // viewing the Schema panel.
  useEffect(() => {
    if (!primarySchemaId || !liveSchemaSession) return;
    const status = String(liveSchemaSession.status ?? "").toLowerCase();
    const terminal =
      status === "complete" ||
      status === "failed" ||
      status === "ddl_failed" ||
      status === "cancelled" ||
      isSchemaEffectivelyComplete(liveSchemaSession);
    if (!terminal) return;
    if (autoReturnedSchemaRef.current.has(primarySchemaId)) return;
    autoReturnedSchemaRef.current.add(primarySchemaId);
    if (centerTab === "schema") {
      setCenterTab("chat");
    }
  }, [primarySchemaId, liveSchemaSession, centerTab]);

  // ── Work Order completion log ──────────────────────────────────────────────
  // Work order creation is a single tool call rather than a polled workflow:
  // create_work_order / create_intelligent_work_order. We watch orch.toolCalls
  // and snapshot each successful WO creation as a permanent timeline event.
  const COMPLETED_WO_KEY = `plenum-orch-completed-work-orders:${sessionId}`;
  const loadCompletedWO = useCallback((): CompletedWorkOrderSnapshot[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(COMPLETED_WO_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is CompletedWorkOrderSnapshot =>
          !!s &&
          typeof s === "object" &&
          typeof (s as { workOrderId?: unknown }).workOrderId === "string",
      );
    } catch {
      return [];
    }
  }, [COMPLETED_WO_KEY]);
  const [completedWorkOrders, setCompletedWorkOrders] = useState<CompletedWorkOrderSnapshot[]>(
    loadCompletedWO,
  );
  useEffect(() => {
    setCompletedWorkOrders(loadCompletedWO());
  }, [loadCompletedWO]);
  const persistCompletedWO = useCallback(
    (snapshots: CompletedWorkOrderSnapshot[]) => {
      try {
        if (snapshots.length === 0) {
          window.localStorage.removeItem(COMPLETED_WO_KEY);
        } else {
          window.localStorage.setItem(COMPLETED_WO_KEY, JSON.stringify(snapshots));
        }
      } catch {
        /* ignore */
      }
    },
    [COMPLETED_WO_KEY],
  );

  useEffect(() => {
    if (!orch.toolCalls?.length) return;
    const isRecord = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === "object" && !Array.isArray(v);
    const readStr = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const newSnapshots: CompletedWorkOrderSnapshot[] = [];
    for (const tc of orch.toolCalls) {
      if (tc.tool !== "create_work_order" && tc.tool !== "create_intelligent_work_order") {
        continue;
      }
      const out = isRecord(tc.output) ? tc.output : null;
      const inp = isRecord(tc.input) ? tc.input : {};
      const wid = out ? readStr(out.work_order_id) : null;
      // Error case — failed tool call: still log it as a "failed" event so
      // the user can see what went wrong, but only if we have an identifier.
      const isError =
        !out ||
        (out.error != null && String(out.error).trim().length > 0) ||
        out.success === false ||
        (typeof out.status === "string" &&
          (out.status === "failed" || out.status === "error"));
      const id =
        wid ??
        readStr(inp.work_order_id) ??
        readStr(inp.id) ??
        null;
      if (!id) continue;
      newSnapshots.push({
        workOrderId: id,
        title:
          readStr(inp.title) ??
          readStr(inp.summary) ??
          readStr(inp.description) ??
          (out ? readStr(out.title) : null),
        priority: readStr(inp.priority) ?? (out ? readStr(out.priority) : null),
        assetName:
          readStr(inp.asset_name) ??
          readStr(inp.asset) ??
          (out ? readStr(out.asset_name) : null),
        locationName:
          readStr(inp.location_name) ??
          readStr(inp.location) ??
          (out ? readStr(out.location_name) : null),
        status: out ? readStr(out.status) : null,
        capturedAt: Date.now(),
        isError,
        errorMessage: out ? readStr(out.error) ?? readStr(out.message) : null,
      });
    }
    if (!newSnapshots.length) return;
    setCompletedWorkOrders((prev) => {
      const known = new Set(prev.map((s) => s.workOrderId));
      const merged = [...prev];
      let changed = false;
      for (const snap of newSnapshots) {
        if (known.has(snap.workOrderId)) continue;
        known.add(snap.workOrderId);
        merged.push(snap);
        changed = true;
      }
      if (!changed) return prev;
      persistCompletedWO(merged);
      return merged;
    });
  }, [orch.toolCalls, persistCompletedWO]);

  const udrCanonicalTables = useMemo(() => {
    const payload = udrMigrationStatus?.pending_gate_payload;
    if (!payload || typeof payload !== "object") return undefined;
    const tables = (payload as { existing_canonical_tables?: string[] }).existing_canonical_tables;
    return tables?.length ? tables : undefined;
  }, [udrMigrationStatus?.pending_gate_payload]);

  // Feature 2.5: link the active session to the business-entity IDs it has
  // touched. Today only work-order IDs are derivable from existing completion
  // snapshots; asset / vendor / location hooks remain when those completion
  // streams land. Idempotent — runs only when the id set actually changes.
  useEffect(() => {
    if (!sessions) return;
    const workOrderIds = completedWorkOrders
      .filter((s) => !s.isError && s.workOrderId)
      .map((s) => s.workOrderId);
    const woKey = workOrderIds.join("|");
    setSessions((prev) => {
      if (!prev) return prev;
      const existing = prev.find((s) => s.id === sessionId);
      if (!existing) return prev;
      const prevKey = (existing.workOrderIds ?? []).join("|");
      if (prevKey === woKey) return prev;
      const next = prev.map((s) =>
        s.id === sessionId
          ? { ...s, workOrderIds: workOrderIds.length ? workOrderIds : undefined }
          : s,
      );
      persistDeepAgentSessions(next);
      return next;
    });
  }, [completedWorkOrders, sessionId, sessions]);

  const udrContext = useMemo(() => {
    const sourceFileNames = orch.migrationContext?.fileNames?.length
      ? [...orch.migrationContext.fileNames]
      : undefined;
    const status = udrMigrationStatus;
    const ingestNode = status?.nodes?.find(
      (n) => String(n.node_name ?? "").toLowerCase().includes("ingestion"),
    );
    const ingestOutput = (ingestNode?.output ?? {}) as Record<string, unknown>;
    const tableCount =
      typeof ingestOutput.table_count === "number"
        ? (ingestOutput.table_count as number)
        : typeof ingestOutput.tables === "number"
          ? (ingestOutput.tables as number)
          : undefined;
    const columnCount =
      typeof status?.total_fields === "number" ? status.total_fields : undefined;
    const mappedColumnCount =
      typeof status?.t1_mapped_count === "number" ||
      typeof status?.t2_auto_count === "number" ||
      typeof status?.t2_human_count === "number"
        ? (status?.t1_mapped_count ?? 0) +
          (status?.t2_auto_count ?? 0) +
          (status?.t2_human_count ?? 0)
        : undefined;
    const mappingCoveragePct =
      typeof columnCount === "number" &&
      columnCount > 0 &&
      typeof mappedColumnCount === "number"
        ? (mappedColumnCount / columnCount) * 100
        : undefined;
    const hierarchyPayload = (status?.pending_gate_payload ?? null) as
      | { hierarchies_to_review?: unknown[]; detected_fks?: unknown[] }
      | null;
    const hierarchyCount = Array.isArray(hierarchyPayload?.hierarchies_to_review)
      ? hierarchyPayload!.hierarchies_to_review!.length
      : Array.isArray(hierarchyPayload?.detected_fks)
        ? hierarchyPayload!.detected_fks!.length
        : undefined;

    return {
      sessionId,
      migrationIds: orch.migrationContext?.migrationIds ?? [],
      documentIds: orch.docMatchContext?.documentIds ?? [],
      batchIds: orch.activeBatchId ? [orch.activeBatchId] : [],
      canonicalTables: udrCanonicalTables,
      sourceFileNames,
      tableCount,
      columnCount,
      mappedColumnCount,
      mappingCoveragePct,
      hierarchyCount,
      lastResult: status?.status,
    };
  }, [
    sessionId,
    orch.activeBatchId,
    orch.docMatchContext?.documentIds.join(","),
    orch.migrationContext?.fileNames?.join("|"),
    orch.migrationContext?.migrationIds.join(","),
    udrCanonicalTables?.join(","),
    udrMigrationStatus,
  ]);

  const hasUdrActivity =
    activeSpace === "udr" ||
    udrContext.migrationIds.length > 0 ||
    udrContext.documentIds.length > 0 ||
    udrContext.batchIds.length > 0;

  const wideCenterPanel = centerTab !== "chat";

  const primaryDocId = orch.docMatchContext?.documentIds[0] ?? null;

  // Tracks whether the migration panel was opened from the UDR Saved Script
  // panel. When true, the migration panel renders a "Back to UDR" breadcrumb
  // so the user can return to the script without losing context (Feature 4.6).
  const [migrationOpenedFromUdr, setMigrationOpenedFromUdr] = useState(false);

  function handleCenterTabChange(tab: CenterTabId) {
    setCenterTab(tab);
    if (tab !== "migration") setMigrationOpenedFromUdr(false);
    if (tab === "work_orders") setActiveSpace("work_orders");
    else if (tab === "documents") setActiveSpace("documents");
    else if (tab === "migration") setActiveSpace("migration");
    else if (tab === "udr") setActiveSpace("udr");
    else if (tab === "schema") setActiveSpace("schema");
  }

  function handleOpenChatWithPrefill(prefill?: string) {
    setCenterTab("chat");
    if (prefill) setComposer(prefill);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  useEffect(() => {
    if (orch.interruptPayload || orch.approvalInsight) {
      activityRailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [orch.interruptPayload, orch.approvalInsight?.id]);

  // Single-door spec: the orchestrator does NOT auto-open workflow panels when
  // a migration / document batch / schema mapping starts. The chat surfaces an
  // ActiveMigrationCard / ActiveDocumentsCard / ActiveSchemaCard with an
  // explicit "Open workflow" button — clicking that button is the only path
  // from chat into a workflow panel.

  useEffect(() => {
    if (!hasUdrActivity) return;
    syncUdrScriptFromContext(udrContext);
  }, [hasUdrActivity, udrContext]);

  async function handleOpenUdrMigration(migrationId: string) {
    const ok = await orch.openMigrationFromId(migrationId, "UDR script");
    if (!ok) {
      throw new Error("migration_not_found");
    }
    setMigrationOpenedFromUdr(true);
    setCenterTab("migration");
  }

  function handleBackToUdr() {
    setMigrationOpenedFromUdr(false);
    setCenterTab("udr");
    setActiveSpace("udr");
  }

  const startNewChat = useCallback(
    (space: SavedSpaceId = activeSpace) => {
      const next = createDeepAgentSessionId();
      setSessions((prev) => {
        const base = prev ?? [];
        const withNew = upsertDeepAgentSession(base, {
          id: next,
          title: "New chat",
          updatedAt: Date.now(),
          space,
        });
        persistDeepAgentSessions(withNew);
        return withNew;
      });
      setActiveSpace(space);
      setSessionId(next);
      setComposer("");
      setCenterTab("chat");
    },
    [activeSpace],
  );

  const selectSession = useCallback(
    (id: string) => {
      setSessionId(id);
      setComposer("");
      const picked = sessions?.find((s) => s.id === id);
      if (picked) setActiveSpace(effectiveSpace(picked));
      setCenterTab("chat");
    },
    [sessions],
  );

  const handleReassignSession = useCallback(
    (targetId: string, space: SavedSpaceId | null) => {
      setSessions((prev) => {
        if (!prev) return prev;
        const next = prev.map((s) =>
          s.id === targetId ? setSessionSpaceOverride(s, space) : s,
        );
        persistDeepAgentSessions(next);
        return next;
      });
      if (targetId === sessionId && space) setActiveSpace(space);
    },
    [sessionId],
  );

  const handleAssignCustomSpace = useCallback(
    (targetId: string, customId: string | null) => {
      setSessions((prev) => {
        if (!prev) return prev;
        const next = prev.map((s) =>
          s.id === targetId
            ? { ...s, customSpaceId: customId ?? undefined, updatedAt: Date.now() }
            : s,
        );
        persistDeepAgentSessions(next);
        return next;
      });
    },
    [],
  );

  const pinContext = useMemo(
    () => ({
      activeSpace,
      lastDomain: orch.activeDomain,
      lastRouteIntent: orch.lastRouteIntent,
      hasMigration: (orch.migrationContext?.migrationIds.length ?? 0) > 0,
      hasSchema: hasSchemaPipeline,
      hasDocMatch: (orch.docMatchContext?.documentIds.length ?? 0) > 0,
    }),
    [
      activeSpace,
      hasSchemaPipeline,
      orch.activeDomain,
      orch.docMatchContext?.documentIds.length,
      orch.lastRouteIntent,
      orch.migrationContext?.migrationIds.length,
    ],
  );

  // Custom pins state, mirrored from localStorage so the Tasks panel and the
  // pin bar agree on which pins to recommend (Feature 1.5).
  const [orchestratorCustomPins, setOrchestratorCustomPins] = useState<PinnedRun[]>([]);
  useEffect(() => {
    setOrchestratorCustomPins(loadCustomPins());
  }, [sessionId]);

  // ── Persistent workflow queue (push-back #5) ─────────────────────────────
  // Active / Recommended / Queued / Completed buckets are derived from this
  // state. Survives refresh, session switch, historical chat load — the
  // primary source of truth for the orchestrator's task surface.
  const [workflowQueue, setWorkflowQueue] = useState<WorkflowQueueState>(() =>
    loadWorkflowQueue(sessionId),
  );
  // Reload when the session changes (Saved-Space jump, new chat, re-login).
  useEffect(() => {
    setWorkflowQueue(loadWorkflowQueue(sessionId));
  }, [sessionId]);
  const persistQueue = useCallback((next: WorkflowQueueState) => {
    persistWorkflowQueue(next);
    setWorkflowQueue(next);
  }, []);

  // (Uploads are registered at send-time inside dispatchSend — see below.)

  // Mirror migration/doc/schema contexts into the queue's workflow rows so
  // status + backend id reconstruct on refresh from persisted state.
  //
  // These effects used to depend on `workflowQueue` itself AND call
  // setWorkflowQueue inside — every 3-second migration-status poll triggered a
  // re-evaluation, a JSON.stringify of the entire queue, and (when even a
  // single progress % changed) a setState that re-fired the effect. That
  // chain manifested to the user as the chat / queue card flickering while a
  // migration was running. Switched to a functional setter so workflowQueue
  // is no longer a dependency: the effect now only runs when its real inputs
  // (the migration / doc context + polled status) change, and the
  // compare-and-persist happens inside the setter against the latest state.
  useEffect(() => {
    const migId = orch.migrationContext?.migrationIds[0];
    if (!migId) return;
    const fileNames = orch.migrationContext?.fileNames ?? [];
    const live = udrMigrationStatus;
    const liveStatus = (live?.status ?? "").toLowerCase();
    const status: WorkflowQueueRun["status"] =
      liveStatus === "complete"
        ? "complete"
        : liveStatus === "failed" || liveStatus === "ddl_failed" || liveStatus === "error"
          ? "failed"
          : liveStatus === "step_paused" || live?.pending_gate_type
            ? "awaiting_input"
            : "running";
    const progress = live ? computeMigrationProgress(live) : null;
    setWorkflowQueue((current) => {
      const matchingUploads = current.uploads
        .filter((u) => u.intendedKind === "migration" && fileNames.includes(u.filename))
        .map((u) => u.id);
      const next = upsertWorkflowRun(current, {
        kind: "migration",
        backendId: migId,
        uploadIds: matchingUploads,
        status,
        title: fileNames[0] ?? live?.cmms_name ?? "Migration",
        detail: live?.pending_gate_type ?? undefined,
        gateLabel: progress?.gateLabel ?? undefined,
        step: progress?.step ?? undefined,
        totalSteps: progress && progress.total > 0 ? progress.total : undefined,
        progressPct: progress?.pct ?? undefined,
        space: "migration",
      });
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      persistWorkflowQueue(next);
      return next;
    });
  }, [
    orch.migrationContext?.migrationIds,
    orch.migrationContext?.fileNames,
    udrMigrationStatus,
  ]);

  useEffect(() => {
    const docIds = orch.docMatchContext?.documentIds ?? [];
    if (docIds.length === 0) return;
    const fileNames = orch.docMatchContext?.fileNames ?? [];
    setWorkflowQueue((current) => {
      const matchingUploads = current.uploads
        .filter((u) => u.intendedKind === "documents" && fileNames.includes(u.filename))
        .map((u) => u.id);
      const next = upsertWorkflowRun(current, {
        kind: "documents",
        backendId: docIds[0],
        uploadIds: matchingUploads,
        status: "running",
        title: fileNames[0] ?? `${docIds.length} document${docIds.length === 1 ? "" : "s"}`,
        detail: docIds.length > 1 ? `${docIds.length} indexing` : undefined,
        space: "documents",
      });
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      persistWorkflowQueue(next);
      return next;
    });
  }, [
    orch.docMatchContext?.documentIds,
    orch.docMatchContext?.fileNames,
  ]);

  // Defensive backfill: a session corrupted by the pre-fix bug may have a
  // cached phantom schemaContext that survived a refresh. When a migration is
  // in flight AND the schema context isn't a real schema flow, clear it so
  // already-affected users recover without losing their migration state.
  useEffect(() => {
    const schemaIds = orch.schemaContext?.schemaMappingIds ?? [];
    if (schemaIds.length === 0) return;
    if (isRealSchemaFlow) return;
    const hasMigrationInFlight = (orch.migrationContext?.migrationIds.length ?? 0) > 0;
    if (!hasMigrationInFlight) return;
    orch.clearSchemaContext();
  }, [
    orch.schemaContext?.schemaMappingIds,
    isRealSchemaFlow,
    orch.migrationContext?.migrationIds,
    orch,
  ]);

  useEffect(() => {
    const schemaIds = orch.schemaContext?.schemaMappingIds ?? [];
    if (schemaIds.length === 0) return;
    if (!isRealSchemaFlow) return;
    setWorkflowQueue((current) => {
      const next = upsertWorkflowRun(current, {
        kind: "schema",
        backendId: schemaIds[0],
        uploadIds: [],
        status: "running",
        title: orch.schemaContext?.labels?.[0] ?? "Schema mapping",
        space: "schema",
      });
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      persistWorkflowQueue(next);
      return next;
    });
  }, [
    orch.schemaContext?.schemaMappingIds,
    orch.schemaContext?.labels,
    isRealSchemaFlow,
  ]);

  // When a completion snapshot lands, mark the matching workflow complete
  // (idempotent — upserts by backendId).
  useEffect(() => {
    if (completedMigrations.length === 0) return;
    setWorkflowQueue((current) => {
      let q = current;
      for (const snap of completedMigrations) {
        const existing = q.workflows.find(
          (w) => w.kind === "migration" && w.backendId === snap.migration_id,
        );
        if (existing && existing.status === "complete") continue;
        const status: WorkflowQueueRun["status"] =
          snap.status === "failed" || snap.status === "ddl_failed" ? "failed" : "complete";
        if (existing) {
          q = updateWorkflowStatus(q, existing.id, { status, detail: snap.status });
        } else {
          q = upsertWorkflowRun(q, {
            kind: "migration",
            backendId: snap.migration_id,
            uploadIds: [],
            status,
            title: snap.fileNames?.[0] ?? snap.cmms_name ?? "Migration",
            detail: snap.status,
            space: "migration",
          });
        }
      }
      if (q === current) return current;
      persistWorkflowQueue(q);
      return q;
    });
  }, [completedMigrations]);

  // Buckets memo (push-back #1): single source of truth for the in-chat
  // task strip AND the Tasks center tab. Surfacing them in chat keeps the
  // orchestrator chat-first; the Tasks tab is a fuller drill-down.
  const taskBuckets = useMemo<DeepAgentTaskBuckets>(() => {
    const active: ActiveTaskItem[] = [];
    if (showActiveMigrationCard && udrMigrationStatus && primaryUdrMigrationId) {
      const st = (udrMigrationStatus.status ?? "").toLowerCase();
      const status: ActiveTaskItem["status"] =
        st === "step_paused"
          ? "paused"
          : udrMigrationStatus.pending_gate_type
            ? "awaiting_input"
            : "running";
      active.push({
        id: `migration:${primaryUdrMigrationId}`,
        kind: "migration",
        title:
          orch.migrationContext?.fileNames?.[0] ??
          udrMigrationStatus.cmms_name ??
          "Migration",
        detail: [
          udrMigrationStatus.pending_gate_type ?? null,
          udrMigrationStatus.current_step ? `Step ${udrMigrationStatus.current_step}` : null,
          typeof udrMigrationStatus.progress_pct === "number"
            ? `${Math.round(udrMigrationStatus.progress_pct)}%`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        status,
        onOpen: () => handleCenterTabChange("migration"),
      });
    }
    const activeDocs = orch.docMatchContext?.documentIds ?? [];
    if (activeDocs.length > 0) {
      active.push({
        id: `documents:${activeDocs.join(",")}`,
        kind: "documents",
        title:
          orch.docMatchContext?.fileNames?.[0] ??
          `${activeDocs.length} document${activeDocs.length === 1 ? "" : "s"}`,
        detail: `${activeDocs.length} indexing`,
        status: "running",
        onOpen: () => handleCenterTabChange("documents"),
      });
    }
    const activeSchemaIds =
      isRealSchemaFlow ? (orch.schemaContext?.schemaMappingIds ?? []) : [];
    if (activeSchemaIds.length > 0) {
      active.push({
        id: `schema:${activeSchemaIds[0]}`,
        kind: "schema",
        title: orch.schemaContext?.labels?.[0] ?? "Schema mapping",
        detail: activeSchemaIds[0]?.slice(0, 8),
        status: "running",
        onOpen: () => handleCenterTabChange("schema"),
      });
    }

    const recommended = selectVisiblePins(pinContext, orchestratorCustomPins).filter(
      (p) => p.space !== activeSpace,
    );

    const completed: CompletedTaskItem[] = [
      ...completedMigrations.map<CompletedTaskItem>((snapshot) => ({
        kind: "migration",
        snapshot,
        onOpen: () => handleCenterTabChange("migration"),
      })),
      ...completedDocBatches.map<CompletedTaskItem>((snapshot) => ({
        kind: "documents",
        snapshot,
      })),
      ...completedSchema.map<CompletedTaskItem>((snapshot) => ({
        kind: "schema",
        snapshot,
        onOpen: () => handleCenterTabChange("schema"),
      })),
      ...completedWorkOrders.map<CompletedTaskItem>((snapshot) => ({
        kind: "work_order",
        snapshot,
      })),
    ].sort((a, b) => b.snapshot.capturedAt - a.snapshot.capturedAt);

    return {
      active,
      recommended,
      queued: intent.phase.kind === "none" ? intent.queuedNext : null,
      completed,
    };
  }, [
    showActiveMigrationCard,
    udrMigrationStatus,
    primaryUdrMigrationId,
    orch.migrationContext?.fileNames,
    orch.docMatchContext?.documentIds,
    orch.docMatchContext?.fileNames,
    orch.schemaContext?.schemaMappingIds,
    orch.schemaContext?.labels,
    pinContext,
    orchestratorCustomPins,
    activeSpace,
    completedMigrations,
    completedDocBatches,
    completedSchema,
    completedWorkOrders,
    intent.phase.kind,
    intent.queuedNext,
  ]);

  // Activity Log events (push-backs #2 + #5). Structured Trigger / Outcome /
  // Status / Agents / Confidence / Approvals / Escalations derived from the
  // orchestrator state AND from per-session localStorage so historical chats
  // reconstruct the same feed they had when the work happened.
  const [persistedActivityEvents, setPersistedActivityEvents] = useState<ActivityLogEvent[]>(
    () => loadActivityEvents(sessionId),
  );
  useEffect(() => {
    setPersistedActivityEvents(loadActivityEvents(sessionId));
  }, [sessionId]);

  const liveActivityEvents = useMemo<ActivityLogEvent[]>(
    () =>
      buildActivityLogEvents({
        sessionId,
        turns: orch.turns,
        processLog: orch.processLog,
        toolCalls: orch.toolCalls,
        activeDomain: orch.activeDomain,
        lastRouteIntent: orch.lastRouteIntent,
        interruptPayload: orch.interruptPayload,
        approvalInsight: orch.approvalInsight,
        approvalToolError: orch.approvalToolError,
        completedMigrations,
        completedDocBatches,
        completedSchema,
        completedWorkOrders,
      }),
    [
      sessionId,
      orch.turns,
      orch.processLog,
      orch.toolCalls,
      orch.activeDomain,
      orch.lastRouteIntent,
      orch.interruptPayload,
      orch.approvalInsight,
      orch.approvalToolError,
      completedMigrations,
      completedDocBatches,
      completedSchema,
      completedWorkOrders,
    ],
  );

  const activityEvents = useMemo<ActivityLogEvent[]>(
    () => mergeActivityEvents(persistedActivityEvents, liveActivityEvents),
    [persistedActivityEvents, liveActivityEvents],
  );

  // Persist the merged stream so it reconstructs identically next time the
  // session is opened. Skip when nothing materially changed (cheap stringify
  // — events are small structs).
  const lastPersistedSigRef = useRef<string>("");
  useEffect(() => {
    if (!sessionId) return;
    const sig = JSON.stringify(activityEvents.map((e) => [e.id, e.status, e.outcome ?? ""]));
    if (sig === lastPersistedSigRef.current) return;
    lastPersistedSigRef.current = sig;
    persistActivityEvents(sessionId, activityEvents);
  }, [activityEvents, sessionId]);

  const inlineActivityEvent = useMemo(
    () => pickInlineActivityEvent(activityEvents),
    [activityEvents],
  );

  function handleActivityAction(event: ActivityLogEvent, action: ActivityInlineAction) {
    if (action.kind === "open" && event.id.startsWith("complete_migration:")) {
      handleCenterTabChange("migration");
      return;
    }
    if (action.kind === "dismiss") {
      // Approval-tool errors are cleared by the underlying orchestrator on next event.
      return;
    }
    if (event.kind === "approval_pending") {
      // The dedicated HITL / approval panels in the right rail own the actual
      // decision submission. Routing the user there preserves a single submit
      // path and keeps the action inline-discoverable.
      handleCenterTabChange("chat");
      activityRailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (event.kind === "escalation") {
      handleCenterTabChange("activity");
      return;
    }
  }

  function handleRunPin(prompt: string, space: SavedSpaceId, opts?: UdrRunPinOptions) {
    setActiveSpace(space);
    if (!orgId || serviceAvailable === false || orch.busy || orch.interruptPayload) {
      setComposer(prompt);
      return;
    }
    void orch.sendMessage(prompt, undefined, {
      forcedRoute: opts?.forcedRoute,
      migrationId: opts?.migrationId,
      intentSpace: space,
    });
  }

  const displayTurns = useMemo(() => {
    if (serviceAvailable !== false) return orch.turns;
    return orch.turns.map((t) =>
      t.id === "greeting"
        ? {
            ...t,
            text: "The orchestrator service is not connected. Start svc-deepagents locally (port 8008) or ensure /backend/deep-agents is routed through your gateway, then refresh.",
          }
        : t,
    );
  }, [orch.turns, serviceAvailable]);

  const canSend =
    (!!composer.trim() || pendingFiles.length > 0) &&
    !!orgId &&
    serviceAvailable !== false &&
    !orch.busy &&
    (!orch.interruptPayload || pendingFiles.length > 0);

  const DEFAULT_INGEST_MSG = "Please ingest the attached files and continue in orchestrator chat.";

  function dispatchSend(
    text: string,
    files: File[],
    forcedRoute?: UdrForcedRoute,
    intentSpace?: SavedSpaceId,
  ) {
    if (text) lastUserMessageRef.current = text;
    // Register every sent file in the persistent workflow queue (push-back #5)
    // BEFORE the orchestrator clears local state. This is the moment uploads
    // become workflow candidates; if the user uploaded XLSX + PDF and only
    // sends one, the other stays as a recommendation in the queue and is
    // reconstructable on refresh / saved-space / re-login.
    if (files.length > 0) {
      const next = registerUploads(
        workflowQueue,
        files.map((f) => ({ filename: f.name, size: f.size })),
      );
      if (next.uploads.length !== workflowQueue.uploads.length) persistQueue(next);
    }
    const sendOpts =
      forcedRoute || intentSpace
        ? { forcedRoute, intentSpace }
        : undefined;
    void orch.sendMessage(text || DEFAULT_INGEST_MSG, files, sendOpts);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function handleSend() {
    const text = composer.trim();
    if (!text && pendingFiles.length === 0) return;
    if (!canSend) return;
    const files = [...pendingFiles];

    // WP-2: intercept ambiguous migration/data asks with a clarification menu.
    const decision = intent.evaluateSend(text, files);
    setComposer("");
    setPendingFiles([]);
    if (!decision.proceed) {
      // Menu / confirm / split is now showing — held text+files live in the hook.
      return;
    }
    dispatchSend(text, files, decision.forcedRoute, decision.intentSpace);
  }

  function handleIntentPick(kind: IntentKind) {
    const chip = INTENT_BY_KIND[kind];
    const held = intent.heldFiles;
    const text = intent.heldText;
    const { structured, docs } = splitFilesByTrack(held);
    const trackFiles = kind === "csv_excel" ? structured : kind === "word_pdf" ? docs : [];

    if (chip.needsFiles && trackFiles.length > 0) {
      // Run this track now; queue the other track for sequential continuation.
      const otherFiles = held.filter((f) => !trackFiles.includes(f));
      intent.dismiss();
      if (otherFiles.length) {
        const otherKind: IntentKind = kind === "csv_excel" ? "word_pdf" : "csv_excel";
        intent.setQueuedNext({
          intent: otherKind,
          files: otherFiles,
          fileNames: otherFiles.map((f) => f.name),
          text: "",
        });
      }
      dispatchSend(text, trackFiles, chip.forcedRoute, chip.intentSpace);
      return;
    }
    // No matching files yet → remember the choice and prompt for the next step.
    intent.setPendingIntent(kind);
    intent.setPhase({ kind: "prompt", intent: kind });
    intent.setHeldFiles([]);
    intent.setHeldText("");
  }

  // Scenario B — user explicitly verifies the ingestion type for the held files.
  function handleConfirmIngest(kind: "csv_excel" | "word_pdf") {
    const chip = INTENT_BY_KIND[kind];
    const files = [...intent.heldFiles];
    const text = intent.heldText;
    intent.dismiss();
    dispatchSend(text, files, chip.forcedRoute, chip.intentSpace);
  }

  // Scenario C — continue with the second track once the first is done.
  // After a refresh the File blobs that were attached at upload time are gone
  // (browsers don't persist File handles); only the file names survive. In
  // that case we re-prompt the user for the files via a hidden picker with an
  // intent-appropriate accept filter, then dispatch with the same forced route.
  function handleContinueQueued() {
    const queued = intent.queuedNext;
    if (!queued) return;
    const chip = INTENT_BY_KIND[queued.intent];

    if (queued.files.length > 0) {
      intent.setQueuedNext(null);
      dispatchSend(queued.text, queued.files, chip.forcedRoute, chip.intentSpace);
      return;
    }

    if (!queued.fileNames.length) {
      // Nothing to re-pick — just clear the stale card.
      intent.setQueuedNext(null);
      return;
    }

    const accept =
      queued.intent === "csv_excel"
        ? ".csv,.xlsx,.xls,.xlsm"
        : queued.intent === "word_pdf"
          ? ".pdf,.doc,.docx,.txt"
          : "";

    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    if (accept) picker.accept = accept;
    picker.style.display = "none";
    picker.addEventListener("change", () => {
      const picked = Array.from(picker.files ?? []);
      document.body.removeChild(picker);
      if (!picked.length) {
        toast({ title: "Re-attach files to continue", description: queued.fileNames.join(", ") });
        return;
      }
      intent.setQueuedNext(null);
      dispatchSend(queued.text, picked, chip.forcedRoute, chip.intentSpace);
    });
    document.body.appendChild(picker);
    picker.click();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSelectSpace(space: SavedSpaceId) {
    setActiveSpace(space);
  }

  function handleApprovalApprove() {
    const wo = orch.approvalInsight?.workOrderId;
    void orch.sendMessage(
      wo
        ? `Approve the suggested approval chain for work order ${wo}.`
        : "Approve the suggested approval chain.",
    );
  }

  function handleApprovalReject() {
    void orch.sendMessage("Reject the suggested approval chain and suggest an alternative.");
  }

  function handleAskWoInChat() {
    handleOpenChatWithPrefill("Create a work order for ");
  }

  if (!sessions) {
    return (
      <div className="flex h-full min-h-[480px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full min-h-0 flex-col",
        embedded ? "px-2 py-2 gap-3" : "mx-auto max-w-[1480px] px-4 sm:px-6 py-4 gap-3",
      )}
    >
      {!embedded ? (
        <div className="flex shrink-0 items-center justify-between gap-3">
          <OrchestratorHero />
          <DeepAgentServiceStatus
            loading={healthLoading}
            health={health}
            isError={healthError}
            toolsCount={orch.toolsCatalog.length}
            variant="light"
          />
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-end gap-2 px-1">
          <DeepAgentServiceStatus
            loading={healthLoading}
            health={health}
            isError={healthError}
            toolsCount={orch.toolsCatalog.length}
            variant="light"
          />
        </div>
      )}

      <OrchestratorOrgBanner orgName={orgId ? orgName : undefined} />

      {serviceAvailable === false ? (
        <div
          role="alert"
          className="shrink-0 flex items-center gap-2.5 rounded-xl bg-red-50/60 px-3.5 py-2.5 text-xs text-red-900"
        >
          <AlertCircle size={14} className="shrink-0 text-red-600" />
          <span>
            <strong className="font-medium">Orchestrator backend is offline.</strong>
            <span className="text-red-800/80"> Run </span>
            <span className="rounded bg-red-100/80 px-1 py-px font-mono text-[10px]">svc-deepagents</span>
            <span className="text-red-800/80"> or set </span>
            <span className="rounded bg-red-100/80 px-1 py-px font-mono text-[10px]">DEEP_AGENTS_DEV_PROXY</span>
            <span className="text-red-800/80"> for local dev.</span>
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 flex h-full">
        <div
          style={{ width: `${leftRailWidth}px` }}
          className="hidden md:flex shrink-0 min-h-0 flex-col"
        >
          <DeepAgentSavedSpacesPanel
            sessions={sessions}
            activeId={sessionId}
            activeSpace={activeSpace}
            customSpaces={customSpaces}
            onSelectSpace={handleSelectSpace}
            onSelectSession={selectSession}
            onNewInSpace={(space) => startNewChat(space)}
            onReassignSession={handleReassignSession}
            onCreateCustomSpace={(name) => void createCustomSpace(name)}
            onDeleteCustomSpace={(id) => void deleteCustomSpace(id)}
            onAssignCustomSpace={handleAssignCustomSpace}
          />
        </div>

        <ResizeHandle
          width={leftRailWidth}
          setWidth={setLeftRailWidth}
          min={LEFT_RAIL_MIN}
          max={LEFT_RAIL_MAX}
          ariaLabel="Resize saved spaces panel"
        />

        <section
          aria-label="Plenum CAFM Orchestrator chat"
          className="flex min-h-0 flex-1 min-w-0 flex-col"
        >
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="md:hidden max-h-48 overflow-hidden mb-2 shrink-0 px-4">
              <DeepAgentSavedSpacesPanel
                sessions={sessions}
                activeId={sessionId}
                activeSpace={activeSpace}
                customSpaces={customSpaces}
                onSelectSpace={handleSelectSpace}
                onSelectSession={selectSession}
                onNewInSpace={(space) => startNewChat(space)}
                onReassignSession={handleReassignSession}
                onCreateCustomSpace={(name) => void createCustomSpace(name)}
                onDeleteCustomSpace={(id) => void deleteCustomSpace(id)}
                onAssignCustomSpace={handleAssignCustomSpace}
              />
            </div>

            {wideCenterPanel ? (
              <div className="shrink-0 pb-2 px-4 sm:px-6 pt-2">
                <button
                  type="button"
                  onClick={() => handleCenterTabChange("chat")}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <ArrowLeft size={13} />
                  Back to chat
                </button>
              </div>
            ) : null}

            {centerTab === "schema" ? (
              <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-6 pb-4">
                {hasSchemaPipeline && orch.schemaContext ? (
                  <DeepAgentSchemaPanel
                    context={orch.schemaContext}
                    onDismiss={() => setCenterTab("chat")}
                    embeddedRail={false}
                  />
                ) : (
                  <div className="p-4 overflow-y-auto">
                    <OrchestratorFlowEmptyState flow="schema" onOpenChat={handleOpenChatWithPrefill} />
                  </div>
                )}
              </div>
            ) : null}

            {centerTab === "documents" ? (
              <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4">
                <div className="flex flex-col gap-3">
                  {primaryDocId ? (
                    <div className="shrink-0 rounded-lg bg-slate-50/60 px-3 py-2 text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-slate-700">Indexed document</span>
                      <code className="font-mono text-[11px] text-slate-600 break-all">{primaryDocId}</code>
                    </div>
                  ) : null}
                  <div className="shrink-0 h-[min(72vh,720px)]">
                    <DeepAgentDocumentsPanel initialDocumentId={primaryDocId} embeddedRail={false} />
                  </div>
                  {orch.docMatchContext ? (
                    <div className="shrink-0 h-[min(64vh,640px)]">
                      <DeepAgentDocMatchPanel
                        context={orch.docMatchContext}
                        onDismiss={orch.clearDocMatchContext}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {centerTab === "migration" ? (
              <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-6 pb-4">
                {orch.migrationContext ? (
                  <DeepAgentMigrationPanel
                    context={orch.migrationContext}
                    onDismiss={orch.clearMigrationContext}
                    embeddedRail={false}
                    sessionId={sessionId}
                    onProcessLog={orch.appendProcessLog}
                    onBackToUdr={migrationOpenedFromUdr ? handleBackToUdr : undefined}
                  />
                ) : (
                  <div className="p-4 overflow-y-auto">
                    <OrchestratorFlowEmptyState flow="migration" onOpenChat={handleOpenChatWithPrefill} />
                  </div>
                )}
              </div>
            ) : null}

            {centerTab === "udr" ? (
              <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-6 pb-4">
                {hasUdrActivity ? (
                  <DeepAgentUdrPanel
                    context={udrContext}
                    onRunPin={(prompt, opts) => handleRunPin(prompt, "udr", opts)}
                    onOpenMigration={handleOpenUdrMigration}
                    embeddedRail={false}
                  />
                ) : (
                  <div className="p-4 overflow-y-auto">
                    <OrchestratorFlowEmptyState flow="udr" onOpenChat={handleOpenChatWithPrefill} />
                  </div>
                )}
              </div>
            ) : null}

            {centerTab === "work_orders" ? (
              <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-6 pb-4">
                <DeepAgentWorkOrdersPanel onAskCreate={handleAskWoInChat} embeddedRail={false} />
              </div>
            ) : null}

            {centerTab === "tasks" ? (
              <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-6 pb-4">
                <DeepAgentTaskBucketsPanel
                  buckets={taskBuckets}
                  onRunRecommended={(pin) =>
                    handleRunPin(
                      pin.prompt,
                      pin.space,
                      pin.forcedRoute ? { forcedRoute: pin.forcedRoute } : undefined,
                    )
                  }
                  onContinueQueued={handleContinueQueued}
                  onDismissQueued={() => intent.setQueuedNext(null)}
                />
              </div>
            ) : null}

            {centerTab === "activity" ? (
              <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-6 pb-4">
                {activityEvents.length === 0 ? (
                  <div className="p-4 overflow-y-auto">
                    <OrchestratorFlowEmptyState flow="activity" onOpenChat={handleOpenChatWithPrefill} />
                  </div>
                ) : (
                  <DeepAgentStructuredActivityLog
                    events={activityEvents}
                    onAction={handleActivityAction}
                  />
                )}
              </div>
            ) : null}

            {centerTab === "chat" ? (
              <div className="flex flex-1 min-h-0 flex-col">
                <div
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions text"
                  aria-label="Orchestrator chat messages"
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-smooth px-4 sm:px-6"
                >
                  <div className="mx-auto max-w-3xl space-y-7 py-6">
                    {/* Active workflows strip — sticky so users never lose
                        track of what's in flight after Back-to-chat. Mirrors
                        backend state already polled by orchestrator hooks.
                        Spec push-back #1: the task bucket strip lives here so
                        Active / Recommended / Queued / Completed are visible
                        in the chat itself, not hidden behind a Tasks tab. */}
                    {(() => {
                      const hasAnyBucketRows =
                        taskBuckets.active.length +
                          taskBuckets.recommended.length +
                          (taskBuckets.queued ? 1 : 0) +
                          taskBuckets.completed.length >
                        0;
                      // ActiveMigrationCard / ActiveDocumentsCard /
                      // ActiveSchemaCard intentionally removed from the
                      // sticky strip: the workflow-queue chat card below
                      // already surfaces the same workflow (with the gate
                      // label + step + progress now folded into it), so
                      // pinning a second copy at the top was duplicate UI.
                      const anyActive = hasAnyBucketRows || !!inlineActivityEvent;
                      if (!anyActive) return null;
                      return (
                        <div className="sticky top-0 z-10 -mt-6 pt-6 pb-2 bg-gradient-to-b from-white via-white to-white/0 space-y-2">
                          {hasAnyBucketRows ? (
                            <DeepAgentTaskBucketStrip
                              buckets={taskBuckets}
                              onRunRecommended={(pin) =>
                                handleRunPin(
                                  pin.prompt,
                                  pin.space,
                                  pin.forcedRoute ? { forcedRoute: pin.forcedRoute } : undefined,
                                )
                              }
                              onContinueQueued={handleContinueQueued}
                              onDismissQueued={() => intent.setQueuedNext(null)}
                              onOpenAll={() => handleCenterTabChange("tasks")}
                            />
                          ) : null}
                          {inlineActivityEvent ? (
                            <DeepAgentInlineActivityCard
                              event={inlineActivityEvent}
                              onAction={handleActivityAction}
                            />
                          ) : null}
                          {intent.phase.kind === "none" && intent.queuedNext ? (
                            <DeepAgentNextTrackChip
                              queued={intent.queuedNext}
                              onContinue={handleContinueQueued}
                              onDismiss={() => intent.setQueuedNext(null)}
                            />
                          ) : null}
                        </div>
                      );
                    })()}

                    <div className="px-1">
                      <DeepAgentPinnedRunsBar
                        activeSpace={activeSpace}
                        pinContext={pinContext}
                        composerText={composer}
                        disabled={!orgId || serviceAvailable === false || orch.busy || !!orch.interruptPayload}
                        onRunPin={handleRunPin}
                      />
                    </div>

                    {displayTurns.map((t) => (
                      <OrchestratorMessageBubble
                        key={t.id}
                        turn={t}
                        domain={t.role === "assistant" ? orch.activeDomain : undefined}
                        onRetry={
                          t.role === "error" && lastUserMessageRef.current
                            ? () => void orch.sendMessage(lastUserMessageRef.current)
                            : undefined
                        }
                      />
                    ))}

                    {/* Workflow queue rendered as a conversation artifact
                        (push-back #1). The card reflects persisted queue
                        state, so the same content reconstructs after a
                        refresh / Saved-Space jump / re-login. */}
                    <DeepAgentQueueChatCard
                      queue={workflowQueue}
                      onOpenWorkflow={(run) => {
                        if (run.kind === "migration") handleCenterTabChange("migration");
                        else if (run.kind === "documents") handleCenterTabChange("documents");
                        else if (run.kind === "schema") handleCenterTabChange("schema");
                        else if (run.kind === "work_order") handleCenterTabChange("work_orders");
                      }}
                      onStartRecommended={(upload: WorkflowQueueUpload) => {
                        const prompt =
                          upload.intendedKind === "migration"
                            ? `Start a migration ingest for ${upload.filename}.`
                            : upload.intendedKind === "documents"
                              ? `Index ${upload.filename} into Doc RAG and summarise what was extracted.`
                              : upload.intendedKind === "schema"
                                ? `Run schema mapping using ${upload.filename}.`
                                : `Process ${upload.filename}.`;
                        setComposer(prompt);
                        setTimeout(() => textareaRef.current?.focus(), 50);
                      }}
                      onDismissUpload={(upload: WorkflowQueueUpload) => {
                        const next = removeUpload(workflowQueue, upload.id);
                        persistQueue(next);
                      }}
                    />

                    {intent.phase.kind !== "none" && intent.heldText.trim() ? (
                      <div className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-300">
                        <div className="max-w-[80%] rounded-2xl bg-slate-100 px-4 py-2.5 text-[15px] leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
                          {intent.heldText}
                        </div>
                      </div>
                    ) : null}

                    {intent.phase.kind !== "none" ? (
                      <DeepAgentIntentChips
                        phase={intent.phase}
                        heldFiles={intent.heldFiles}
                        onPick={handleIntentPick}
                        onConfirmIngest={handleConfirmIngest}
                        onShowAll={() => intent.setPhase({ kind: "menu" })}
                        onDismiss={intent.dismiss}
                      />
                    ) : null}

                    {/* Queued next-track chip moved into the sticky workflow
                        strip above so it stays in view as the chat scrolls. */}

                    {orch.uploadingFiles.length > 0 && orch.pending ? (
                      <SingleDoorIngestProgress files={orch.uploadingFiles} active />
                    ) : null}

                    {orch.migrationContext ? (
                      <div className="md:hidden max-h-[70vh] overflow-hidden">
                        <DeepAgentMigrationPanel
                          context={orch.migrationContext}
                          onDismiss={orch.clearMigrationContext}
                          sessionId={sessionId}
                          onProcessLog={orch.appendProcessLog}
                        />
                      </div>
                    ) : null}
                    {orch.docMatchContext ? (
                      <div className="md:hidden">
                        <DeepAgentDocMatchPanel
                          context={orch.docMatchContext}
                          onDismiss={orch.clearDocMatchContext}
                        />
                      </div>
                    ) : null}

                    {orch.batchProgress ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className="rounded-xl bg-slate-50/80 px-4 py-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-300"
                      >
                        <p className="text-sm font-medium text-slate-800 tracking-tight">Bulk ingest in progress</p>
                        <p className="text-xs mt-1 text-slate-500 leading-relaxed">
                          {orch.batchProgress.completed_count + orch.batchProgress.failed_count} /{" "}
                          {orch.batchProgress.total_files} files — {orch.batchProgress.progress_pct}% (
                          {orch.batchProgress.status})
                        </p>
                        <div
                          aria-hidden
                          className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/70"
                        >
                          <div
                            className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                            style={{ width: `${Math.min(100, Math.max(0, orch.batchProgress.progress_pct))}%` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {completedMigrations.map((snap, idx) => {
                      const isLatest = idx === completedMigrations.length - 1;
                      return (
                        <MigrationCompletionCard
                          key={snap.migration_id}
                          migration={snap}
                          fileNames={snap.fileNames}
                          hasNextTask={isLatest && !!intent.queuedNext}
                          onOpenDetails={async () => {
                            const ok = await orch.openMigrationFromId(
                              snap.migration_id,
                              snap.fileNames[0] ?? snap.cmms_name,
                            );
                            if (ok) handleCenterTabChange("migration");
                          }}
                          onOpenHistory={async () => {
                            const ok = await orch.openMigrationFromId(
                              snap.migration_id,
                              snap.fileNames[0] ?? snap.cmms_name,
                            );
                            if (ok) handleCenterTabChange("migration");
                          }}
                          onContinueNext={() => {
                            if (intent.queuedNext) {
                              handleContinueQueued();
                            } else {
                              handleOpenChatWithPrefill();
                            }
                          }}
                        />
                      );
                    })}

                    {completedDocBatches.map((snap) => (
                      <DocumentsCompletionCard
                        key={`docs-${snap.documentIds.join("-")}`}
                        snapshot={snap}
                        onOpenDocuments={() => handleCenterTabChange("documents")}
                        onOpenMatchSchema={() => handleCenterTabChange("documents")}
                      />
                    ))}

                    {completedSchema.map((snap) => (
                      <SchemaCompletionCard
                        key={`schema-${snap.schemaMappingId}`}
                        snapshot={snap}
                        onOpenSchema={() => {
                          orch.openSchemaFromId(
                            snap.schemaMappingId,
                            snap.label ?? snap.external_cmms_name ?? "Schema mapping",
                          );
                          handleCenterTabChange("schema");
                        }}
                      />
                    ))}

                    {completedWorkOrders.map((snap) => (
                      <WorkOrderCompletionCard
                        key={`wo-${snap.workOrderId}`}
                        snapshot={snap}
                        onOpenWorkOrders={() => handleCenterTabChange("work_orders")}
                      />
                    ))}

                    {orch.pending && !orch.interruptPayload ? (
                      <TypingIndicator domain={orch.activeDomain} />
                    ) : null}

                    {orch.interruptPayload ? (
                      <OrchestratorHitlBanner
                        onOpenActivity={() =>
                          activityRailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                        }
                      />
                    ) : null}

                    <div ref={bottomRef} />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 px-4 sm:px-6 pb-3 pt-1">
            <div className="mx-auto max-w-3xl">
              <div
                className={cn(
                  "group relative flex items-end gap-2 rounded-3xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200 shadow-sm transition-all",
                  "focus-within:ring-2 focus-within:ring-indigo-300 focus-within:shadow-md",
                  orch.busy && "opacity-90",
                )}
              >
                <label
                  className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  title="Attach files"
                >
                  <Paperclip size={17} aria-hidden />
                  <span className="sr-only">Attach files</span>
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    accept=".csv,.xlsx,.xls,.xlsm,.yaml,.yml,.json,.pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.tif,.tiff,.gif"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (!picked.length) return;
                      setPendingFiles((prev) => [...prev, ...picked]);
                      // Tag the session's saved space by file type, but DO NOT switch the
                      // center panel — attaching a file must keep the user in the chat
                      // interface (Claude-Code style). The migration/documents/schema panel
                      // opens later, only once an actual run starts (see the migrationContext
                      // / docMatchContext / schemaContext effects above).
                      const kinds = classifyUploadFiles(picked);
                      if (kinds.docRag) {
                        setActiveSpace("documents");
                      } else if (kinds.migration) {
                        setActiveSpace("migration");
                      } else if (kinds.schema) {
                        setActiveSpace("schema");
                      }
                      e.currentTarget.value = "";
                    }}
                    disabled={
                      !orgId ||
                      serviceAvailable === false ||
                      orch.busy ||
                      (!!orch.interruptPayload && pendingFiles.length === 0)
                    }
                  />
                </label>
                <textarea
                  ref={textareaRef}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message Orchestrator…"
                  rows={1}
                  aria-label="Message orchestrator"
                  disabled={
                    !orgId ||
                    serviceAvailable === false ||
                    orch.busy ||
                    (!!orch.interruptPayload && pendingFiles.length === 0 && !composer.trim())
                  }
                  className="flex-1 min-w-0 max-h-40 bg-transparent px-1 py-1.5 text-[15px] leading-snug text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none disabled:opacity-50"
                />
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  size="sm"
                  className={cn(
                    "h-8 w-8 p-0 shrink-0 rounded-full shadow-none transition-all",
                    "bg-slate-900 text-white hover:bg-slate-800 active:scale-95",
                    "disabled:bg-slate-200 disabled:text-slate-400",
                  )}
                  aria-label="Send message"
                >
                  {orch.busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                </Button>
              </div>
              {pendingFiles.length ? (
                <>
                  {(() => {
                    const cls = classifyUploadFiles(pendingFiles);
                    const tracks: string[] = [];
                    if (cls.migration) tracks.push("Migration ingest");
                    if (cls.docRag) tracks.push("Doc RAG");
                    if (cls.schema) tracks.push("Schema mapping");
                    if (!tracks.length) return null;
                    const mixed = tracks.length > 1;
                    return (
                      <div className="mt-2 px-2">
                        <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium text-amber-800">
                          <Sparkles size={10} />
                          {mixed
                            ? `Recommended: ${tracks.join(" + ")} (pick on send)`
                            : `Recommended: ${tracks[0]}`}
                        </p>
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap gap-1.5 mt-2 px-2">
                    {pendingFiles.map((f, idx) => (
                      <span
                        key={`${f.name}_${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 pl-2.5 pr-1 py-0.5 text-[11px] text-slate-700"
                      >
                        <span className="truncate max-w-[200px]">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <ResizeHandle
          width={rightRailWidth}
          setWidth={setRightRailWidth}
          min={RIGHT_RAIL_MIN}
          max={RIGHT_RAIL_MAX}
          invert
          ariaLabel="Resize process log panel"
        />

        <div
          ref={activityRailRef}
          style={{ width: `${rightRailWidth}px` }}
          className="hidden md:flex shrink-0 min-h-0 flex-col"
        >
          <DeepAgentProcessLogPanel
            entries={orch.processLog}
            loading={orch.busy}
            busy={orch.busy}
            resuming={orch.resuming}
            interruptPayload={orch.interruptPayload}
            approvalInsight={orch.approvalInsight}
            approvalToolError={orch.approvalToolError}
            onSubmitHitl={(d) => void orch.submitHitlDecision(d)}
            onApprovalApprove={handleApprovalApprove}
            onApprovalReject={handleApprovalReject}
            variant="light"
          />
        </div>
      </div>
    </div>
  );
}
