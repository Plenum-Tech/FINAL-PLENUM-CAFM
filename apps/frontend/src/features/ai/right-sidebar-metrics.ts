type MetricEntry = { k: string; v: string | number };

type Summaries = {
  ingestSummary: {
    rowCount?: number | null;
    columnCount?: number | null;
    durationMs?: number | null;
    mappedFieldsCount?: number | null;
    overallConfidence?: number | null;
  } | null;
  node4Summary: {
    mappingStats: {
      autoApproved?: number | null;
      humanApproved?: number | null;
      customAdded?: number | null;
    };
    totalSourceFields?: number | null;
    tier2UnmappableCount?: number | null;
  } | null;
  node5Summary: {
    totalRowsPostDedup?: number | null;
    totalOriginalRows?: number | null;
    totalDedupDropCount?: number | null;
    dataQualityWarningsCount?: number | null;
    fkTables: string[];
  } | null;
  node6Summary: {
    confirmedFksCount?: number | null;
    fkCandidatesCount?: number | null;
    hierarchyCyclesCount?: number | null;
    implicitHierarchiesCount?: number | null;
    selfRefTreesCount?: number | null;
  } | null;
  node7Summary: {
    hierarchiesApproved?: number | null;
    confirmedHierarchiesCount?: number | null;
    cyclesResolved?: number | null;
    hierarchyConfirmed?: boolean | null;
  } | null;
  node8Summary: {
    jsonGenerated?: boolean | null;
    csvGenerated?: boolean | null;
    sqlGenerated?: boolean | null;
    reportGenerated?: boolean | null;
    intermediateSchemaValid?: boolean | null;
    schemaValidationErrorsCount?: number | null;
  } | null;
  node9Summary: {
    handoffStatus?: string | null;
    ingestionStatus?: string | null;
    handoffComplete?: boolean | null;
    durationMs?: number | null;
  } | null;
  unstructuredRun: {
    status: "idle" | "running" | "blocked" | "done" | "failed";
    u1: "pending" | "running" | "blocked" | "done" | "failed";
    u2: "pending" | "running" | "blocked" | "done" | "failed";
    u3: "pending" | "running" | "blocked" | "done" | "failed";
  };
};

type Params = {
  groupKey: string;
  ingestResponse: unknown;
  summaries: Summaries;
};

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getArrayCountFromObject(obj: Record<string, unknown> | null, key: string): number | null {
  if (!obj) return null;
  const raw = obj[key];
  return Array.isArray(raw) ? raw.length : null;
}

