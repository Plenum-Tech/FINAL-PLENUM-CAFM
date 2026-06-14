"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Award,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  FileSpreadsheet,
  FileText,
  Folder,
  Handshake,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Package,
  Plus,
  Shield,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { cn } from "@/utils/cn";

import type { CustomSpace } from "./deep-agent-custom-spaces";
import type { DeepAgentSessionMeta } from "./deep-agent-sessions";
import { loadSpaceActivityEvents, type SpaceActivityEvent } from "./deep-agent-space-activity";
import {
  deriveWorkflowQueueBuckets,
  loadWorkflowQueue,
  WORKFLOW_KIND_LABEL,
  type WorkflowKind,
  type WorkflowQueueRun,
} from "./deep-agent-workflow-queue";
import { loadUdrScripts, scriptsForSession, type UdrScriptRecord } from "./udr-script-storage";
import {
  autoTaggedSessionsForSpace,
  countSessionsBySpace,
  effectiveSpace,
  manualSessionsForSpace,
  spaceDef,
  sumArtifactsBySpace,
  type SavedSpaceId,
} from "./deep-agent-spaces";

/** Built-in workspaces, in left-rail order — each is an expandable chat group. */
const GROUP_ORDER: SavedSpaceId[] = [
  // "work_orders",
  // "assets",
  // "sites",
  // "vendors",
  // "certificates",
  "documents",
  "udr",
  "migration",
  "schema",
  // "compliance",
  "general",
];

