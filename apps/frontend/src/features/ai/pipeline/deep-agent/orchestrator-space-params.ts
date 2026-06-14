import type { SavedSpaceId } from "./deep-agent-spaces";

const VALID: SavedSpaceId[] = [
  "work_orders",
  "documents",
  "udr",
  "migration",
  "schema",
  "compliance",
  "general",
];

export function parseOrchestratorSpaceParam(value: string | null | undefined): SavedSpaceId | undefined {
  if (!value?.trim()) return undefined;
  const v = value.trim().toLowerCase() as SavedSpaceId;
  return VALID.includes(v) ? v : undefined;
}

export function orchestratorHref(space?: SavedSpaceId): string {
  if (!space || space === "general") return "/ai";
  return `/ai?space=${encodeURIComponent(space)}`;
}
