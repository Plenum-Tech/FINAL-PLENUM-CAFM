"use client";

import { buildUdrHierarchyPrompt } from "./plenum-target-hierarchy";
import type { SavedSpaceId } from "./deep-agent-spaces";
import type { UdrForcedRoute } from "./udr-route-context";

const UDR_HIERARCHY_PROMPT = buildUdrHierarchyPrompt();

export type PinnedRun = {
  id: string;
  label: string;
  prompt: string;
  space: SavedSpaceId;
  domain: string;
  /** Bypass orchestrator keyword routing when sent via sendMessage. */
  forcedRoute?: UdrForcedRoute;
  /** User-created pin */
  isCustom?: boolean;
};

export const PINNED_RUNS_CATALOG: PinnedRun[] = [
  {
    id: "wo_briefing",
    label: "Ops briefing",
    prompt:
      "Morning ops briefing: critical work orders, today's PM, zero-stock parts, and compliance rate.",
    space: "work_orders",
    domain: "wo_engine",
  },
  {
    id: "wo_urgent",
    label: "Urgent WOs",
    prompt: "List open work orders with urgent or critical priority.",
    space: "work_orders",
    domain: "wo_engine",
  },
  {
    id: "doc_index",
    label: "Index documents",
    prompt: "I will attach certificates or warranty PDFs — index them for Doc RAG and summarize what was extracted.",
    space: "documents",
    domain: "doc_rag",
  },
  {
    id: "udr_ingest",
    label: "Ingest files (UDR)",
    prompt: "Ingest the attached files into the Unified Data Register and report batch status.",
    space: "udr",
    domain: "udr",
    forcedRoute: "udr_ingest_documents",
  },
  {
    id: "udr_export",
    label: "Export CMMS data",
    prompt: "Export CMMS data for UDR processing — summarize available tables and row counts.",
    space: "udr",
    domain: "udr",
  },
  {
    id: "udr_run",
    label: "Run UDR",
    prompt: `${UDR_HIERARCHY_PROMPT} Run UDR mapping and hierarchy detection on the latest ingested dataset.`,
    space: "udr",
    domain: "udr",
    forcedRoute: "udr_run_mapping_hierarchy",
  },
  {
    id: "udr_rerun_mapping",
    label: "Re-run mapping",
    prompt: `${UDR_HIERARCHY_PROMPT} Re-run deterministic and semantic mapping on the saved UDR script.`,
    space: "udr",
    domain: "udr",
    forcedRoute: "udr_run_mapping_hierarchy",
  },
  {
    id: "udr_rerun_hierarchy",
    label: "Re-run hierarchy",
    prompt: `${UDR_HIERARCHY_PROMPT} Re-run hierarchy detection on current UDR mappings.`,
    space: "udr",
    domain: "udr",
    forcedRoute: "udr_run_mapping_hierarchy",
  },
  {
    id: "mig_upload",
    label: "Migration ingest",
    prompt: "I will attach a CSV or Excel workbook — start structured migration ingest for all sheets.",
    space: "migration",
    domain: "migration",
  },
  {
    id: "schema_fiix",
    label: "Fiix schema map",
    prompt: "I want to fetch live Fiix schema and start schema mapping into plenum_cafm.",
    space: "schema",
    domain: "fiix",
  },
  {
    id: "compliance_asset",
    label: "Asset compliance",
    prompt: "Which assets are most at risk — overdue PM, critical work orders, and compliance gaps?",
    space: "compliance",
    domain: "compliance",
  },
];

const CUSTOM_PINS_KEY = "plenum_deep_agent_custom_pins_v1";
const MAX_VISIBLE_PINS = 5;
const MAX_CUSTOM_PINS = 5;

export { MAX_CUSTOM_PINS };

function nextCustomId(existingIds: Set<string>): string {
  let attempt = `custom_${Date.now()}`;
  let suffix = 0;
  while (existingIds.has(attempt)) {
    suffix += 1;
    attempt = `custom_${Date.now()}_${suffix}`;
  }
  return attempt;
}

function labelFromPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

export function loadCustomPins(): PinnedRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_PINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PinnedRun[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p?.prompt?.trim() && p.id && p.label)
      .slice(0, MAX_CUSTOM_PINS)
      .map((p) => ({ ...p, isCustom: true }));
  } catch {
    return [];
  }
}

export function saveCustomPins(pins: PinnedRun[]) {
  if (typeof window === "undefined") return;
  try {
    const custom = pins.filter((p) => p.isCustom).slice(0, MAX_CUSTOM_PINS);
    window.localStorage.setItem(CUSTOM_PINS_KEY, JSON.stringify(custom));
  } catch {
    /* ignore */
  }
}