function formatChatTimestamp(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const SPACE_ICONS: Record<SavedSpaceId, React.ReactNode> = {
  work_orders: <Wrench size={15} className="text-blue-600 shrink-0" />,
  assets: <Package size={15} className="text-cyan-700 shrink-0" />,
  sites: <Building2 size={15} className="text-indigo-700 shrink-0" />,
  vendors: <Handshake size={15} className="text-amber-700 shrink-0" />,
  certificates: <Award size={15} className="text-rose-600 shrink-0" />,
  documents: <FileText size={15} className="text-violet-600 shrink-0" />,
  udr: <Database size={15} className="text-cyan-600 shrink-0" />,
  migration: <FileSpreadsheet size={15} className="text-emerald-600 shrink-0" />,
  schema: <Layers size={15} className="text-amber-600 shrink-0" />,
  compliance: <Shield size={15} className="text-indigo-600 shrink-0" />,
  general: <ClipboardList size={15} className="text-slate-500 shrink-0" />,
};

const REASSIGN_OPTIONS: SavedSpaceId[] = [
  "work_orders",
  "assets",
  "sites",
  "vendors",
  "certificates",
  "documents",
  "udr",
  "migration",
  "schema",
  "compliance",
  "general",
];

function SpaceCountBadge({
  sessionCount,
  artifactCount,
}: {
  sessionCount: number;
  artifactCount: number;
}) {
  if (sessionCount === 0 && artifactCount === 0) return null;
  return (
    <span
      className="text-[10px] tabular-nums text-muted-foreground shrink-0"
      title={
        artifactCount > 0
          ? `${sessionCount} session${sessionCount === 1 ? "" : "s"}, ${artifactCount} artifact${artifactCount === 1 ? "" : "s"}`
          : `${sessionCount} session${sessionCount === 1 ? "" : "s"}`
      }
    >
      {sessionCount}
      {artifactCount > 0 ? (
        <span className="text-slate-400"> · {artifactCount}↗</span>
      ) : null}
    </span>
  );
}

/** Compact row when session is indexed here via secondarySpaces (not primary bucket). */
function SecondarySessionChip({
  session,
  activeId,
  primaryLabel,
  onSelect,
}: {
  session: DeepAgentSessionMeta;
  activeId: string;
  primaryLabel: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={cn(
        "w-full rounded-md px-2 py-1 mb-0.5 text-left text-[10px] border border-dashed border-slate-200",
        session.id === activeId ? "bg-slate-100" : "hover:bg-slate-50",
      )}
      title={`Primary space: ${primaryLabel}`}
    >
      <span className="font-medium truncate block">{session.title}</span>
      <span className="text-slate-400">
        also here · primary {primaryLabel}
        {session.artifactHint ? ` · ${session.artifactHint}` : ""}
      </span>
    </button>
  );
}

function SessionRow({
  session,
  activeId,
  activeSpace,
  customSpaces,
  onSelect,
  onReassign,
  onAssignCustomSpace,
}: {
  session: DeepAgentSessionMeta;
  activeId: string;
  activeSpace: SavedSpaceId;
  customSpaces: CustomSpace[];
  onSelect: (id: string) => void;
  onReassign: (id: string, space: SavedSpaceId | null) => void;
  onAssignCustomSpace: (id: string, customId: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isPrimary = effectiveSpace(session) === activeSpace;
  const isSecondary =
    !isPrimary && (session.secondarySpaces ?? []).includes(activeSpace);

  if (isSecondary) {
    return (
      <SecondarySessionChip
        session={session}
        activeId={activeId}
        primaryLabel={spaceDef(effectiveSpace(session)).shortLabel}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className="group flex items-start gap-0.5 mb-0.5">
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className={cn(
          "flex-1 min-w-0 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
          session.id === activeId
            ? "bg-slate-100 text-slate-900"
            : "text-slate-700 hover:bg-slate-100/60",
        )}
      >
        <div className="font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{session.title}</span>
          <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-normal text-slate-600">
            {spaceDef(effectiveSpace(session)).shortLabel}
          </span>
        </div>
        {session.artifactHint ? (
          <div className="text-[10px] text-muted-foreground truncate">{session.artifactHint}</div>
        ) : null}
        <SessionRelatedEntities session={session} />
        <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-slate-400">
          <span>{formatChatTimestamp(session.updatedAt)}</span>
          {session.userOverrideSpace ? (
            <span className="rounded bg-amber-50 px-1 text-amber-700">moved</span>
          ) : null}
          {(session.spaceTags ?? []).includes("uncategorized") ? (
            <span className="rounded bg-slate-100 px-1">legacy</span>
          ) : null}
        </div>
      </button>
      <div className="relative shrink-0 pt-1">
        <button
          type="button"
          aria-label="Move session"
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal size={12} />
        </button>
        {menuOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-5 z-20 min-w-[8.5rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg text-[10px]">
              <div className="px-2 py-0.5 text-slate-500 font-medium">Move to</div>
              {REASSIGN_OPTIONS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  className="w-full px-2 py-1 text-left hover:bg-slate-50"
                  onClick={() => {
                    onReassign(session.id, sp);
                    setMenuOpen(false);
                  }}
                >
                  {spaceDef(sp).shortLabel}
                </button>
              ))}
              {session.userOverrideSpace ? (
                <button
                  type="button"
                  className="w-full px-2 py-1 text-left text-slate-500 hover:bg-slate-50 border-t border-slate-100 mt-0.5"
                  onClick={() => {
                    onReassign(session.id, null);
                    setMenuOpen(false);
                  }}
                >
                  Reset to auto
                </button>
              ) : null}
              {customSpaces.length ? (
                <>
                  <div className="px-2 py-0.5 text-slate-500 font-medium border-t border-slate-100 mt-0.5">
                    Custom spaces
                  </div>
                  {customSpaces.map((cs) => (
                    <button
                      key={cs.id}
                      type="button"
                      className={cn(
                        "w-full px-2 py-1 text-left hover:bg-slate-50 truncate",
                        session.customSpaceId === cs.id ? "text-cyan-700 font-medium" : "",
                      )}
                      onClick={() => {
                        onAssignCustomSpace(session.id, cs.id);
                        setMenuOpen(false);
                      }}
                    >
                      {cs.name}
                    </button>
                  ))}
                  {session.customSpaceId ? (
                    <button
                      type="button"
                      className="w-full px-2 py-1 text-left text-slate-500 hover:bg-slate-50"
                      onClick={() => {
                        onAssignCustomSpace(session.id, null);
                        setMenuOpen(false);
                      }}
                    >
                      Remove from custom space
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Compact "Related entities" line under a chat row (Feature 2.5). */
function SessionRelatedEntities({ session }: { session: DeepAgentSessionMeta }) {
  const wo = session.workOrderIds ?? [];
  const assets = session.assetIds ?? [];
  const vendors = session.vendorIds ?? [];
  const locations = session.locationIds ?? [];
  const parts: { icon: React.ReactNode; label: string }[] = [];
  if (wo.length) {
    parts.push({
      icon: <Wrench size={9} className="text-blue-500" />,
      label: wo.length === 1 ? "1 work order" : `${wo.length} work orders`,
    });
  }
  if (assets.length) {
    parts.push({
      icon: <Database size={9} className="text-cyan-600" />,
      label: assets.length === 1 ? "1 asset" : `${assets.length} assets`,
    });
  }
  if (vendors.length) {
    parts.push({
      icon: <Folder size={9} className="text-amber-600" />,
      label: vendors.length === 1 ? "1 vendor" : `${vendors.length} vendors`,
    });
  }
  if (locations.length) {
    parts.push({
      icon: <Folder size={9} className="text-indigo-600" />,
      label: locations.length === 1 ? "1 location" : `${locations.length} locations`,
    });
  }
  if (!parts.length) return null;
  return (
    <div
      className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px] text-slate-500"
      title="Business entities linked to this chat"
    >
      {parts.map((p, idx) => (
        <span key={idx} className="inline-flex items-center gap-0.5 rounded bg-slate-50 px-1">
          {p.icon}
          {p.label}
        </span>
      ))}
    </div>
  );
}

/** Active workflow runs (push-back #5) aggregated across the space's sessions. */
function loadActiveWorkflowsForSpace(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
): WorkflowQueueRun[] {
  const out: WorkflowQueueRun[] = [];
  for (const session of sessions) {
    const primary = effectiveSpace(session);
    if (primary !== spaceId && !(session.secondarySpaces ?? []).includes(spaceId)) continue;
    const q = loadWorkflowQueue(session.id);
    const { active } = deriveWorkflowQueueBuckets(q);
    for (const run of active) {
      if (!run.space || run.space === spaceId) out.push(run);
    }
  }
  return out;
}

function loadUdrScriptsForSpace(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
): UdrScriptRecord[] {
  if (spaceId !== "udr") return [];
  const sessionIds = sessions
    .filter((s) => {
      const primary = effectiveSpace(s);
      return primary === spaceId || (s.secondarySpaces ?? []).includes(spaceId);
    })
    .map((s) => s.id);
  const all = loadUdrScripts();
  const out: UdrScriptRecord[] = [];
  for (const sid of sessionIds) {
    const list = scriptsForSession(all, sid);
    if (list.length) out.push(list[0]);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function loadSpaceDocuments(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
): { filename: string; intendedKind: WorkflowKind }[] {
  const out = new Map<string, { filename: string; intendedKind: WorkflowKind }>();
  for (const session of sessions) {
    const primary = effectiveSpace(session);
    if (primary !== spaceId && !(session.secondarySpaces ?? []).includes(spaceId)) continue;
    const q = loadWorkflowQueue(session.id);
    for (const u of q.uploads) {
      if (!out.has(u.filename)) out.set(u.filename, { filename: u.filename, intendedKind: u.intendedKind });
    }
  }
  return [...out.values()];
}

function SpaceActiveTasks({
  spaceId,
  sessions,
}: {
  spaceId: SavedSpaceId;
  sessions: DeepAgentSessionMeta[];
}) {
  const runs = loadActiveWorkflowsForSpace(sessions, spaceId);
  if (runs.length === 0) return null;
  return (
    <div className="mx-1 my-2 rounded-lg border border-indigo-200 bg-indigo-50/30 px-2 py-2 space-y-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-indigo-700">
        Active tasks
      </div>
      {runs.slice(0, 4).map((run) => (
        <div
          key={run.id}
          className="rounded-md bg-white ring-1 ring-indigo-200 px-2 py-1.5 space-y-0.5"
        >
          {/* Row 1: kind pill + status — both shrink-0 so they never overflow */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="inline-flex shrink-0 items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700 uppercase tracking-wide whitespace-nowrap">
              {WORKFLOW_KIND_LABEL[run.kind]}
            </span>
            <span className="shrink-0 text-[9px] text-slate-400 uppercase tracking-wide whitespace-nowrap">
              {run.status.replace("_", " ")}
            </span>
          </div>
          {/* Row 2: title takes the full width and truncates to the container */}
          <div className="block text-[11px] text-slate-700 truncate" title={run.title}>
            {run.title}
          </div>
        </div>
      ))}
      {runs.length > 4 ? (
        <p className="text-[10px] text-slate-500">+{runs.length - 4} more active</p>
      ) : null}
    </div>
  );
}

function SpaceSavedUdrScripts({
  spaceId,
  sessions,
  onSelectSession,
}: {
  spaceId: SavedSpaceId;
  sessions: DeepAgentSessionMeta[];
  onSelectSession: (id: string) => void;
}) {
  const scripts = loadUdrScriptsForSpace(sessions, spaceId);
  if (scripts.length === 0) return null;
  return (
    <div className="mx-1 my-2 rounded-lg border border-cyan-200 bg-cyan-50/30 px-2 py-2 space-y-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-800">
        Saved UDR scripts
      </div>
      {scripts.slice(0, 4).map((script) => (
        <button
          key={script.id}
          type="button"
          onClick={() => onSelectSession(script.sessionId)}
          className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-cyan-100/40 text-left"
        >
          <Database size={11} className="text-cyan-700 shrink-0" />
          <span className="flex-1 min-w-0 truncate text-[10px] text-slate-700">{script.label}</span>
          <span className="text-[9px] text-slate-400 uppercase">{script.lastPhase}</span>
        </button>
      ))}
      {scripts.length > 4 ? (
        <p className="text-[10px] text-slate-500">+{scripts.length - 4} more scripts</p>
      ) : null}
    </div>
  );
}

function SpaceDocuments({
  spaceId,
  sessions,
}: {
  spaceId: SavedSpaceId;
  sessions: DeepAgentSessionMeta[];
}) {
  const docs = loadSpaceDocuments(sessions, spaceId);
  if (docs.length === 0) return null;
  return (
    <div className="mx-1 my-2 rounded-lg border border-violet-200 bg-violet-50/30 px-2 py-2 space-y-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-violet-700">
        Documents
      </div>
      <div className="space-y-1">
        {docs.slice(0, 6).map((d) => (
          <div
            key={d.filename}
            className="flex items-center gap-1.5 rounded-md bg-white ring-1 ring-violet-200 px-2 py-1 min-w-0"
            title={d.filename}
          >
            <FileText size={11} className="text-violet-600 shrink-0" />
            <span className="flex-1 min-w-0 truncate text-[10px] text-slate-700">
              {d.filename}
            </span>
          </div>
        ))}
        {docs.length > 6 ? (
          <p className="text-[10px] text-slate-500">+{docs.length - 6} more</p>
        ) : null}
      </div>
    </div>
  );
}

function activityIcon(kind: SpaceActivityEvent["kind"]) {
  switch (kind) {
    case "migration_completed":
      return <FileSpreadsheet size={10} className="text-emerald-600" />;
    case "documents_completed":
      return <FileText size={10} className="text-violet-600" />;
    case "schema_completed":
      return <Layers size={10} className="text-amber-600" />;
    case "work_order_completed":
      return <Wrench size={10} className="text-blue-600" />;
    default:
      return <MessageSquare size={10} className="text-slate-500" />;
  }
}

function SpaceActivityTimeline({
  spaceId,
  sessions,
  onSelectSession,
}: {
  spaceId: SavedSpaceId;
  sessions: DeepAgentSessionMeta[];
  onSelectSession: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // Re-derive on every render; cost is bounded by sessions in space (small).
  const events = loadSpaceActivityEvents(sessions, spaceId, showAll ? 30 : 6);
  if (events.length === 0) return null;
  return (
    <div className="mx-1 mt-2 mb-1 rounded-lg border border-slate-200 bg-white px-2 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Activity size={10} />
          Recent activity
        </span>
        {events.length >= 6 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[10px] text-slate-500 hover:text-slate-800"
          >
            {showAll ? "Show less" : "View more"}
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {events.map((event) => {
          const interactive = !!event.sessionId;
          const RowTag = interactive ? "button" : "div";
          return (
            <li key={event.id}>
              <RowTag
                type={interactive ? "button" : undefined}
                onClick={
                  interactive ? () => onSelectSession(event.sessionId!) : undefined
                }
                className={cn(
                  "w-full flex items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[10px]",
                  interactive ? "hover:bg-slate-50" : "",
                )}
              >
                <span className="mt-0.5 shrink-0">{activityIcon(event.kind)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-slate-700 truncate font-medium">{event.title}</span>
                  <span className="block text-slate-400">
                    {formatChatTimestamp(event.at)}
                    {event.detail ? ` · ${event.detail}` : ""}
                  </span>
                </span>
              </RowTag>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SpaceEmptyState({ spaceId }: { spaceId: SavedSpaceId }) {
  const def = spaceDef(spaceId);
  return (
    <div className="mx-1 my-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-2.5 py-3">
      <p className="text-[11px] font-medium text-slate-700">{def.emptyTitle}</p>
      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{def.emptyPrompt}</p>
    </div>
  );
}

/**
 * Entity-first overview shown at the top of every expanded space (push-back #3).
 *
 * Spec calls for Saved Space → Related entities → Workflows → Documents →
 * Chats (with chats as supporting context). The aggregator pulls counts
 * from the existing session metadata (workOrderIds / assetIds / vendorIds /
 * locationIds / migrationIds / documentIds + artifactCounts) — no new
 * persistence.
 */
function aggregateSpaceEntities(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
): {
  workOrderIds: string[];
  assetIds: string[];
  vendorIds: string[];
  locationIds: string[];
  migrationIds: string[];
  documentIds: string[];
  artifactCount: number;
} {
  const workOrderIds = new Set<string>();
  const assetIds = new Set<string>();
  const vendorIds = new Set<string>();
  const locationIds = new Set<string>();
  const migrationIds = new Set<string>();
  const documentIds = new Set<string>();
  let artifactCount = 0;
  for (const session of sessions) {
    const primary = effectiveSpace(session);
    const inSpace = primary === spaceId || (session.secondarySpaces ?? []).includes(spaceId);
    if (!inSpace) continue;
    for (const id of session.workOrderIds ?? []) workOrderIds.add(id);
    for (const id of session.assetIds ?? []) assetIds.add(id);
    for (const id of session.vendorIds ?? []) vendorIds.add(id);
    for (const id of session.locationIds ?? []) locationIds.add(id);
    for (const id of session.migrationIds ?? []) migrationIds.add(id);
    for (const id of session.documentIds ?? []) documentIds.add(id);
    artifactCount += session.artifactCounts?.[spaceId] ?? 0;
  }
  return {
    workOrderIds: [...workOrderIds],
    assetIds: [...assetIds],
    vendorIds: [...vendorIds],
    locationIds: [...locationIds],
    migrationIds: [...migrationIds],
    documentIds: [...documentIds],
    artifactCount,
  };
}

function SpaceEntityOverview({
  spaceId,
  sessions,
}: {
  spaceId: SavedSpaceId;
  sessions: DeepAgentSessionMeta[];
}) {
  const agg = aggregateSpaceEntities(sessions, spaceId);
  const entitySections: { icon: React.ReactNode; label: string; count: number; tone: string }[] = [];
  if (agg.workOrderIds.length) {
    entitySections.push({
      icon: <Wrench size={11} className="text-blue-600" />,
      label: agg.workOrderIds.length === 1 ? "work order" : "work orders",
      count: agg.workOrderIds.length,
      tone: "bg-blue-50 text-blue-700",
    });
  }
  if (agg.assetIds.length) {
    entitySections.push({
      icon: <Package size={11} className="text-cyan-700" />,
      label: agg.assetIds.length === 1 ? "asset" : "assets",
      count: agg.assetIds.length,
      tone: "bg-cyan-50 text-cyan-800",
    });
  }
  if (agg.locationIds.length) {
    entitySections.push({
      icon: <Building2 size={11} className="text-indigo-600" />,
      label: agg.locationIds.length === 1 ? "site" : "sites",
      count: agg.locationIds.length,
      tone: "bg-indigo-50 text-indigo-700",
    });
  }
  if (agg.vendorIds.length) {
    entitySections.push({
      icon: <Handshake size={11} className="text-amber-700" />,
      label: agg.vendorIds.length === 1 ? "vendor" : "vendors",
      count: agg.vendorIds.length,
      tone: "bg-amber-50 text-amber-800",
    });
  }

  // The "Workflows · documents" chips were duplicating data the user is
  // already seeing one section above in ACTIVE TASKS (in-flight workflows)
  // and DOCUMENTS (uploaded files). The entity overview now shows only the
  // related-entity pills that are NOT surfaced anywhere else in the space.

  if (entitySections.length === 0) {
    return null;
  }

  return (
    <div className="mx-1 my-2 rounded-lg border border-slate-200 bg-white px-2 py-2 space-y-2">
      <div className="space-y-1">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
          Related entities
        </div>
        <div className="flex flex-wrap gap-1">
          {entitySections.map((row, idx) => (
            <span
              key={idx}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                row.tone,
              )}
            >
              {row.icon}
              {row.count} {row.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A built-in workspace shown as an expandable accordion that lists its auto-tagged chats. */
function SpaceGroup({
  spaceId,
  sessions,
  activeId,
  activeSpace,
  customSpaces,
  sessionCount,
  artifactCount,
  open,
  onToggle,
  onSelectSpace,
  onSelectSession,
  onNewInSpace,
  onReassign,
  onAssignCustomSpace,
}: {
  spaceId: SavedSpaceId;
  sessions: DeepAgentSessionMeta[];
  activeId: string;
  activeSpace: SavedSpaceId;
  customSpaces: CustomSpace[];
  sessionCount: number;
  artifactCount: number;
  open: boolean;
  onToggle: () => void;
  onSelectSpace: (space: SavedSpaceId) => void;
  onSelectSession: (id: string) => void;
  onNewInSpace: (space: SavedSpaceId) => void;
  onReassign: (sessionId: string, space: SavedSpaceId | null) => void;
  onAssignCustomSpace: (sessionId: string, customId: string | null) => void;
}) {
  const def = spaceDef(spaceId);
  const sortByRecent = (a: DeepAgentSessionMeta, b: DeepAgentSessionMeta) =>
    b.updatedAt - a.updatedAt;
  const autoTagged = [...autoTaggedSessionsForSpace(sessions, spaceId)].sort(sortByRecent);
  const manuallyPlaced = [...manualSessionsForSpace(sessions, spaceId)].sort(sortByRecent);
  const hasAnySessions = autoTagged.length > 0 || manuallyPlaced.length > 0;
  const selected = activeSpace === spaceId;
  return (
    <div className="mb-0.5">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors",
          selected ? "bg-slate-100 text-slate-900" : "hover:bg-slate-100/60",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Collapse workspace" : "Expand workspace"}
          className="shrink-0 p-0.5 text-slate-400 hover:text-slate-700"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectSpace(spaceId);
            if (!open) onToggle();
          }}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          {SPACE_ICONS[spaceId]}
          <span className={cn("truncate text-xs font-medium", selected ? "text-slate-900" : "text-slate-700")}>
            {def.label}
          </span>
          <span className="ml-auto shrink-0">
            <SpaceCountBadge sessionCount={sessionCount} artifactCount={artifactCount} />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onNewInSpace(spaceId)}
          aria-label={`New chat in ${def.shortLabel}`}
          className="shrink-0 p-0.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-indigo-600"
        >
          <Plus size={13} />
        </button>
      </div>
      {open ? (
        <div className="ml-3 mt-0.5 border-l border-slate-100 pl-1.5 space-y-2">
          {/* Workspace ordering (push-back review):
              1. Active Tasks
              2. Saved UDR Scripts (UDR space only)
              3. Documents
              4. Activity Timeline
              5. Related Entities
              6. Historical Chats (supporting context, last) */}
          <SpaceActiveTasks spaceId={spaceId} sessions={sessions} />
          <SpaceSavedUdrScripts
            spaceId={spaceId}
            sessions={sessions}
            onSelectSession={onSelectSession}
          />
          <SpaceDocuments spaceId={spaceId} sessions={sessions} />
          <SpaceActivityTimeline
            spaceId={spaceId}
            sessions={sessions}
            onSelectSession={onSelectSession}
          />
          <SpaceEntityOverview spaceId={spaceId} sessions={sessions} />
          {!hasAnySessions ? (
            <SpaceEmptyState spaceId={spaceId} />
          ) : (
            <div className="pt-1 mt-1 border-t border-slate-100">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 px-1 mb-1">
                Historical chats
              </div>
              <SessionSubSection
                label="Auto tagged"
                emptyHint={manuallyPlaced.length > 0 ? "Nothing auto-classified here yet." : undefined}
                sessions={autoTagged}
                activeId={activeId}
                activeSpace={spaceId}
                customSpaces={customSpaces}
                onSelectSession={onSelectSession}
                onReassign={onReassign}
                onAssignCustomSpace={onAssignCustomSpace}
              />
              {manuallyPlaced.length > 0 ? (
                <SessionSubSection
                  label="General"
                  sessions={manuallyPlaced}
                  activeId={activeId}
                  activeSpace={spaceId}
                  customSpaces={customSpaces}
                  onSelectSession={onSelectSession}
                  onReassign={onReassign}
                  onAssignCustomSpace={onAssignCustomSpace}
                />
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SessionSubSection({
  label,
  emptyHint,
  sessions,
  activeId,
  activeSpace,
  customSpaces,
  onSelectSession,
  onReassign,
  onAssignCustomSpace,
}: {
  label: string;
  emptyHint?: string;
  sessions: DeepAgentSessionMeta[];
  activeId: string;
  activeSpace: SavedSpaceId;
  customSpaces: CustomSpace[];
  onSelectSession: (id: string) => void;
  onReassign: (sessionId: string, space: SavedSpaceId | null) => void;
  onAssignCustomSpace: (sessionId: string, customId: string | null) => void;
}) {
  return (
    <div>
      <div className="px-1 flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <span className="text-[9px] tabular-nums text-slate-400">{sessions.length}</span>
      </div>
      {sessions.length === 0 ? (
        emptyHint ? (
          <p className="px-1 pt-1 text-[10px] text-slate-400 leading-snug">{emptyHint}</p>
        ) : null
      ) : (
        <div className="mt-1 max-h-56 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              activeId={activeId}
              activeSpace={activeSpace}
              customSpaces={customSpaces}
              onSelect={onSelectSession}
              onReassign={onReassign}
              onAssignCustomSpace={onAssignCustomSpace}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** WP-3: dynamic customer-named spaces (parallel to the built-in spaces). */
function CustomSpacesSection({
  customSpaces,
  sessions,
  activeId,
  onSelectSession,
  onCreateCustomSpace,
  onDeleteCustomSpace,
}: {
  customSpaces: CustomSpace[];
  sessions: DeepAgentSessionMeta[];
  activeId: string;
  onSelectSession: (id: string) => void;
  onCreateCustomSpace: (name: string) => void;
  onDeleteCustomSpace: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  function submit() {
    const n = name.trim();
    if (!n) {
      setAdding(false);
      return;
    }
    onCreateCustomSpace(n);
    setName("");
    setAdding(false);
  }

  return (
    <div className="pt-2 mt-2 border-t border-slate-100">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
          Custom spaces
        </span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-0.5 text-[10px] text-cyan-700 hover:underline"
        >
          <Plus size={11} /> New space
        </button>
      </div>

      {adding ? (
        <div className="flex items-center gap-1 px-1 mb-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
            placeholder="e.g. Tower 3 certificates"
            className="flex-1 min-w-0 rounded border border-slate-300 px-1.5 py-1 text-[11px]"
          />
          <button type="button" onClick={submit} className="text-cyan-700" aria-label="Create space">
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setName("");
            }}
            className="text-slate-400"
            aria-label="Cancel"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}

      {customSpaces.length === 0 && !adding ? (
        <p className="text-[10px] text-muted-foreground px-1 leading-snug">
          Create a named space (a building, vendor, or certificate set) and move chats into it from
          a chat&apos;s ⋯ menu.
        </p>
      ) : null}

      {customSpaces.map((cs) => {
        const csSessions = sessions
          .filter((s) => s.customSpaceId === cs.id)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const open = expanded === cs.id;
        return (
          <div key={cs.id} className="mb-0.5">
            <div className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-slate-50">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : cs.id)}
                className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
              >
                {open ? (
                  <ChevronDown size={12} className="shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight size={12} className="shrink-0 text-slate-400" />
                )}
                <Folder size={13} className="shrink-0 text-cyan-600" />
                <span className="truncate text-[11px] font-medium text-slate-800">{cs.name}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                  {csSessions.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteCustomSpace(cs.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-600"
                aria-label="Delete space"
              >
                <Trash2 size={11} />
              </button>
            </div>
            {open ? (
              csSessions.length === 0 ? (
                <p className="ml-6 text-[10px] text-muted-foreground py-0.5">
                  No chats yet — open a chat&apos;s ⋯ menu → “{cs.name}”.
                </p>
              ) : (
                csSessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectSession(s.id)}
                    className={cn(
                      "ml-5 block w-[calc(100%-1.25rem)] rounded-md px-2 py-1 text-left text-[10px]",
                      s.id === activeId ? "bg-cyan-50 text-cyan-900" : "text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    <span className="truncate block">{s.title}</span>
                    <span className="text-slate-400">{formatChatTimestamp(s.updatedAt)}</span>
                  </button>
                ))
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function DeepAgentSavedSpacesPanel({
  sessions,
  activeId,
  activeSpace,
  customSpaces,
  onSelectSpace,
  onSelectSession,
  onNewInSpace,
  onReassignSession,
  onCreateCustomSpace,
  onDeleteCustomSpace,
  onAssignCustomSpace,
}: {
  sessions: DeepAgentSessionMeta[];
  activeId: string;
  activeSpace: SavedSpaceId;
  customSpaces: CustomSpace[];
  onSelectSpace: (space: SavedSpaceId) => void;
  onSelectSession: (id: string) => void;
  onNewInSpace: (space: SavedSpaceId) => void;
  onReassignSession: (sessionId: string, space: SavedSpaceId | null) => void;
  onCreateCustomSpace: (name: string) => void;
  onDeleteCustomSpace: (id: string) => void;
  onAssignCustomSpace: (sessionId: string, customId: string | null) => void;
}) {
  const [chatsExpanded, setChatsExpanded] = useState(false);
  const [expandedSpaces, setExpandedSpaces] = useState<Set<SavedSpaceId>>(
    () => new Set([activeSpace]),
  );
  const sessionCounts = countSessionsBySpace(sessions);
  const artifactSums = sumArtifactsBySpace(sessions);
  const allChatsSorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  // Keep the currently-selected workspace expanded (e.g. after an upload auto-switches space).
  useEffect(() => {
    setExpandedSpaces((prev) => (prev.has(activeSpace) ? prev : new Set(prev).add(activeSpace)));
  }, [activeSpace]);

  const toggleSpace = (id: SavedSpaceId) =>
    setExpandedSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside
      aria-label="Saved chat spaces"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="shrink-0 px-2 pt-2 pb-3">
        <button
          type="button"
          onClick={() => onNewInSpace("general")}
          title="Start a new chat (auto-tags to a workspace once it's classified)"
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[12px] font-medium text-white hover:bg-slate-800 transition-colors"
        >
          <Plus size={13} /> New chat
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-2 space-y-0.5">
        {GROUP_ORDER.map((spaceId) => (
          <SpaceGroup
            key={spaceId}
            spaceId={spaceId}
            sessions={sessions}
            activeId={activeId}
            activeSpace={activeSpace}
            customSpaces={customSpaces}
            sessionCount={sessionCounts[spaceId] ?? 0}
            artifactCount={artifactSums[spaceId] ?? 0}
            open={expandedSpaces.has(spaceId)}
            onToggle={() => toggleSpace(spaceId)}
            onSelectSpace={onSelectSpace}
            onSelectSession={onSelectSession}
            onNewInSpace={onNewInSpace}
            onReassign={onReassignSession}
            onAssignCustomSpace={onAssignCustomSpace}
          />
        ))}

        <CustomSpacesSection
          customSpaces={customSpaces}
          sessions={sessions}
          activeId={activeId}
          onSelectSession={onSelectSession}
          onCreateCustomSpace={onCreateCustomSpace}
          onDeleteCustomSpace={onDeleteCustomSpace}
        />
      </div>

      <div className="shrink-0 px-1 pb-2 pt-1.5">
        <button
          type="button"
          onClick={() => setChatsExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100/60 transition-colors"
        >
          {chatsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <MessageSquare size={12} />
          All chats ({sessions.length})
        </button>
        {chatsExpanded ? (
          <div className="mt-1 max-h-40 overflow-y-auto space-y-0.5 pl-1">
            {allChatsSorted.length === 0 ? (
              <p className="text-[10px] text-slate-400 px-1 py-1">No chats yet.</p>
            ) : (
              allChatsSorted.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectSession(s.id)}
                  className={cn(
                    "w-full rounded-md px-2 py-1 text-left text-[10px] transition-colors",
                    s.id === activeId ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-100/60",
                  )}
                >
                  <span className="truncate block">{s.title}</span>
                  <span className="text-slate-400 flex gap-1">
                    {formatChatTimestamp(s.updatedAt)}
                    <span>· {spaceDef(effectiveSpace(s)).shortLabel}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