export function getSidebarLogMetrics({
  groupKey,
  ingestResponse,
  summaries,
}: Params): { primary: string; secondary: MetricEntry[] } {
  const {
    ingestSummary,
    node4Summary,
    node5Summary,
    node6Summary,
    node7Summary,
    node8Summary,
    node9Summary,
    unstructuredRun,
  } = summaries;

  if (groupKey === "Node 1") {
    return {
      primary: ingestSummary?.rowCount != null ? `${ingestSummary.rowCount} rows` : "--",
      secondary: [
        { k: "COLUMNS", v: ingestSummary?.columnCount ?? "--" },
        { k: "DURATION", v: ingestSummary?.durationMs != null ? `${Math.round(ingestSummary.durationMs)} ms` : "--" },
      ],
    };
  }

  if (groupKey === "Node 2") {
    const matched = ingestSummary?.mappedFieldsCount;
    const total = ingestSummary?.columnCount;
    const primary = typeof matched === "number" && typeof total === "number" ? `${matched}/${total} matched` : "--";
    return {
      primary,
      secondary: [
        { k: "MAPPED", v: matched ?? "--" },
        { k: "TOTAL", v: total ?? "--" },
      ],
    };
  }

  if (groupKey === "Node 3") {
    const conf =
      typeof ingestSummary?.overallConfidence === "number" ? `${(ingestSummary.overallConfidence * 100).toFixed(1)}%` : "--";
    const root = getObject(ingestResponse);
    const tier2Flagged = getArrayCountFromObject(root, "tier2_flagged_mappings");
    const tier2Unmappable = getArrayCountFromObject(root, "tier2_unmappable");
    return {
      primary: conf === "--" ? "--" : `${conf} confidence`,
      secondary: [
        { k: "FLAGGED", v: tier2Flagged ?? "--" },
        { k: "UNMAPPABLE", v: tier2Unmappable ?? "--" },
      ],
    };
  }

  if (groupKey === "Node 4") {
    const auto = node4Summary?.mappingStats.autoApproved;
    const human = node4Summary?.mappingStats.humanApproved;
    const custom = node4Summary?.mappingStats.customAdded;
    const totalApproved =
      typeof auto === "number" || typeof human === "number" || typeof custom === "number"
        ? (auto ?? 0) + (human ?? 0) + (custom ?? 0)
        : null;
    const total = node4Summary?.totalSourceFields ?? null;
    const primary = typeof totalApproved === "number" && typeof total === "number" ? `${totalApproved}/${total} approved` : "--";
    return {
      primary,
      secondary: [
        { k: "AUTO", v: auto ?? "--" },
        { k: "HUMAN", v: human ?? "--" },
        { k: "CUSTOM", v: custom ?? "--" },
        { k: "UNMAPPABLE", v: node4Summary?.tier2UnmappableCount ?? "--" },
      ],
    };
  }

  if (groupKey === "Node 5") {
    const post = node5Summary?.totalRowsPostDedup ?? null;
    const orig = node5Summary?.totalOriginalRows ?? null;
    const primary = typeof post === "number" && typeof orig === "number" ? `${post}/${orig} rows` : "--";
    return {
      primary,
      secondary: [
        { k: "DEDUP DROPS", v: node5Summary?.totalDedupDropCount ?? "--" },
        { k: "WARNINGS", v: node5Summary?.dataQualityWarningsCount ?? "--" },
        { k: "FK TABLES", v: node5Summary?.fkTables.length ?? "--" },
      ],
    };
  }

  if (groupKey === "Node 6") {
    const confirmed = node6Summary?.confirmedFksCount ?? null;
    const candidates = node6Summary?.fkCandidatesCount ?? null;
    const primary =
      typeof confirmed === "number" && typeof candidates === "number" ? `${confirmed}/${candidates} confirmed` : "--";
    return {
      primary,
      secondary: [
        { k: "CYCLES", v: node6Summary?.hierarchyCyclesCount ?? "--" },
        { k: "IMPLICIT", v: node6Summary?.implicitHierarchiesCount ?? "--" },
        { k: "SELF-REF", v: node6Summary?.selfRefTreesCount ?? "--" },
      ],
    };
  }

  if (groupKey === "Node 7") {
    const approved = node7Summary?.hierarchiesApproved ?? null;
    const total = node7Summary?.confirmedHierarchiesCount ?? null;
    const primary = typeof approved === "number" && typeof total === "number" ? `${approved}/${total} approved` : "--";
    return {
      primary,
      secondary: [
        { k: "CYCLES RESOLVED", v: node7Summary?.cyclesResolved ?? "--" },
        { k: "CONFIRMED", v: node7Summary?.hierarchyConfirmed === true ? "Yes" : node7Summary?.hierarchyConfirmed === false ? "No" : "--" },
      ],
    };
  }

  if (groupKey === "Node 8") {
    const generated = [
      node8Summary?.jsonGenerated === true ? "JSON" : null,
      node8Summary?.csvGenerated === true ? "CSV" : null,
      node8Summary?.sqlGenerated === true ? "SQL" : null,
      node8Summary?.reportGenerated === true ? "REPORT" : null,
    ].filter((x): x is string => !!x);
    return {
      primary: generated.length ? `${generated.length} generated` : "--",
      secondary: [
        {
          k: "SCHEMA VALID",
          v:
            node8Summary?.intermediateSchemaValid === true
              ? "Yes"
              : node8Summary?.intermediateSchemaValid === false
                ? "No"
                : "--",
        },
        { k: "SCHEMA ERRORS", v: node8Summary?.schemaValidationErrorsCount ?? "--" },
      ],
    };
  }

  if (groupKey === "Node 9") {
    const primary = node9Summary?.handoffStatus
      ? String(node9Summary.handoffStatus).toUpperCase()
      : node9Summary?.ingestionStatus
        ? String(node9Summary.ingestionStatus).toUpperCase()
        : "--";
    return {
      primary,
      secondary: [
        {
          k: "HANDOFF",
          v: node9Summary?.handoffComplete === true ? "Complete" : node9Summary?.handoffComplete === false ? "Pending" : "--",
        },
        { k: "DURATION", v: node9Summary?.durationMs != null ? `${Math.round(node9Summary.durationMs)} ms` : "--" },
      ],
    };
  }

  if (groupKey === "Unstructured") {
    return {
      primary: unstructuredRun.status !== "idle" ? unstructuredRun.status.toUpperCase() : "--",
      secondary: [
        { k: "U1", v: unstructuredRun.u1.toUpperCase() },
        { k: "U2", v: unstructuredRun.u2.toUpperCase() },
        { k: "U3", v: unstructuredRun.u3.toUpperCase() },
      ],
    };
  }

  return { primary: "--", secondary: [] };
}
