const STORAGE_KEY = "plenum_custom_spaces_v1";

export type CustomSavedSpace = {
  id: string;
  label: string;
  description?: string;
  createdAt: number;
};

export function loadCustomSpaces(): CustomSavedSpace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomSavedSpace[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistCustomSpaces(spaces: CustomSavedSpace[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(spaces.slice(0, 20)));
  } catch {
    /* ignore */
  }
}

export function isCustomSpaceId(id: string): boolean {
  return id.startsWith("custom_");
}

export function addCustomSpace(label: string, description?: string): CustomSavedSpace {
  const trimmed = label.trim();
  const id = `custom_${Date.now().toString(36)}`;
  const entry: CustomSavedSpace = {
    id,
    label: trimmed || "Custom space",
    description: description?.trim(),
    createdAt: Date.now(),
  };
  const next = [...loadCustomSpaces(), entry];
  persistCustomSpaces(next);
  return entry;
}
