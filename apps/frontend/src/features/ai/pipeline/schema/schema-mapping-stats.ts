import type { NodeInfo, SchemaMappingStats, SchemaMappingStatusResponse } from "../../chat-api";
import { isRecord } from "../../lib/coerce";

function readNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasMeaningfulStats(stats: SchemaMappingStats | null | undefined): boolean {
  if (!stats) return false;
  const values = [
    stats.total_tables,
    stats.total_fields,
    stats.tier1_mapped,
    stats.tier2_auto_mapped,
    stats.tier2_flagged,
    stats.unmapped,
    stats.detected_fk_count,
    stats.mapping_coverage_pct,
  ];
  return values.some((v) => (v ?? 0) > 0);
}

function statsFromSummaryBlob(input: Record<string, unknown>): SchemaMappingStats | null {
  const totalFields =
    readNum(input.total_source_fields) ??
    readNum(input.total_fields) ??
    readNum(input.total_columns);
  const tier1 =
    readNum(input.tier1_auto_mapped) ??
    readNum(input.tier1_mapped) ??
    readNum(input.tier1_mapped_count);
  const tier2Auto = readNum(input.tier2_auto_mapped) ?? readNum(input.tier2_mapped);
  const tier2Flagged = readNum(input.tier2_flagged) ?? readNum(input.flagged);
  const unmapped = readNum(input.unmappable) ?? readNum(input.unmapped) ?? readNum(input.unmapped_count);
  const coverage = readNum(input.mapping_coverage_pct) ?? readNum(input.coverage_pct);
  const tables =
    readNum(input.canonical_tables_touched) ??
    readNum(input.total_tables) ??
    readNum(input.table_count);
  const fks = readNum(input.detected_fk_count) ?? readNum(input.fk_count);
  const depth = readNum(input.max_hierarchy_depth) ?? readNum(input.hierarchy_depth);

  if (
    totalFields == null &&
    tier1 == null &&
    tier2Auto == null &&
    coverage == null &&
    tables == null
  ) {
    return null;
  }

  return {
    total_tables: tables,
    total_fields: totalFields,
    tier1_mapped: tier1,
    tier2_auto_mapped: tier2Auto,
    tier2_flagged: tier2Flagged,
    unmapped: unmapped,
    detected_fk_count: fks,
    hierarchy_depth: depth,
    mapping_coverage_pct: coverage,
  };
}

function unwrapOutput(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output)) return null;
  if (isRecord(output.summary)) return output.summary;
  if (isRecord(output.stats)) return output.stats;
  if (isRecord(output.audit)) return output.audit;
  return output;
}

/** Prefer output from later pipeline nodes (richest summary). */
const SUMMARY_NODE_IDS = [8, 7, 6, 2, 1, 0];

function deriveStatsFromNodes(nodes: NodeInfo[] | undefined): SchemaMappingStats | null {
  if (!nodes?.length) return null;

  for (const nodeId of SUMMARY_NODE_IDS) {
    const node = nodes.find((n) => n.node_id === nodeId);
    const blob = unwrapOutput(node?.output);
    if (!blob) continue;
    const stats = statsFromSummaryBlob(blob);
    if (stats && hasMeaningfulStats(stats)) return stats;
  }

  // Artifacts gate payload may be stored on node 9 output or pending snapshot fields.
  const node9 = nodes.find((n) => n.node_id === 9);
  const gateSummary = isRecord(node9?.output) && isRecord(node9.output.summary) ? node9.output.summary : null;
  if (gateSummary) {
    const stats = statsFromSummaryBlob(gateSummary);
    if (stats && hasMeaningfulStats(stats)) return stats;
  }

  return null;
}

/**
 * Status API stats columns are often left at 0 even after a successful run.
 * Fall back to node output / gate summary blobs (same data as the artifacts gate UI).
 */
export function resolveSchemaMappingStats(
  session: SchemaMappingStatusResponse,
): SchemaMappingStats | null {
  const fromApi = session.stats ?? null;
  if (hasMeaningfulStats(fromApi)) return fromApi;

  const fromNodes = deriveStatsFromNodes(session.nodes);
  if (fromNodes) {
    return {
      total_tables: fromNodes.total_tables ?? fromApi?.total_tables ?? null,
      total_fields: fromNodes.total_fields ?? fromApi?.total_fields ?? null,
      tier1_mapped: fromNodes.tier1_mapped ?? fromApi?.tier1_mapped ?? null,
      tier2_auto_mapped: fromNodes.tier2_auto_mapped ?? fromApi?.tier2_auto_mapped ?? null,
      tier2_flagged: fromNodes.tier2_flagged ?? fromApi?.tier2_flagged ?? null,
      unmapped: fromNodes.unmapped ?? fromApi?.unmapped ?? null,
      detected_fk_count: fromNodes.detected_fk_count ?? fromApi?.detected_fk_count ?? null,
      hierarchy_depth: fromNodes.hierarchy_depth ?? fromApi?.hierarchy_depth ?? null,
      mapping_coverage_pct: fromNodes.mapping_coverage_pct ?? fromApi?.mapping_coverage_pct ?? null,
    };
  }

  return fromApi;
}
