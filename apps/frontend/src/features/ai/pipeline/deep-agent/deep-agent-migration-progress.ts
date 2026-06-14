/**
 * Shared migration progress helpers (used by both the ActiveMigrationCard and
 * the workflow-queue chat card so they stay in lockstep).
 *
 * Lifted out of ActiveMigrationCard so the workflow-queue card can derive the
 * same "Pre-semantic review · Step 5 of 9 · 44%" line that was previously only
 * visible on the duplicate sticky banner.
 */
import type { MigrationStatusResponse } from "@/features/ai/chat-api";

export const MIGRATION_NODE_LABELS: Record<number, string> = {
  1: "File ingestion",
  2: "Deterministic mapping",
  3: "Pre-semantic review",
  4: "Semantic mapping",
  5: "Field mapping review",
  6: "Data preprocessing",
  7: "Hierarchy detection",
  8: "Hierarchy confirmation",
  9: "Data artifacts",
};

export const MIGRATION_GATE_LABELS: Record<string, string> = {
  pre_semantic: "Pre-semantic review",
  field_mapping: "Field mapping review",
  hierarchy: "Hierarchy confirmation",
  final_confirmation: "Final confirmation",
};

export type MigrationProgress = {
  pct: number | null;
  completed: number;
  total: number;
  step: number | null;
  gateLabel: string | null;
};

export function migrationGateLabel(migration: MigrationStatusResponse): string | null {
  const pending = migration.pending_gate_type;
  if (pending && MIGRATION_GATE_LABELS[pending]) return MIGRATION_GATE_LABELS[pending];
  const step = migration.current_step;
  if (typeof step === "number" && MIGRATION_NODE_LABELS[step]) return MIGRATION_NODE_LABELS[step];
  return null;
}

/**
 * Trust order for progress derivation (the migration backend often leaves
 * ``progress_pct`` at 0 even when nodes are progressing):
 *   1. nodes[].status === "complete" / nodes.length   (most reliable)
 *   2. current_step / total node count                (when nodes[] is empty)
 *   3. server-reported progress_pct                   (only if > 0)
 */
export function computeMigrationProgress(migration: MigrationStatusResponse): MigrationProgress {
  const nodes = migration.nodes ?? [];
  const total = nodes.length;
  const completed = nodes.filter(
    (n) => String(n.status ?? "").toLowerCase() === "complete",
  ).length;

  const step =
    typeof migration.current_step === "number" && migration.current_step > 0
      ? migration.current_step
      : null;
  const gateLabel = migrationGateLabel(migration);

  if (total > 0) {
    return {
      pct: Math.round((completed / total) * 100),
      completed,
      total,
      step,
      gateLabel,
    };
  }
  if (typeof migration.progress_pct === "number" && migration.progress_pct > 0) {
    return { pct: Math.round(migration.progress_pct), completed: 0, total: 0, step, gateLabel };
  }
  return { pct: null, completed: 0, total: 0, step, gateLabel };
}
