import type { ToolCallRecord, WorkflowResponse } from "@/features/ai/deep-agents-api";

import type { DeepAgentSessionMeta } from "./deep-agent-sessions";
import { orchestratorHref } from "./orchestrator-space-params";

/** FM-facing saved spaces (primary LHS navigation). Chats are secondary. */
export type SavedSpaceId =
  | "work_orders"
  | "assets"
  | "sites"
  | "vendors"
  | "certificates"
  | "documents"
  | "udr"
  | "migration"
  | "schema"
  | "compliance"
  | "general";

/** Reserved for future sub-space / tag UI (PM, compliance docs, etc.). */
export type SpaceTag =
  | "pm_schedule"
  | "compliance_doc"
  | "asset_query"
  | "vendor"
  | "uncategorized";

export type SavedSpaceDef = {
  id: SavedSpaceId;
  label: string;
  shortLabel: string;
  description: string;
  emptyTitle: string;
  emptyPrompt: string;
  /** Ops UI deep-link where applicable */
  href?: string;
};

export const ARTIFACT_HINT_MAX_LEN = 36;
export const ARTIFACT_ID_SLICE = 8;

export type SpaceClassification = {
  primarySpace: SavedSpaceId;
  secondarySpaces: SavedSpaceId[];
  /** 0–1 confidence in primarySpace from accumulated signals */
  confidence: number;
  spaceWeights: Partial<Record<SavedSpaceId, number>>;
  spaceTags: SpaceTag[];
};

export const SAVED_SPACES: SavedSpaceDef[] = [
  {
    id: "work_orders",
    label: "Work orders",
    shortLabel: "WO",
    description: "Create, triage, approve, and track work orders",
    emptyTitle: "No work order runs yet",
    emptyPrompt: "Describe a repair, dispatch, or approval — e.g. urgent HVAC at Building A.",
    href: orchestratorHref("work_orders"),
  },
  {
    id: "assets",
    label: "Assets",
    shortLabel: "Assets",
    description: "Asset register, health, lifecycle",
    emptyTitle: "No asset chats yet",
    emptyPrompt: "Ask about an asset, its history, or its compliance state.",
    href: "/assets",
  },
  {
    id: "sites",
    label: "Sites",
    shortLabel: "Sites",
    description: "Buildings, floors, locations",
    emptyTitle: "No site chats yet",
    emptyPrompt: "Ask about a site or location — its assets, work orders, or compliance state.",
    href: "/locations",
  },
  {
    id: "vendors",
    label: "Vendors",
    shortLabel: "Vendors",
    description: "Suppliers, contracts, performance",
    emptyTitle: "No vendor chats yet",
    emptyPrompt: "Ask about a vendor's coverage, contracts, or completed work.",
    href: "/vendors",
  },
  {
    id: "certificates",
    label: "Certificates",
    shortLabel: "Certs",
    description: "Warranties, certifications, expiry",
    emptyTitle: "No certificate chats yet",
    emptyPrompt: "Upload a certificate or ask about coverage and expiry.",
  },
  {
    id: "documents",
    label: "Documents",
    shortLabel: "Docs",
    description: "Certificates, warranties, readings, PDFs — Doc RAG",
    emptyTitle: "No document runs yet",
    emptyPrompt: "Attach a certificate or warranty PDF, or ask to index documents for search.",
    href: orchestratorHref("documents"),
  },
  {
    id: "udr",
    label: "Unified Data Register",
    shortLabel: "UDR",
    description: "Ingest files, export CMMS data, mapping & hierarchy",
    emptyTitle: "No UDR runs yet",
    emptyPrompt: "Ingest files, export CMMS data, or run UDR mapping on your dataset.",
    href: orchestratorHref("udr"),
  },
  {
    id: "migration",
    label: "Migration",
    shortLabel: "Mig",
    description: "CSV/Excel structured ingest → plenum_cafm",
    emptyTitle: "No migration runs yet",
    emptyPrompt: "Attach a CSV or Excel workbook to start structured migration ingest.",
    href: orchestratorHref("migration"),
  },
  {
    id: "schema",
    label: "Live CMMS",
    shortLabel: "CMMS",
    description: "Fiix / external CMMS → plenum_cafm",
    emptyTitle: "No live CMMS runs yet",
    emptyPrompt: "Connect Fiix and start live schema mapping into plenum_cafm.",
    href: orchestratorHref("schema"),
  },
  {
    id: "compliance",
    label: "Compliance",
    shortLabel: "Compliance",
    description: "PM risk, overdue maintenance, compliance gaps",
    emptyTitle: "No compliance runs yet",
    emptyPrompt: "Ask which assets are at risk, overdue PM, or compliance gaps.",
    href: "/assets",
  },
  {
    id: "general",
    label: "General",
    shortLabel: "All",
    description: "Cross-domain queries and briefings",
    emptyTitle: "No general runs yet",
    emptyPrompt: "Ask for an ops briefing or any cross-domain question.",
  },
];