export function addCustomPin(prompt: string, space: SavedSpaceId, label?: string): PinnedRun {
  const trimmed = prompt.trim();
  const existing = loadCustomPins().filter((p) => p.prompt !== trimmed);
  const ids = new Set(existing.map((p) => p.id));
  const pin: PinnedRun = {
    id: nextCustomId(ids),
    label: (label?.trim() || "").slice(0, 64) || labelFromPrompt(trimmed),
    prompt: trimmed,
    space,
    domain: "meta",
    isCustom: true,
  };
  const next = [pin, ...existing].slice(0, MAX_CUSTOM_PINS);
  saveCustomPins(next);
  return pin;
}

export type CustomPinEdit = {
  label?: string;
  prompt?: string;
  space?: SavedSpaceId;
};

/** Edit a custom pin in place. Returns the updated list, persists, and is a no-op for unknown ids. */
export function editCustomPin(id: string, edit: CustomPinEdit): PinnedRun[] {
  const current = loadCustomPins();
  let mutated = false;
  const next = current.map((p) => {
    if (p.id !== id) return p;
    const promptNext = edit.prompt?.trim() || p.prompt;
    const labelNext = (edit.label?.trim() || "").slice(0, 64) || (edit.prompt ? labelFromPrompt(promptNext) : p.label);
    const spaceNext = edit.space ?? p.space;
    if (promptNext === p.prompt && labelNext === p.label && spaceNext === p.space) return p;
    mutated = true;
    return { ...p, prompt: promptNext, label: labelNext, space: spaceNext };
  });
  if (mutated) saveCustomPins(next);
  return next;
}

/** Reorder custom pins to match the given id sequence. Ids not in `orderedIds` keep their relative order at the tail. */
export function reorderCustomPins(orderedIds: string[]): PinnedRun[] {
  const current = loadCustomPins();
  const byId = new Map(current.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const ordered: PinnedRun[] = [];
  for (const id of orderedIds) {
    const pin = byId.get(id);
    if (pin && !seen.has(id)) {
      ordered.push(pin);
      seen.add(id);
    }
  }
  for (const pin of current) {
    if (!seen.has(pin.id)) ordered.push(pin);
  }
  saveCustomPins(ordered);
  return ordered;
}

export type PinSelectionContext = {
  activeSpace: SavedSpaceId;
  lastDomain?: string;
  lastRouteIntent?: string;
  hasMigration?: boolean;
  hasSchema?: boolean;
  hasDocMatch?: boolean;
};

/** Return at most 5 pins: space-relevant first, then domain, then defaults. */
export function selectVisiblePins(ctx: PinSelectionContext, customPins: PinnedRun[]): PinnedRun[] {
  const scored: Array<{ pin: PinnedRun; score: number }> = [];

  for (const pin of [...customPins, ...PINNED_RUNS_CATALOG]) {
    let score = 0;
    if (pin.space === ctx.activeSpace) score += 10;
    if (ctx.lastDomain && pin.domain === ctx.lastDomain) score += 8;
    if (ctx.lastRouteIntent?.includes("udr") && pin.space === "udr") score += 6;
    if (ctx.hasSchema && pin.space === "schema") score += 5;
    if (ctx.hasMigration && pin.space === "migration") score += 5;
    if (ctx.hasDocMatch && pin.space === "documents") score += 5;
    if (pin.isCustom) score += 12;
    if (pin.space === "general") score += 1;
    scored.push({ pin, score });
  }

  const seen = new Set<string>();
  const out: PinnedRun[] = [];
  scored
    .sort((a, b) => b.score - a.score)
    .forEach(({ pin }) => {
      if (out.length >= MAX_VISIBLE_PINS) return;
      if (seen.has(pin.id)) return;
      seen.add(pin.id);
      out.push(pin);
    });

  if (out.length < 3) {
    for (const pin of PINNED_RUNS_CATALOG) {
      if (out.length >= MAX_VISIBLE_PINS) break;
      if (seen.has(pin.id)) continue;
      seen.add(pin.id);
      out.push(pin);
    }
  }

  return out;
}

export function findSemanticallySimilarPin(
  userText: string,
  pins: PinnedRun[],
): PinnedRun | null {
  const m = userText.toLowerCase().trim();
  if (m.length < 8) return null;
  for (const pin of pins) {
    const p = pin.prompt.toLowerCase();
    const keywords = pin.label.toLowerCase().split(/\s+/);
    const hits = keywords.filter((k) => k.length > 3 && m.includes(k)).length;
    if (hits >= 2 || (m.includes("udr") && p.includes("udr")) || (m.includes("fiix") && p.includes("fiix"))) {
      return pin;
    }
  }
  return null;
}
