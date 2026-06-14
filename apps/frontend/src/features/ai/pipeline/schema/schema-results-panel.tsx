"use client";
import { useMemo, useState } from "react";
import { CheckCircle, RotateCcw, BarChart3, AlertCircle, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui";
import {
  useSchemaMappingMappings,
  useSchemaMappingUnmapped,
  useSchemaMappingAuditTrail,
  type SchemaMappingStatusResponse,
  type MappingRecord,
  type SchemaUnmappedFieldItem,
} from "../../chat-api";
import { formatShortId, isRecord } from "../../lib/coerce";
import { resolveSchemaMappingStats } from "./schema-mapping-stats";

interface Props {
  session: SchemaMappingStatusResponse;
  onReset: () => void;
  onStartIngestion?: () => void;
  ingestionRunning?: boolean;
}

export default function SchemaResultsPanel({ session, onReset, onStartIngestion, ingestionRunning }: Props) {
  const stats = useMemo(() => resolveSchemaMappingStats(session), [session]);
  const [tab, setTab] = useState<"summary" | "mappings" | "unmapped" | "audit">("summary");

  const {
    data: mappingsData,
    isLoading: loadingMappings,
    error: mappingsError,
  } = useSchemaMappingMappings(session.schema_mapping_id, {
    enabled: tab === "mappings" || tab === "summary",
  });

  const {
    data: unmappedData,
    isLoading: loadingUnmapped,
    error: unmappedError,
  } = useSchemaMappingUnmapped(session.schema_mapping_id, { enabled: tab === "unmapped" });

  const {
    data: auditData,
    isLoading: loadingAudit,
    error: auditError,
  } = useSchemaMappingAuditTrail(session.schema_mapping_id, { enabled: tab === "audit" });

  const mappings: MappingRecord[] = Array.isArray(mappingsData?.mappings)
    ? mappingsData.mappings
    : isRecord(mappingsData) && Array.isArray(mappingsData.mappings)
      ? (mappingsData.mappings as MappingRecord[])
      : [];

  const unmapped: SchemaUnmappedFieldItem[] = Array.isArray(unmappedData?.unmapped_fields)
    ? unmappedData.unmapped_fields
    : isRecord(unmappedData) && Array.isArray(unmappedData.unmapped_fields)
      ? (unmappedData.unmapped_fields as SchemaUnmappedFieldItem[])
      : [];

  const auditMappings: MappingRecord[] = Array.isArray(auditData?.mappings) ? auditData.mappings : [];

  const tierCounts = useMemo(() => {
    const bd = mappingsData?.tier_breakdown ?? {};
    return Object.entries(bd).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  }, [mappingsData?.tier_breakdown]);

  function formatTs(ts: string) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  }

  return (
    <div className="max-w-2xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-8 flex flex-col items-center text-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center">
          <CheckCircle size={32} className="text-green-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Schema mapping complete</h2>
          <p className="text-sm text-slate-500 mt-1">
            {session.external_cmms_name} schema has been mapped to Plenum CAFM canonical fields
            and written to the database.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-5">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-2">
          <div className="text-xs font-semibold text-slate-500 tracking-widest">RESULTS</div>
          <div className="ml-auto flex items-center gap-2">
            {([
              { id: "summary", label: "Summary" },
              { id: "mappings", label: "Mappings" },
              { id: "unmapped", label: "Unmapped" },
              { id: "audit", label: "Audit" },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  tab === t.id
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          {tab === "summary" && (
            <>
              {stats && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={16} className="text-indigo-600" />
                    <h3 className="text-sm font-semibold text-slate-700">Mapping summary</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Total tables",       value: stats.total_tables },
                      { label: "Total fields",       value: stats.total_fields },
                      { label: "Tier 1 mapped",      value: stats.tier1_mapped },
                      { label: "Tier 2 auto-mapped", value: stats.tier2_auto_mapped },
                      { label: "Flagged for review", value: stats.tier2_flagged },
                      { label: "Unmapped",           value: stats.unmapped },
                      { label: "FK relationships",   value: stats.detected_fk_count },
                      { label: "Hierarchy depth",    value: stats.hierarchy_depth },
                    ].map(({ label, value }) =>
                      value != null ? (
                        <div key={label} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                          <span className="text-sm text-slate-600">{label}</span>
                          <span className="font-mono font-bold text-slate-800">{value}</span>
                        </div>
                      ) : null
                    )}
                    {stats.mapping_coverage_pct != null && (
                      <div className="col-span-2 mt-2">
                        <div className="flex justify-between text-sm mb-1.5">
                          <span className="text-slate-600">Mapping coverage</span>
                          <span className="font-mono font-bold text-indigo-600">
                            {Math.round(stats.mapping_coverage_pct)}%
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${Math.round(stats.mapping_coverage_pct)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!stats && (
                <div className="text-sm text-slate-500">
                  No stats available yet.
                  {loadingMappings ? " Loading mapping counts…" : null}
                </div>
              )}
              {!stats && !loadingMappings && (mappingsData?.total_mappings ?? 0) > 0 && (
                <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  {mappingsData?.total_mappings} field mappings were written. Open the{" "}
                  <button type="button" className="font-semibold underline" onClick={() => setTab("mappings")}>
                    Mappings
                  </button>{" "}
                  tab for details.
                </div>
              )}
            </>
          )}

          {tab === "mappings" && (
            <div className="space-y-4">
              {loadingMappings && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner size="sm" />
                  Loading mappings…
                </div>
              )}
              {!loadingMappings && !!mappingsError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5" />
                  <span>{mappingsError instanceof Error ? mappingsError.message : "Failed to load mappings"}</span>
                </div>
              )}
              {!loadingMappings && !mappingsError && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500">Total</span>
                    <span className="text-xs font-mono font-bold text-slate-800">{mappingsData?.total_mappings ?? mappings.length}</span>
                    {tierCounts.length > 0 && (
                      <>
                        <span className="text-slate-300 text-xs">·</span>
                        <div className="flex flex-wrap gap-1.5">
                          {tierCounts.slice(0, 8).map(([tier, count]) => (
                            <span key={tier} className="text-[11px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full font-mono">
                              {tier}:{count}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr className="text-left text-slate-600">
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">source_table</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">source_field</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">target_field</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">confidence</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">tier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {mappings.slice(0, 100).map((m, i) => (
                          <tr key={`${m.source_table ?? ""}:${m.source_field}:${i}`} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{m.source_table ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">{m.source_field}</td>
                            <td className="px-3 py-2 font-mono text-indigo-700 whitespace-nowrap">{m.target_field ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">{Math.round((m.confidence ?? 0) * 100)}%</td>
                            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{m.tier}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {mappings.length > 100 && (
                      <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-200 bg-slate-50">
                        Showing first 100 mappings
                      </div>
                    )}
                    {mappings.length === 0 && (
                      <div className="px-3 py-6 text-center text-xs text-slate-400">No mappings found.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "unmapped" && (
            <div className="space-y-4">
              {loadingUnmapped && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner size="sm" />
                  Loading unmapped fields…
                </div>
              )}
              {!loadingUnmapped && !!unmappedError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5" />
                  <span>{unmappedError instanceof Error ? unmappedError.message : "Failed to load unmapped fields"}</span>
                </div>
              )}
              {!loadingUnmapped && !unmappedError && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Unmapped</span>
                    <span className="text-xs font-mono font-bold text-slate-800">{unmappedData?.unmapped_count ?? unmapped.length}</span>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr className="text-left text-slate-600">
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">source_table</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">source_field</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">nullable</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">data_type_hint</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {unmapped.slice(0, 100).map((u, i) => (
                          <tr key={`${u.source_table}:${u.source_field}:${i}`} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{u.source_table}</td>
                            <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">{u.source_field}</td>
                            <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                              {u.nullable === true ? "true" : u.nullable === false ? "false" : "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{u.data_type_hint ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {unmapped.length > 100 && (
                      <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-200 bg-slate-50">
                        Showing first 100 fields
                      </div>
                    )}
                    {unmapped.length === 0 && (
                      <div className="px-3 py-6 text-center text-xs text-slate-400">No unmapped fields.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "audit" && (
            <div className="space-y-4">
              {loadingAudit && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner size="sm" />
                  Loading audit trail…
                </div>
              )}
              {!loadingAudit && !!auditError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5" />
                  <span>{auditError instanceof Error ? auditError.message : "Failed to load audit trail"}</span>
                </div>
              )}
              {!loadingAudit && !auditError && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Audit trail</span>
                    <span className="text-xs font-mono font-bold text-slate-800">
                      {auditData?.total_mappings ?? auditMappings.length}
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr className="text-left text-slate-600">
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">source_table</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">source_field</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">target_field</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">tier</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">confidence</th>
                          <th className="px-3 py-2 font-semibold whitespace-nowrap">mapped_at</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {auditMappings.slice(0, 200).map((m, i) => (
                          <tr key={`${m.source_table ?? ""}:${m.source_field}:${i}`} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{m.source_table ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-slate-800 whitespace-nowrap">{m.source_field}</td>
                            <td className="px-3 py-2 font-mono text-indigo-700 whitespace-nowrap">{m.target_field ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{m.tier ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">
                              {m.confidence != null ? `${Math.round((m.confidence ?? 0) * 100)}%` : "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                              {m.mapped_at ? formatTs(m.mapped_at) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {auditMappings.length > 200 && (
                      <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-200 bg-slate-50">
                        Showing first 200 audit records
                      </div>
                    )}
                    {auditMappings.length === 0 && (
                      <div className="px-3 py-6 text-center text-xs text-slate-400">No audit records.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-400 mb-5">
        <span>Session: <code className="font-mono">{formatShortId(session.schema_mapping_id)}</code></span>
        {session.completed_at && (
          <span>Completed: {new Date(session.completed_at).toLocaleString()}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {onStartIngestion && (
          <button
            onClick={onStartIngestion}
            disabled={ingestionRunning}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {ingestionRunning ? (
              <>
                <Spinner size="sm" />
                Syncing…
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                Sync Data from Fiix
              </>
            )}
          </button>
        )}
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
        >
          <RotateCcw size={14} />
          New schema mapping
        </button>
      </div>
    </div>
  );
}
