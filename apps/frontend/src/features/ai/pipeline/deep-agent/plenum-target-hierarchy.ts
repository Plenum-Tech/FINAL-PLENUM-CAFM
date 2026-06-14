/** Recommended plenum_cafm target order for UDR / migration prompts (Feature 4). */
export const PLENUM_UDR_TARGET_HIERARCHY = [
  "locations",
  "sites",
  "assets",
  "work_orders",
  "resources",
  "vendors",
  "parts",
  "users",
  "preventive_maintenance",
  "inspections",
] as const;

export type PlenumHierarchyTable = (typeof PLENUM_UDR_TARGET_HIERARCHY)[number];

/** Prefer established UDR/migration canonical tables; fall back to Plenum default. */
export function resolveUdrTargetHierarchy(canonicalTables?: string[] | null): string[] {
  const fromSchema = (canonicalTables ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (fromSchema.length >= 2) {
    const defaultSet = new Set<string>(PLENUM_UDR_TARGET_HIERARCHY);
    const orderedKnown = PLENUM_UDR_TARGET_HIERARCHY.filter((t) => fromSchema.includes(t));
    const extras = fromSchema.filter((t) => !defaultSet.has(t));
    const merged = [...orderedKnown, ...extras];
    return merged.length ? merged : [...PLENUM_UDR_TARGET_HIERARCHY];
  }
  return [...PLENUM_UDR_TARGET_HIERARCHY];
}

export function buildUdrHierarchyPrompt(canonicalTables?: string[] | null): string {
  const tables = resolveUdrTargetHierarchy(canonicalTables);
  const chain = tables.join(" → ");
  const source =
    canonicalTables && canonicalTables.length >= 2
      ? "from your established UDR / migration schema"
      : "recommended plenum_cafm default";
  return `Target register order (${source}, parent → child): ${chain}. Map source tables into this hierarchy before hierarchy detection.`;
}

/** @deprecated Use buildUdrHierarchyPrompt() for session-aware copy. */
export const PLENUM_UDR_TARGET_HIERARCHY_PROMPT = buildUdrHierarchyPrompt();
