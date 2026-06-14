"use client";

import { Database, Zap } from "lucide-react";
import type { SchemaMappingStatusResponse } from "../../chat-api";
import { isRecord } from "../../lib/coerce";

export type SchemaSideCounts = {
  label: string;
  table_count: number;
  column_count: number;
  canonical_field_count?: number;
};

export type SchemaComparison = {
  fiix: SchemaSideCounts;
  plenum_cafm: SchemaSideCounts;
  markdown?: string;
};

function readNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sideFromRecord(raw: unknown, fallbackLabel: string): SchemaSideCounts | null {
  if (!isRecord(raw)) return null;
  return {
    label: String(raw.label || fallbackLabel),
    table_count: readNum(raw.table_count),
    column_count: readNum(raw.column_count),
    canonical_field_count: readNum(raw.canonical_field_count) || undefined,
  };
}

function fiixCountsFromSession(
  session: SchemaMappingStatusResponse | null | undefined,
  seed: SchemaSideCounts,
): SchemaSideCounts {
  let table_count = seed.table_count;
  let column_count = seed.column_count;
  const cmmsName = session?.external_cmms_name || "Fiix";

  if (table_count === 0 || column_count === 0) {
    const stats = session?.stats;
    if (table_count === 0) table_count = readNum(stats?.total_tables);
    if (column_count === 0) column_count = readNum(stats?.total_fields);
  }

  if (table_count === 0 || column_count === 0) {
    for (const node of session?.nodes ?? []) {
      if (node.node_id !== 1 || !isRecord(node.output)) continue;
      if (table_count === 0) table_count = readNum(node.output.table_count);
      if (column_count === 0) column_count = readNum(node.output.total_columns);
    }
  }

  if (table_count === 0 || column_count === 0) {
    const payloadUnknown: unknown = session?.pending_gate_payload;
    if (isRecord(payloadUnknown)) {
      if (table_count === 0) table_count = readNum(payloadUnknown.table_count);
      if (column_count === 0) column_count = readNum(payloadUnknown.total_columns);
    }
  }

  return {
    ...seed,
    label: seed.label || `${cmmsName} (source)`,
    table_count,
    column_count,
  };
}

/** Build comparison from status API field or pipeline node outputs (nodes 0 + 1). */
export function resolveSchemaComparison(
  session: SchemaMappingStatusResponse | null | undefined,
): SchemaComparison | null {
  const direct = session?.schema_comparison;
  if (isRecord(direct) && isRecord(direct.fiix) && isRecord(direct.plenum_cafm)) {
    const fiixSeed = sideFromRecord(direct.fiix, "Fiix CMMS (source)");
    const plenum = sideFromRecord(direct.plenum_cafm, "plenum_cafm (target platform)");
    if (fiixSeed && plenum) {
      const fiix = fiixCountsFromSession(session, fiixSeed);
      if (fiix.table_count > 0 || plenum.table_count > 0) {
        return { fiix, plenum_cafm: plenum, markdown: String(direct.markdown || "") || undefined };
      }
    }
  }

  const nodes = session?.nodes;
  if (!nodes?.length) return null;

  let plenumTables = 0;
  let plenumCols = 0;
  let fiixTables = 0;
  let fiixCols = 0;
  let cmmsName = session?.external_cmms_name || "Fiix";

  for (const node of nodes) {
    const out = node.output;
    if (!isRecord(out)) continue;
    if (node.node_id === 0) {
      plenumTables = readNum(out.canonical_table_count);
      plenumCols = readNum(out.canonical_column_count);
    } else if (node.node_id === 1) {
      fiixTables = readNum(out.table_count);
      fiixCols = readNum(out.total_columns);
      if (out.external_cmms_name) cmmsName = String(out.external_cmms_name);
    }
  }

  if (fiixTables === 0) fiixTables = readNum(session?.stats?.total_tables);
  if (fiixCols === 0) fiixCols = readNum(session?.stats?.total_fields);

  if (plenumTables === 0 && fiixTables === 0) return null;

  return {
    fiix: {
      label: `${cmmsName} (source)`,
      table_count: fiixTables,
      column_count: fiixCols,
    },
    plenum_cafm: {
      label: "plenum_cafm (target platform)",
      table_count: plenumTables,
      column_count: plenumCols,
    },
  };
}

function SideCard({
  side,
  accent,
  icon,
}: {
  side: SchemaSideCounts;
  accent: "amber" | "indigo";
  icon: React.ReactNode;
}) {
  const border = accent === "amber" ? "border-amber-200 bg-amber-50/80" : "border-indigo-200 bg-indigo-50/80";
  const title = accent === "amber" ? "text-amber-900" : "text-indigo-900";
  const metric = accent === "amber" ? "text-amber-800" : "text-indigo-800";

  return (
    <div className={`rounded-xl border p-4 ${border}`}>
      <div className={`flex items-center gap-2 text-sm font-semibold ${title} mb-3`}>
        {icon}
        {side.label}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={`text-2xl font-bold tabular-nums ${metric}`}>{side.table_count}</div>
          <div className="text-xs text-slate-600 mt-0.5">tables / object types</div>
        </div>
        <div>
          <div className={`text-2xl font-bold tabular-nums ${metric}`}>{side.column_count}</div>
          <div className="text-xs text-slate-600 mt-0.5">fields / columns</div>
        </div>
      </div>
      {side.canonical_field_count != null && side.canonical_field_count > 0 ? (
        <div className="text-[11px] text-slate-500 mt-2">
          {side.canonical_field_count} unique plenum field targets referenced in Fiix mapper
        </div>
      ) : null}
    </div>
  );
}

export default function SchemaComparisonBanner({
  session,
  className = "",
}: {
  session: SchemaMappingStatusResponse | null | undefined;
  className?: string;
}) {
  const comparison = resolveSchemaComparison(session);
  if (!comparison) return null;

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Schema sources</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Fiix is your external CMMS; plenum_cafm is the platform database mapping targets.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SideCard
          side={comparison.fiix}
          accent="amber"
          icon={<Zap size={16} className="text-amber-600 shrink-0" />}
        />
        <SideCard
          side={comparison.plenum_cafm}
          accent="indigo"
          icon={<Database size={16} className="text-indigo-600 shrink-0" />}
        />
      </div>
    </div>
  );
}