const SPACE_ORDER: SavedSpaceId[] = [
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

const PRIMARY_LHS_SPACES: SavedSpaceId[] = [
  "work_orders",
  "assets",
  "sites",
  "vendors",
  "certificates",
  "documents",
  "udr",
  "migration",
  "compliance",
];

const TOOL_SPACE: Record<string, SavedSpaceId> = {
  create_work_order: "work_orders",
  create_intelligent_work_order: "work_orders",
  get_work_order: "work_orders",
  list_work_orders: "work_orders",
  suggest_approval_chain: "work_orders",
  process_approval: "work_orders",
  // Assets
  get_asset: "assets",
  list_assets: "assets",
  search_assets: "assets",
  update_asset: "assets",
  // Sites / locations
  get_location: "sites",
  list_locations: "sites",
  search_locations: "sites",
  get_site: "sites",
  list_sites: "sites",
  // Vendors
  get_vendor: "vendors",
  list_vendors: "vendors",
  search_vendors: "vendors",
  get_vendor_contracts: "vendors",
  // Certificates
  list_certificates: "certificates",
  get_certificate: "certificates",
  check_certificate_expiry: "certificates",
  // Documents / RAG
  index_document: "documents",
  query_documents: "documents",
  match_document_rows: "documents",
  start_migration: "migration",
  run_migration: "migration",
  submit_pre_semantic: "migration",
  submit_field_mapping: "migration",
  configure_fiix_credentials: "schema",
  test_fiix_connection: "schema",
  fetch_fiix_schema: "schema",
  start_fiix_schema_mapping: "schema",
  get_schema_mapping_status: "schema",
  continue_schema_mapping_gate: "schema",
  start_fiix_ingestion: "schema",
  run_udr_mapping: "udr",
  ingest_udr_batch: "udr",
  check_compliance: "compliance",
  get_asset_compliance: "compliance",
};

const ROUTE_INTENT_SPACE: Record<string, SavedSpaceId> = {
  wo_intake_or_create: "work_orders",
  wo_clarify_candidate: "work_orders",
  udr_ingest_documents: "udr",
  udr_run_mapping_hierarchy: "udr",
  fiix_sync: "schema",
  bulk_ingest: "migration",
  general_query: "general",
};

export function savedSpaceForTool(tool: string): SavedSpaceId | null {
  return TOOL_SPACE[tool] ?? null;
}

export function savedSpaceForRouteIntent(intent: string): SavedSpaceId | null {
  return ROUTE_INTENT_SPACE[intent] ?? null;
}

const DOMAIN_SPACE: Record<string, SavedSpaceId> = {
  wo_engine: "work_orders",
  work_order: "work_orders",
  doc_rag: "documents",
  migration: "migration",
  fiix: "schema",
  udr: "udr",
  compliance: "compliance",
};

const SIGNAL_WEIGHT = {
  tool: 4,
  route: 6,
  domain: 3,
  userText: 2,
} as const;

const SECONDARY_THRESHOLD_RATIO = 0.45;

export function spaceDef(id: SavedSpaceId): SavedSpaceDef {
  return SAVED_SPACES.find((s) => s.id === id) ?? SAVED_SPACES[SAVED_SPACES.length - 1];
}

export function orderedSpaces(): SavedSpaceDef[] {
  return SPACE_ORDER.map((id) => spaceDef(id));
}

/** Spaces shown in primary LHS list (excludes schema + general from top nav). */
export function primaryNavSpaces(): SavedSpaceDef[] {
  return PRIMARY_LHS_SPACES.map((id) => spaceDef(id));
}

export function isSavedSpaceId(value: string): value is SavedSpaceId {
  return SPACE_ORDER.includes(value as SavedSpaceId);
}

/** Option A: backend saved_space is canonical primary; keep frontend secondarySpaces from prior. */
export function classificationWithBackendAnchor(
  backendSpace: SavedSpaceId,
  prior: SpaceClassification | null,
): SpaceClassification {
  const secondarySpaces = (prior?.secondarySpaces ?? []).filter((s) => s !== backendSpace);
  return {
    primarySpace: backendSpace,
    secondarySpaces,
    confidence: 1,
    spaceWeights: { ...prior?.spaceWeights, [backendSpace]: 100 },
    spaceTags: prior?.spaceTags ?? [],
  };
}

function addWeight(
  weights: Partial<Record<SavedSpaceId, number>>,
  space: SavedSpaceId,
  amount: number,
) {
  weights[space] = (weights[space] ?? 0) + amount;
}

function emptyWeights(): Partial<Record<SavedSpaceId, number>> {
  return Object.fromEntries(SPACE_ORDER.map((id) => [id, 0])) as Partial<Record<SavedSpaceId, number>>;
}

function weightsFromToolCalls(toolCalls: ToolCallRecord[]): Partial<Record<SavedSpaceId, number>> {
  const w = emptyWeights();
  for (const tc of toolCalls) {
    const space = TOOL_SPACE[tc.tool];
    if (space) addWeight(w, space, SIGNAL_WEIGHT.tool);
  }
  return w;
}

function weightsFromRoute(routeIntent?: string | null, domain?: string | null): Partial<Record<SavedSpaceId, number>> {
  const w = emptyWeights();
  const ri = (routeIntent ?? "").toLowerCase();
  if (ri && ROUTE_INTENT_SPACE[ri]) addWeight(w, ROUTE_INTENT_SPACE[ri], SIGNAL_WEIGHT.route);
  const d = (domain ?? "").toLowerCase();
  if (d && DOMAIN_SPACE[d]) addWeight(w, DOMAIN_SPACE[d], SIGNAL_WEIGHT.domain);
  return w;
}

function weightsFromUserMessage(text: string): Partial<Record<SavedSpaceId, number>> {
  const w = emptyWeights();
  const hit = classifySpaceFromUserMessage(text);
  if (hit) addWeight(w, hit, SIGNAL_WEIGHT.userText);
  return w;
}

function mergeWeights(
  ...parts: Partial<Record<SavedSpaceId, number>>[]
): Partial<Record<SavedSpaceId, number>> {
  const out = emptyWeights();
  for (const part of parts) {
    for (const id of SPACE_ORDER) {
      out[id] = (out[id] ?? 0) + (part[id] ?? 0);
    }
  }
  return out;
}

function resolvePrimaryAndSecondary(
  weights: Partial<Record<SavedSpaceId, number>>,
): Pick<SpaceClassification, "primarySpace" | "secondarySpaces" | "confidence"> {
  const ranked = SPACE_ORDER.map((id) => ({ id, score: weights[id] ?? 0 }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return { primarySpace: "general", secondarySpaces: [], confidence: 0 };
  }

  const top = ranked[0];
  const maxScore = top.score;
  const secondarySpaces = ranked
    .slice(1)
    .filter((r) => r.score >= maxScore * SECONDARY_THRESHOLD_RATIO)
    .map((r) => r.id);

  const total = ranked.reduce((s, r) => s + r.score, 0);
  const confidence = total > 0 ? Math.min(1, maxScore / total) : 0;

  return {
    primarySpace: top.id,
    secondarySpaces,
    confidence: Math.round(confidence * 100) / 100,
  };
}

export function classifySignalsFromResponse(res: WorkflowResponse): Partial<Record<SavedSpaceId, number>> {
  return mergeWeights(
    weightsFromToolCalls(res.tool_calls ?? []),
    weightsFromRoute(res.route_metadata?.route_intent, res.route_metadata?.selected_domain),
  );
}

export function classifySignalsFromUserMessage(text: string): Partial<Record<SavedSpaceId, number>> {
  return weightsFromUserMessage(text);
}

const FILE_EXT_SPACE: Array<{ re: RegExp; space: SavedSpaceId }> = [
  { re: /\.(csv|xlsx|xls|xlsm)$/i, space: "migration" },
  { re: /\.(pdf|docx?|txt|png|jpe?g|webp|tiff?|gif)$/i, space: "documents" },
  { re: /\.(ya?ml|json)$/i, space: "schema" },
];

/**
 * Strong, deterministic signal from attached file extensions. Counted as a tool-equivalent
 * signal because file kind is a hard intent — xlsx ⇒ migration, pdf ⇒ documents, yaml ⇒ schema.
 */
export function classifySignalsFromAttachments(files: File[] | undefined): Partial<Record<SavedSpaceId, number>> {
  const w = emptyWeights();
  if (!files?.length) return w;
  const seen = new Set<SavedSpaceId>();
  for (const f of files) {
    for (const { re, space } of FILE_EXT_SPACE) {
      if (!re.test(f.name)) continue;
      seen.add(space);
      break;
    }
  }
  for (const space of seen) addWeight(w, space, SIGNAL_WEIGHT.tool);
  return w;
}

/**
 * When the user explicitly picks an intent chip (or a pinned run), the forced route is
 * the strongest possible signal — weighted like a backend-confirmed route.
 */
export function classifySignalsFromForcedRoute(forcedRoute: string | undefined): Partial<Record<SavedSpaceId, number>> {
  const w = emptyWeights();
  if (!forcedRoute) return w;
  const ri = forcedRoute.toLowerCase();
  const space = ROUTE_INTENT_SPACE[ri];
  if (space) addWeight(w, space, SIGNAL_WEIGHT.route);
  return w;
}

/**
 * Explicit user-facing space picked at the call site (intent chip, pinned run,
 * domain panel button). Strongest possible signal — dominant by design — because
 * routes alone are ambiguous (e.g. udr_ingest_documents is used by both the
 * "Word/PDF" chip [user intent = documents] and the UDR panel [user intent = udr]).
 */
export function classifySignalsFromIntentSpace(space: SavedSpaceId | undefined): Partial<Record<SavedSpaceId, number>> {
  const w = emptyWeights();
  if (!space || space === "general") return w;
  addWeight(w, space, SIGNAL_WEIGHT.route + SIGNAL_WEIGHT.tool);
  return w;
}

/** Full classification from one orchestrator turn (merged with prior session weights). */
export function classifySessionFromSignals(
  prior: Partial<Record<SavedSpaceId, number>> | undefined,
  ...signalBatches: Partial<Record<SavedSpaceId, number>>[]
): SpaceClassification {
  const spaceWeights = mergeWeights(prior ?? emptyWeights(), ...signalBatches);
  const { primarySpace, secondarySpaces, confidence } = resolvePrimaryAndSecondary(spaceWeights);
  const spaceTags: SpaceTag[] =
    confidence < 0.35 && primarySpace === "general" ? ["uncategorized"] : [];
  return { primarySpace, secondarySpaces, confidence, spaceWeights, spaceTags };
}

export function classifySpaceFromUserMessage(text: string): SavedSpaceId | null {
  const m = text.toLowerCase();
  if (/\b(work order|wo-|approve|technician dispatch|hvac repair)\b/.test(m)) return "work_orders";
  if (/\b(certificate|warranty|pdf|document|doc rag|index.*doc)\b/.test(m)) return "documents";
  if (/\b(udr|unified data|export cmms|ingest file|data register)\b/.test(m)) return "udr";
  if (/\b(migration|csv|xlsx|excel|spreadsheet)\b/.test(m)) return "migration";
  if (/\b(fiix|schema mapping|plenum_cafm|cmms schema)\b/.test(m)) return "schema";
  if (/\b(compliance|asset|pm overdue|preventive)\b/.test(m)) return "compliance";
  return null;
}

/** Canonical bucket for LHS (manual override wins). */
export function effectiveSpace(session: DeepAgentSessionMeta): SavedSpaceId {
  return session.userOverrideSpace ?? session.primarySpace ?? session.space ?? "general";
}

export function sessionBelongsToSpace(session: DeepAgentSessionMeta, spaceId: SavedSpaceId): boolean {
  if (effectiveSpace(session) === spaceId) return true;
  return (session.secondarySpaces ?? []).includes(spaceId);
}

export function truncateArtifactToken(value: string, maxLen = ARTIFACT_ID_SLICE): string {
  const t = value.trim();
  if (!t) return "";
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/** Format: `{Type} · {token}` — token from artifact id/title, max 36 chars total. */
export function formatArtifactHint(typeLabel: string, token: string): string {
  const id = truncateArtifactToken(token, ARTIFACT_ID_SLICE);
  if (!id) return "";
  const raw = `${typeLabel} · ${id}`;
  return raw.length > ARTIFACT_HINT_MAX_LEN ? `${raw.slice(0, ARTIFACT_HINT_MAX_LEN - 1)}…` : raw;
}

/** Tool output considered successful (no error / explicit failure). */
export function isSuccessfulToolOutput(output: unknown): boolean {
  if (output == null) return false;
  if (typeof output !== "object" || Array.isArray(output)) return false;
  const out = output as Record<string, unknown>;
  if (out.error != null && String(out.error).trim()) return false;
  if (out.success === false) return false;
  if (out.status === "failed" || out.status === "error") return false;
  return true;
}

function artifactIdFromToolOutput(
  tool: string,
  out: Record<string, unknown>,
): string | null {
  if (!isSuccessfulToolOutput(out)) return null;
  if (tool === "start_migration" || tool === "start_fiix_schema_mapping") {
    const id = String(out.schema_mapping_id ?? out.migration_id ?? "").trim();
    return id || null;
  }
  if (tool === "index_document") {
    const id = String(out.document_id ?? out.doc_id ?? out.id ?? "").trim();
    return id || null;
  }
  if (
    (tool === "create_work_order" || tool === "create_intelligent_work_order") &&
    typeof out.work_order_id === "string"
  ) {
    return out.work_order_id.trim() || null;
  }
  if (tool === "run_udr_mapping" || tool === "ingest_udr_batch") {
    const batch = String(out.batch_id ?? out.job_id ?? "").trim();
    return batch || null;
  }
  return null;
}

export function artifactHintFromResponse(res: WorkflowResponse): string | undefined {
  if (res.ingested_document_ids?.length) {
    return formatArtifactHint("Doc", res.ingested_document_ids[0]);
  }
  const tools = res.tool_calls ?? [];
  for (let i = tools.length - 1; i >= 0; i--) {
    const tc = tools[i];
    const out = tc.output as Record<string, unknown> | null | undefined;
    if (!out || typeof out !== "object") continue;
    const id = artifactIdFromToolOutput(tc.tool, out);
    if (!id) continue;
    if (tc.tool === "start_migration" || tc.tool === "start_fiix_schema_mapping") {
      return formatArtifactHint(tc.tool.includes("fiix") ? "Fiix map" : "Migration", id);
    }
    if (tc.tool === "index_document") return formatArtifactHint("Doc", id);
    if (tc.tool === "create_work_order" || tc.tool === "create_intelligent_work_order") {
      return formatArtifactHint("WO", id);
    }
    if (tc.tool === "run_udr_mapping" || tc.tool === "ingest_udr_batch") {
      return formatArtifactHint("UDR", id);
    }
  }
  return undefined;
}

export function countArtifactsFromResponse(res: WorkflowResponse): Partial<Record<SavedSpaceId, number>> {
  const counts: Partial<Record<SavedSpaceId, number>> = {};
  for (const tc of res.tool_calls ?? []) {
    const space = TOOL_SPACE[tc.tool];
    if (!space) continue;
    const out = tc.output as Record<string, unknown> | null | undefined;
    if (!out || typeof out !== "object") continue;
    if (!artifactIdFromToolOutput(tc.tool, out)) continue;
    counts[space] = (counts[space] ?? 0) + 1;
  }
  return counts;
}

export function mergeSessionClassification(
  session: DeepAgentSessionMeta,
  classification: SpaceClassification,
  opts?: { artifactHint?: string; artifactDelta?: Partial<Record<SavedSpaceId, number>> },
): DeepAgentSessionMeta {
  const effective = session.userOverrideSpace ?? classification.primarySpace;
  const artifactCounts = { ...(session.artifactCounts ?? {}) };
  if (opts?.artifactDelta) {
    for (const [k, v] of Object.entries(opts.artifactDelta)) {
      const id = k as SavedSpaceId;
      if (v) artifactCounts[id] = (artifactCounts[id] ?? 0) + v;
    }
  }
  return {
    ...session,
    primarySpace: classification.primarySpace,
    secondarySpaces: classification.secondarySpaces,
    classificationConfidence: classification.confidence,
    spaceWeights: classification.spaceWeights,
    spaceTags: classification.spaceTags.length
      ? classification.spaceTags
      : session.spaceTags,
    space: effective,
    artifactHint: opts && "artifactHint" in (opts ?? {}) ? opts.artifactHint : session.artifactHint,
    artifactCounts: Object.keys(artifactCounts).length ? artifactCounts : session.artifactCounts,
    updatedAt: Date.now(),
  };
}

export function setSessionSpaceOverride(
  session: DeepAgentSessionMeta,
  space: SavedSpaceId | null,
): DeepAgentSessionMeta {
  if (!space) {
    const { userOverrideSpace: _o, ...rest } = session;
    return {
      ...rest,
      space: session.primarySpace ?? session.space ?? "general",
      updatedAt: Date.now(),
    };
  }
  return {
    ...session,
    userOverrideSpace: space,
    space,
    updatedAt: Date.now(),
  };
}

export function sessionsForSpace(sessions: DeepAgentSessionMeta[], spaceId: SavedSpaceId): DeepAgentSessionMeta[] {
  return sessions.filter((s) => sessionBelongsToSpace(s, spaceId));
}

/**
 * Sessions auto-classified into this space (primary or secondary) and NOT manually
 * placed here. Drives the "Auto tagged" sub-section.
 */
export function autoTaggedSessionsForSpace(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
): DeepAgentSessionMeta[] {
  return sessions.filter((s) => {
    if (s.userOverrideSpace === spaceId) return false;
    if (s.primarySpace === spaceId) return true;
    if ((s.secondarySpaces ?? []).includes(spaceId)) return true;
    // Legacy/back-fill sessions may only have `space` populated.
    if (!s.primarySpace && !s.userOverrideSpace && s.space === spaceId) return true;
    return false;
  });
}

/**
 * Sessions manually placed into this space by the user (override wins).
 * Drives the "General" / manually-placed sub-section.
 */
export function manualSessionsForSpace(
  sessions: DeepAgentSessionMeta[],
  spaceId: SavedSpaceId,
): DeepAgentSessionMeta[] {
  return sessions.filter((s) => s.userOverrideSpace === spaceId);
}

/** Session counts per space (a session may increment multiple spaces if multi-domain). */
export function countSessionsBySpace(sessions: DeepAgentSessionMeta[]): Record<SavedSpaceId, number> {
  const counts = Object.fromEntries(SPACE_ORDER.map((id) => [id, 0])) as Record<SavedSpaceId, number>;
  for (const s of sessions) {
    const seen = new Set<SavedSpaceId>();
    const primary = effectiveSpace(s);
    seen.add(primary);
    counts[primary] = (counts[primary] ?? 0) + 1;
    for (const sec of s.secondarySpaces ?? []) {
      if (seen.has(sec)) continue;
      seen.add(sec);
      counts[sec] = (counts[sec] ?? 0) + 1;
    }
  }
  return counts;
}

export function sumArtifactsBySpace(sessions: DeepAgentSessionMeta[]): Record<SavedSpaceId, number> {
  const sums = Object.fromEntries(SPACE_ORDER.map((id) => [id, 0])) as Record<SavedSpaceId, number>;
  for (const s of sessions) {
    for (const [k, v] of Object.entries(s.artifactCounts ?? {})) {
      const id = k as SavedSpaceId;
      sums[id] = (sums[id] ?? 0) + (v ?? 0);
    }
  }
  return sums;
}

/** Weak back-fill for v1 sessions (title-only). */
export function migrateLegacySessionMeta(raw: DeepAgentSessionMeta): DeepAgentSessionMeta {
  if (raw.primarySpace && raw.spaceWeights) return raw;

  const title = raw.title ?? "";
  const hint = classifySpaceFromUserMessage(title);
  const weights = emptyWeights();
  if (hint) addWeight(weights, hint, 1);
  else addWeight(weights, "general", 1);

  const { primarySpace, secondarySpaces, confidence } = resolvePrimaryAndSecondary(weights);
  const spaceTags: SpaceTag[] = hint ? [] : ["uncategorized"];

  return {
    ...raw,
    primarySpace,
    secondarySpaces,
    classificationConfidence: hint ? confidence : 0.2,
    spaceWeights: weights,
    spaceTags,
    space: raw.userOverrideSpace ?? primarySpace,
    artifactHint: raw.artifactHint,
    migratedFromV1: !raw.primarySpace,
  };
}

/** @deprecated Use classifySessionFromSignals + mergeSessionClassification */
export function classifySpaceFromResponse(res: WorkflowResponse): SavedSpaceId {
  return classifySessionFromSignals(undefined, classifySignalsFromResponse(res)).primarySpace;
}

/** @deprecated Use mergeSessionClassification */
export function mergeSessionSpace(
  session: DeepAgentSessionMeta,
  nextSpace: SavedSpaceId,
  artifactHint?: string,
): DeepAgentSessionMeta {
  const classification = classifySessionFromSignals(session.spaceWeights, {
    [nextSpace]: (session.spaceWeights?.[nextSpace] ?? 0) + 5,
  });
  return mergeSessionClassification(session, classification, { artifactHint });
}
