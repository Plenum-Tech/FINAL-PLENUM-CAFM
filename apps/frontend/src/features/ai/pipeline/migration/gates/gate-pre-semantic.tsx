"use client";
import { useState, useRef } from "react";
import { CheckCircle, ChevronDown, ChevronUp, ArrowRight, Search } from "lucide-react";
import {
  useMigrationGatePreSemantic,
  useMigrationAdvance,
  schemaMapperApi,
  type MigrationGatePreSemanticRequest,
  type MigrationPreSemanticGatePayload,
  type MigrationPreSemanticReviewItem,
} from "../../../chat-api";
import { MigrationCanonicalTableSelect } from "../migration-canonical-table-select";

/** SQL types offered for new-table columns. */
const DATA_TYPES = [
  "VARCHAR(255)", "TEXT", "INTEGER", "BIGINT", "NUMERIC", "BOOLEAN", "DATE", "TIMESTAMP",
];

/** Best-guess SQL type from a column name (editable in the dropdown). */
function inferDataType(field: string): string {
  const f = (field || "").toLowerCase();
  if (/(timestamp|_at\b|datetime|created|updated|modified)/.test(f)) return "TIMESTAMP";
  if (/(date|_dt\b|dob|dtm)/.test(f)) return "DATE";
  if (/(is_|^is\b|bool|flag|active|enabled|deactivated)/.test(f)) return "BOOLEAN";
  if (/(amount|price|cost|total|rate|latitude|longitude|lat\b|lon\b|balance|qty|quantity)/.test(f)) return "NUMERIC";
  if (/(_id\b|^id$|count|number|_no\b|^num)/.test(f)) return "INTEGER";
  return "VARCHAR(255)";
}

interface Props {
  migrationId: string;
  payload: MigrationPreSemanticGatePayload;
  onSubmitted: (snapshot?: {
    gate: "pre_semantic";
    payload: MigrationPreSemanticGatePayload;
    decisions: Record<string, Array<{ source_field: string; decision: "approve" | "semantic" }>>;
  }) => void;
  onFieldFocus?: (terms: string[]) => void;
  node2Output?: Record<string, unknown>;
}

function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, string> = {
    T1_exact:    "bg-green-100 text-green-800",
    T1_alias:    "bg-blue-100 text-blue-800",
    T1_regex:    "bg-purple-100 text-purple-800",
    T1_registry: "bg-teal-100 text-teal-800",
    T1_llm:      "bg-indigo-100 text-indigo-800",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[tier] ?? "bg-slate-100 text-slate-600"}`}>
      {tier.replace("T1_", "")}
    </span>
  );
}

export default function GatePreSemantic({ migrationId, payload, onSubmitted, onFieldFocus, node2Output }: Props) {
  const reviewByTable = payload?.review_items_by_table ?? {};
  const allTables = Object.keys(reviewByTable);
  // Target dropdown lists ALL plenum_cafm tables (from the backend), not just the
  // source tables under review. Fall back to source tables if the list is empty.
  const canonicalTargetTables =
    (payload?.existing_canonical_tables?.length ?? 0) > 0
      ? (payload?.existing_canonical_tables ?? [])
      : allTables;

  // Unresolved fields from node 2 (automatically going to semantic, not in T1 review)
  const unresolvedByTable: Record<string, string[]> = (() => {
    const out: Record<string, string[]> = {};
    // Prefer the node-2 output; fall back to the gate payload (step_pause also carries
    // unresolved_by_table) so the unmatched count/list always shows even if node2Output lags.
    const raw =
      node2Output?.unresolved_by_table ??
      node2Output?.tier2_unmappable_by_table ??
      (payload as Record<string, unknown> | undefined)?.unresolved_by_table;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [tbl, list] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(list)) out[tbl] = (list as unknown[]).filter((x): x is string => typeof x === "string");
    }
    return out;
  })();
  const totalAutoSemantic = Object.values(unresolvedByTable).reduce((s, arr) => s + arr.length, 0);
  // Every source sheet (T1-reviewable and/or unresolved) — Step 1 must let the user
  // confirm a target table for ALL of them, not just the ones with T1 matches.
  const allSourceTables = Array.from(new Set([...allTables, ...Object.keys(unresolvedByTable)]));

  const TIER_COLORS: Record<string, string> = {
    T1_exact:    "bg-green-100 text-green-800",
    T1_alias:    "bg-blue-100 text-blue-800",
    T1_variation:"bg-teal-100 text-teal-800",
    T1_regex:    "bg-purple-100 text-purple-800",
    T1_registry: "bg-teal-100 text-teal-800",
    T1_llm:      "bg-indigo-100 text-indigo-800",
  };
  const tierCounts: Record<string, number> = {};
  for (const items of Object.values(reviewByTable)) {
    for (const item of items) {
      const t = item.tier ?? "other";
      tierCounts[t] = (tierCounts[t] ?? 0) + 1;
    }
  }

  const [focusedTerm, setFocusedTerm] = useState<string | null>(null);

  function handleTermClick(term: string) {
    const next = focusedTerm === term ? null : term;
    setFocusedTerm(next);
    onFieldFocus?.(next ? [next] : []);
  }

  const [decisions, setDecisions] = useState<Record<string, "approve" | "semantic">>(() => {
    const init: Record<string, "approve" | "semantic"> = {};
    for (const [tbl, items] of Object.entries(reviewByTable)) {
      for (const item of items) {
        init[`${tbl}.${item.source_field}`] = "approve";
      }
    }
    return init;
  });
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set(allTables));
  const [error, setError] = useState<string | null>(null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  // WP-5 Node 2: rename/create the target table per source table, and rename target columns.
  // A source table is classified as NEW unless the mapper's suggested target is a
  // real existing canonical table. Defaulting unmatched tables to isNew=false used
  // to route them through column-matching against nonexistent schema (e.g. a source
  // "Transport" was forced through "match Transport columns against the canonical
  // Transport table" even though no such canonical table existed).
  const [tableTargets, setTableTargets] = useState<Record<string, { target: string; isNew: boolean }>>(() => {
    const suggested = payload?.suggested_target_by_table ?? {};
    const init: Record<string, { target: string; isNew: boolean }> = {};
    for (const tbl of allSourceTables) {
      const guess = (suggested[tbl] ?? "").trim();
      const hasCanonicalMatch = guess.length > 0 && canonicalTargetTables.includes(guess);
      if (hasCanonicalMatch) {
        // Existing entity: route through schema comparison + column mapping.
        init[tbl] = { target: guess, isNew: false };
      } else {
        // No real target table — treat as new entity so downstream "Create
        // table" flow fires instead of column-matching against ghost schema.
        // The user can still flip back to "existing" via the table-target
        // selector if the mapper missed a canonical name.
        init[tbl] = { target: tbl, isNew: true };
      }
    }
    return init;
  });
  const [fieldRenames, setFieldRenames] = useState<Record<string, string>>({});
  // SQL type chosen for each NEW-table column. key `${tbl}.${field}` → data type.
  const [newColumnTypes, setNewColumnTypes] = useState<Record<string, string>>({});
  // Manual target-column assignment for unresolved ("left-out") source fields.
  // key `${tbl}.${field}` → leftover column name, or "" to send to semantic.
  const [unresolvedAssign, setUnresolvedAssign] = useState<Record<string, string>>({});

  // Columns of every candidate target table — lets us re-match a source table's
  // columns the moment the user picks a different target table.
  const canonicalColumnsByTable = payload?.canonical_columns_by_table ?? {};
  // remapByTable[srcTable][sourceField] = { target column in the chosen table, matched? }.
  // Present only for tables whose target the user changed to another EXISTING table.
  const [remapByTable, setRemapByTable] = useState<
    Record<string, Record<string, { target: string; matched: boolean }>>
  >({});

  function normalizeCol(s: string): string {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /**
   * snake_case a source column name for use as the target column of a NEW
   * table. Strips parenthesised units, converts CamelCase / space-separated
   * to underscores, collapses repeats, removes leading/trailing underscores.
   *   "Trip ID"               → "trip_id"
   *   "Travel Date"           → "travel_date"
   *   "Distance (km)"         → "distance_km"
   *   "Total Trip Cost (AED)" → "total_trip_cost_aed"
   *   "Driver-Name"           → "driver_name"
   */
  function toSnakeCase(s: string): string {
    const raw = (s ?? "").toString();
    // Lift parenthesised tokens into the name ("Distance (km)" → "Distance km")
    const lifted = raw.replace(/\(([^)]+)\)/g, " $1 ");
    // CamelCase / lowerUpper boundary
    const split = lifted.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    return split
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "col";
  }

  /**
   * Apply a target-table choice for one source table. When the target is an
   * existing table we re-match each reviewed source column against THAT table's
   * columns: exact (normalized) hits stay "approve" and retarget to the real
   * column name; columns with no counterpart flip to "semantic" so they get
   * resolved downstream. If the table's columns aren't known (or it's a new
   * table), we keep the existing matches untouched.
   */
  function applyTableTarget(tbl: string, target: string, isNew: boolean) {
    setTableTargets((prev) => ({ ...prev, [tbl]: { target, isNew } }));

    const clearRemap = () =>
      setRemapByTable((prev) => {
        if (!prev[tbl]) return prev;
        const next = { ...prev };
        delete next[tbl];
        return next;
      });

    if (isNew || !target) {
      clearRemap();
      return;
    }
    const key =
      Object.keys(canonicalColumnsByTable).find((k) => k.toLowerCase() === target.toLowerCase()) ?? "";
    const cols = canonicalColumnsByTable[key] ?? [];
    if (cols.length === 0) {
      // Columns unknown for this target — don't destroy existing matches.
      clearRemap();
      return;
    }
    const byNorm = new Map(cols.map((c) => [normalizeCol(c), c]));

    const items = reviewByTable[tbl] ?? [];
    const remap: Record<string, { target: string; matched: boolean }> = {};
    const renameUpdates: Record<string, string> = {};
    const decisionUpdates: Record<string, "approve" | "semantic"> = {};
    for (const it of items) {
      const hit = byNorm.get(normalizeCol(it.source_field));
      remap[it.source_field] = { target: hit ?? "", matched: !!hit };
      renameUpdates[`${tbl}.${it.source_field}`] = hit ?? it.source_field;
      decisionUpdates[`${tbl}.${it.source_field}`] = hit ? "approve" : "semantic";
    }
    setRemapByTable((prev) => ({ ...prev, [tbl]: remap }));
    setFieldRenames((prev) => ({ ...prev, ...renameUpdates }));
    setDecisions((prev) => ({ ...prev, ...decisionUpdates }));
  }

  const lastSubmitRef = useRef<{
    body: MigrationGatePreSemanticRequest;
    snapshot: { gate: "pre_semantic"; payload: MigrationPreSemanticGatePayload; decisions: Record<string, Array<{ source_field: string; decision: "approve" | "semantic" }>> };
  } | null>(null);

  const { mutate: submitGate, isPending } = useMigrationGatePreSemantic({
    onSuccess: () => onSubmitted(),
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setError(msg);
      if (/status:\s*(failed|ddl_failed)/i.test(msg)) onSubmitted();
    },
  });
  const { mutate: advance, isPending: isAdvancing } = useMigrationAdvance({
    onSuccess: () => {
      setError(null);
      const pending = lastSubmitRef.current;
      if (pending) submitGate({ migrationId, body: pending.body }, { onSuccess: () => onSubmitted(pending.snapshot) });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Pipeline advance failed";
      setError(`Pipeline advance failed: ${msg}`);
    },
  });

  function toggleTable(tbl: string) {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tbl)) next.delete(tbl);
      else next.add(tbl);
      return next;
    });
  }

  function setDecision(tbl: string, field: string, action: "approve" | "semantic") {
    setDecisions((prev) => ({ ...prev, [`${tbl}.${field}`]: action }));
  }

  function approveAll() {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const [tbl, items] of Object.entries(reviewByTable)) {
        for (const item of items) next[`${tbl}.${item.source_field}`] = "approve";
      }
      return next;
    });
  }

  function handleSubmit() {
    const decisionsBody: MigrationGatePreSemanticRequest["decisions"] = {};
    for (const [tbl, items] of Object.entries(reviewByTable)) {
      const isNewTbl = !!tableTargets[tbl]?.isNew;
      decisionsBody[tbl] = items.map((item) => {
        const k = `${tbl}.${item.source_field}`;
        if (isNewTbl) {
          // NEW TABLE: deterministic — every source column becomes an
          // approved snake_cased column on the new table. The backend's T1
          // target_field (against an unrelated canonical) is discarded, and
          // semantic is never an option here. The user can still rename the
          // target via fieldRenames; otherwise we snake_case the source name.
          const explicit = (fieldRenames[k] ?? "").trim();
          return {
            source_field: item.source_field,
            decision: "approve" as const,
            target_field: explicit || toSnakeCase(item.source_field),
            data_type: newColumnTypes[k] ?? inferDataType(item.source_field),
          };
        }
        const renamed = (fieldRenames[k] ?? "").trim();
        return {
          source_field: item.source_field,
          decision: decisions[k] ?? "approve",
          ...(renamed && renamed !== item.target_field ? { target_field: renamed } : {}),
        };
      });
    }
    // Unresolved ("left-out") source fields.
    //   - Existing table: only emit if the user manually assigned a leftover
    //     target column; otherwise drop and let Tier 2 semantic find a match.
    //   - NEW table: auto-approve every unresolved field with its snake_cased
    //     name. Skipping them here would push them into semantic Tier 2 against
    //     a non-existent target, which is exactly the bug we're fixing.
    //
    // The "exactSug" fallback below mirrors the render-side default in the
    // unresolved-field dropdown (line ~849): when a leftover canonical column
    // has the same normalised name as the source field, the dropdown defaults
    // to that column AND shows the green "assigned" badge. Without the same
    // fallback here, a user who left the auto-default in place would see
    // "assigned" but the field would be SILENTLY dropped from the submission —
    // landing in unresolved_by_table and surfacing as "unmappable" at the
    // semantic step. This is the parenthesis-in-column-name bug ("Distance (km)"
    // normCol-matches a "distance_km" leftover column → looks assigned → was
    // never sent).
    const normColSubmit = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const [tbl, fields] of Object.entries(unresolvedByTable)) {
      const isNewTbl = !!tableTargets[tbl]?.isNew;
      // Compute the same leftoverCols set the render uses for this table so
      // the exactSug fallback resolves identically here.
      const confirmedTargetSubmit = tableTargets[tbl]?.target ?? tbl;
      const targetColsKeySubmit = Object.keys(canonicalColumnsByTable).find(
        (k) => k.toLowerCase() === confirmedTargetSubmit.toLowerCase(),
      );
      const targetColsSubmit = targetColsKeySubmit
        ? canonicalColumnsByTable[targetColsKeySubmit]
        : [];
      const itemsSubmit = reviewByTable[tbl] ?? [];
      const usedTargetsSubmit = new Set(
        itemsSubmit.map((it) =>
          normColSubmit(fieldRenames[`${tbl}.${it.source_field}`] ?? it.target_field),
        ),
      );
      const leftoverColsSubmit = targetColsSubmit.filter(
        (c) => !usedTargetsSubmit.has(normColSubmit(c)),
      );
      for (const field of fields) {
        if (isNewTbl) {
          const explicit = (fieldRenames[`${tbl}.${field}`] ?? "").trim();
          (decisionsBody[tbl] ??= []).push({
            source_field: field,
            decision: "approve",
            target_field: explicit || toSnakeCase(field),
            data_type: newColumnTypes[`${tbl}.${field}`] ?? inferDataType(field),
          });
          continue;
        }
        const explicitAssign = (unresolvedAssign[`${tbl}.${field}`] ?? "").trim();
        const exactSug = leftoverColsSubmit.find(
          (c) => normColSubmit(c) === normColSubmit(field),
        ) ?? "";
        const assigned = explicitAssign || exactSug;
        if (!assigned) continue;
        (decisionsBody[tbl] ??= []).push({
          source_field: field,
          decision: "approve",
          target_field: assigned,
        });
      }
    }
    const tableOverrides: NonNullable<MigrationGatePreSemanticRequest["table_overrides"]> = {};
    for (const tbl of allTables) {
      const t = tableTargets[tbl];
      const target = (t?.target ?? "").trim();
      if (!target) continue;
      if (t?.isNew || target !== tbl) {
        tableOverrides[tbl] = { target_table: target, is_new_table: !!t?.isNew };
      }
    }
    const body: MigrationGatePreSemanticRequest = {
      decisions: decisionsBody,
      ...(Object.keys(tableOverrides).length ? { table_overrides: tableOverrides } : {}),
    };
    const snapshot = { gate: "pre_semantic" as const, payload, decisions: decisionsBody };
    lastSubmitRef.current = { body, snapshot };
    setError(null);
    setIsPreflighting(true);
    schemaMapperApi
      .getMigrationStatus(migrationId)
      .then((latest) => {
        const latestStatus = latest.status;
        if (latestStatus === "failed" || latestStatus === "ddl_failed" || latestStatus === "cancelled") {
          onSubmitted();
          return;
        }
        if (latestStatus === "step_paused") {
          advance({ migrationId });
          return;
        }
        if (latestStatus !== "awaiting_review") {
          setError(`Cannot submit pre-semantic decisions yet. Current migration status is: ${latestStatus}`);
          return;
        }
        const gateType = String(latest.pending_gate_type ?? "").toLowerCase();
        const isPreSemanticGate = gateType.includes("pre") && gateType.includes("semantic");
        if (!isPreSemanticGate) {
          setError(
            `Review step changed to '${latest.pending_gate_type ?? "unknown"}'. Please submit in the active gate.`,
          );
          return;
        }
        submitGate({ migrationId, body }, { onSuccess: () => onSubmitted(snapshot) });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to verify migration status before submit";
        setError(`${msg}. Please retry to continue safely.`);
      })
      .finally(() => {
        setIsPreflighting(false);
      });
  }

  // Count decisions, but treat every column under an isNew table as approved
  // regardless of the in-memory `decisions` map state — those columns are
  // deterministically approved at submit time (T1_new_table) and never reach
  // semantic. Mirroring that here keeps the counters honest.
  let countApproved = 0;
  let countSemantic = 0;
  for (const [tbl, items] of Object.entries(reviewByTable)) {
    const isNewTbl = !!tableTargets[tbl]?.isNew;
    for (const it of items) {
      const k = `${tbl}.${it.source_field}`;
      if (isNewTbl) {
        countApproved += 1;
        continue;
      }
      const v = decisions[k] ?? "approve";
      if (v === "approve") countApproved += 1;
      else if (v === "semantic") countSemantic += 1;
    }
  }
  // Unresolved fields under new tables become auto-approved new columns.
  // For existing tables, an unresolved field is approved only if the user
  // explicitly assigned a leftover column OR the dropdown defaulted to an
  // exact-name leftover (exactSug) — that one we count here to keep the
  // header counter consistent with what handleSubmit() will actually send.
  {
    const normColCount = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const [tbl, fields] of Object.entries(unresolvedByTable)) {
      if (tableTargets[tbl]?.isNew) {
        countApproved += fields.length;
        continue;
      }
      const confirmedTarget = tableTargets[tbl]?.target ?? tbl;
      const targetColsKey = Object.keys(canonicalColumnsByTable).find(
        (k) => k.toLowerCase() === confirmedTarget.toLowerCase(),
      );
      const targetCols = targetColsKey ? canonicalColumnsByTable[targetColsKey] : [];
      const items = reviewByTable[tbl] ?? [];
      const usedTargets = new Set(
        items.map((it) =>
          normColCount(fieldRenames[`${tbl}.${it.source_field}`] ?? it.target_field),
        ),
      );
      const leftoverCols = targetCols.filter((c) => !usedTargets.has(normColCount(c)));
      for (const field of fields) {
        const explicit = (unresolvedAssign[`${tbl}.${field}`] ?? "").trim();
        const exactSug =
          leftoverCols.find((c) => normColCount(c) === normColCount(field)) ?? "";
        if (explicit || exactSug) countApproved += 1;
      }
    }
  }
  const totalItems =
    Object.values(reviewByTable).flat().length +
    Object.entries(unresolvedByTable).reduce(
      (acc, [tbl, fields]) => acc + (tableTargets[tbl]?.isNew ? fields.length : 0),
      0,
    );
  const handleRefreshGate = () => {
    setError(null);
  };

  // Two-phase gate: Step 1 confirms every sheet → CAFM table; Step 2 reviews the
  // columns of each confirmed table. Always starts on tables ("confirm always").
  const [phase, setPhase] = useState<"tables" | "columns">("tables");

  // How each sheet arrived at its current target: exact name match, semantic
  // guess (name differs but routed to an existing table), auto-classified as a
  // brand-new table (no canonical match), or fully unset.
  function tableMatchType(tbl: string): "exact" | "semantic" | "new" | "none" {
    const t = tableTargets[tbl];
    if (t?.isNew) return "new";
    const target = (t?.target ?? "").trim();
    if (!target) return "none";
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const a = norm(tbl);
    const b = norm(target);
    const exact = a === b || a.replace(/s$/, "") === b.replace(/s$/, "");
    return exact ? "exact" : "semantic";
  }
  const routingComplete = allSourceTables.every((t) => (tableTargets[t]?.target ?? "").trim().length > 0);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
          <CheckCircle size={20} className="text-indigo-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900">
            {phase === "tables" ? "Step 1 — Confirm table routing" : "Step 2 — Column matching"}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {phase === "tables"
              ? "Each Excel sheet is matched to a CAFM table. Sheets with no exact name match get a semantic guess — change any target, then confirm to start column matching."
              : "Fields matched against the confirmed table. Approve confident matches or send uncertain ones to semantic search. Rename a target column if needed — changes carry through to the database write."}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold font-mono text-slate-800">
            {phase === "tables" ? allTables.length : totalItems}
          </div>
          <div className="text-xs text-slate-500">{phase === "tables" ? "sheets" : "fields to review"}</div>
        </div>
      </div>

      {phase === "tables" ? (
        <div className="mb-6">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
            {allSourceTables.map((tbl) => {
              const mt = tableMatchType(tbl);
              return (
                <div key={tbl} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{tbl}</span>
                    <ArrowRight size={12} className="text-slate-300 shrink-0" />
                    {mt === "exact" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        exact name match
                      </span>
                    ) : mt === "semantic" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        semantic guess
                      </span>
                    ) : mt === "new" ? (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700"
                        title="No existing CAFM table matched. This sheet will be created as a new table — columns are auto-generated from the source."
                      >
                        new table
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        pick a table
                      </span>
                    )}
                  </div>
                  <MigrationCanonicalTableSelect
                    sourceTable={tbl}
                    canonicalTables={canonicalTargetTables}
                    value={tableTargets[tbl]?.isNew ? "" : (tableTargets[tbl]?.target ?? tbl)}
                    isNewTable={tableTargets[tbl]?.isNew ?? false}
                    newTableName={tableTargets[tbl]?.isNew ? (tableTargets[tbl]?.target ?? "") : ""}
                    onChange={({ canonicalTable, isNewTable, newTableName }) =>
                      applyTableTarget(tbl, isNewTable ? newTableName : canonicalTable, isNewTable)
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-end mt-4">
            <button
              onClick={() => setPhase("columns")}
              disabled={!routingComplete}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Confirm routing
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      ) : (
      <>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setPhase("tables")}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowRight size={13} className="rotate-180" />
          Back to table routing
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "T1 Approved",      value: countApproved,    color: "text-green-600" },
          { label: "→ Semantic (you)", value: countSemantic,    color: "text-blue-600" },
          { label: "Auto → Semantic",  value: totalAutoSemantic, color: "text-amber-600" },
          { label: "Tables",           value: allTables.length, color: "text-slate-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 text-center">
            <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Tier breakdown */}
      {Object.keys(tierCounts).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {Object.entries(tierCounts).sort((a, b) => b[1] - a[1]).map(([tier, count]) => (
            <span key={tier} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${TIER_COLORS[tier] ?? "bg-slate-100 text-slate-600"}`}>
              {tier.replace("T1_", "")}: {count}
            </span>
          ))}
        </div>
      )}

      {/* Bulk action */}
      {totalItems > 0 && (
        <div className="flex justify-end mb-4">
          <button
            onClick={approveAll}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            <CheckCircle size={14} />
            Approve all
          </button>
        </div>
      )}

      {/* Table cards */}
      <div className="space-y-3 mb-6">
        {Array.from(new Set([...allTables, ...Object.keys(unresolvedByTable)])).map((tbl) => {
          const items: MigrationPreSemanticReviewItem[] = reviewByTable[tbl] ?? [];
          const unresolved = unresolvedByTable[tbl] ?? [];
          const isOpen = expandedTables.has(tbl);
          // Columns of the confirmed target table — the per-field target becomes a
          // dropdown of these so the user can remap a column to any real column.
          const confirmedTarget = tableTargets[tbl]?.target ?? tbl;
          const targetColsKey = Object.keys(canonicalColumnsByTable).find(
            (k) => k.toLowerCase() === confirmedTarget.toLowerCase(),
          );
          const targetCols = targetColsKey ? canonicalColumnsByTable[targetColsKey] : [];
          // Suggest a leftover (not-yet-mapped) target column for each unresolved
          // source field — shown as a hint while the field still routes to semantic.
          const normCol = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          const usedTargets = new Set(
            items.map((it) =>
              normCol(fieldRenames[`${tbl}.${it.source_field}`] ?? it.target_field),
            ),
          );
          const leftoverCols = targetCols.filter((c) => !usedTargets.has(normCol(c)));
          const isNewTbl = !!tableTargets[tbl]?.isNew;
          const allApproved =
            isNewTbl
              ? items.length + unresolved.length > 0
              : items.length > 0 && items.every(
                  (item) => (decisions[`${tbl}.${item.source_field}`] ?? "approve") === "approve"
                );

          return (
            <div key={tbl} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                onClick={() => toggleTable(tbl)}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm">{tbl}</span>
                  {isNewTbl ? (
                    <>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        new table
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        {items.length + unresolved.length} T1_new_table
                      </span>
                    </>
                  ) : (
                    <>
                      {items.length > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          {items.length} T1
                        </span>
                      )}
                      {unresolved.length > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          {unresolved.length} → semantic
                        </span>
                      )}
                    </>
                  )}
                  {allApproved && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      All approved
                    </span>
                  )}
                </div>
                {isOpen
                  ? <ChevronUp size={16} className="text-slate-400 shrink-0" />
                  : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {items.length > 0 && (
                    <div className="px-5 py-2.5 bg-slate-50 flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Target table:</span>
                      <span className="font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                        {tableTargets[tbl]?.target || tbl}
                      </span>
                      {tableTargets[tbl]?.isNew && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700">
                          new table
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhase("tables");
                        }}
                        className="ml-auto text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Change
                      </button>
                    </div>
                  )}
                  {tableTargets[tbl]?.isNew && (items.length > 0 || unresolved.length > 0) && (
                    <div className="px-5 py-3 bg-indigo-50/60 text-xs text-indigo-900 border-b border-indigo-100">
                      <div className="font-medium mb-0.5">New table — no column matching needed.</div>
                      <div className="text-indigo-800/80">
                        The target schema doesn&rsquo;t exist in CAFM yet. Source columns
                        below will be created as-is on the new table; you can still rename
                        any target column. No matches against an unrelated existing table
                        will be applied.
                      </div>
                    </div>
                  )}
                  {items.length === 0 && unresolved.length === 0 && (
                    <div className="px-5 py-4 text-sm text-slate-400">
                      {tableTargets[tbl]?.isNew
                        ? "This new table will be created with the columns detected in the source."
                        : "No fields in this table."}
                    </div>
                  )}
                  {items.map((item, idx) => {
                    const key = `${tbl}.${item.source_field}`;
                    const isNewTbl = !!tableTargets[tbl]?.isNew;
                    // NEW table: target defaults to snake_case(source); the
                    // backend's canonical match (against an unrelated table) is
                    // discarded. EXISTING table: keep the backend's target_field.
                    const newTableTarget = isNewTbl ? toSnakeCase(item.source_field) : item.target_field;
                    const defaultTarget = isNewTbl ? newTableTarget : item.target_field;
                    const action = isNewTbl ? "approve" : (decisions[key] ?? "approve");
                    const confPct = Math.round((item.confidence ?? 0) * 100);
                    // When the user re-targeted this table, the row reflects the
                    // match against the NEW table instead of the original tier/conf.
                    const remap = isNewTbl ? undefined : remapByTable[tbl]?.[item.source_field];
                    const effectiveTarget = tableTargets[tbl]?.target ?? tbl;

                    return (
                      <div key={idx} className="px-5 py-3 flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleTermClick(item.source_field)}
                              className={`font-mono text-xs px-2 py-0.5 rounded transition-colors cursor-pointer ${
                                focusedTerm === item.source_field
                                  ? "bg-amber-200 text-slate-900 ring-1 ring-amber-400"
                                  : "bg-slate-100 text-slate-700 hover:bg-amber-100"
                              }`}
                            >
                              {item.source_field}
                            </button>
                            <ArrowRight size={11} className="text-slate-300 shrink-0" />
                            {!isNewTbl && targetCols.length ? (
                              <select
                                value={fieldRenames[key] ?? item.target_field}
                                onChange={(e) =>
                                  setFieldRenames((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                title="Target column — pick any column on the target table"
                                className={`font-mono text-xs px-2 py-1 rounded border w-44 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                                  (fieldRenames[key] ?? item.target_field) !== item.target_field
                                    ? "border-amber-300 bg-amber-50 text-amber-800"
                                    : "border-indigo-100 bg-indigo-50 text-indigo-700"
                                }`}
                              >
                                {(() => {
                                  const cur = fieldRenames[key] ?? item.target_field;
                                  const opts = targetCols.includes(cur) ? targetCols : [cur, ...targetCols];
                                  return opts.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ));
                                })()}
                              </select>
                            ) : (
                              <input
                                value={fieldRenames[key] ?? defaultTarget}
                                onChange={(e) =>
                                  setFieldRenames((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                onFocus={() => handleTermClick(defaultTarget)}
                                spellCheck={false}
                                title={isNewTbl ? "New column name — defaults to snake_case of the source" : "Target column — edit to rename"}
                                className={`font-mono text-xs px-2 py-0.5 rounded border w-40 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                                  isNewTbl
                                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                    : (fieldRenames[key] ?? item.target_field) !== item.target_field
                                      ? "border-amber-300 bg-amber-50 text-amber-800"
                                      : "border-indigo-100 bg-indigo-50 text-indigo-700"
                                }`}
                              />
                            )}
                            {isNewTbl ? (
                              <>
                                <select
                                  value={newColumnTypes[`${tbl}.${item.source_field}`] ?? inferDataType(item.source_field)}
                                  onChange={(e) =>
                                    setNewColumnTypes((prev) => ({ ...prev, [`${tbl}.${item.source_field}`]: e.target.value }))
                                  }
                                  title="SQL type for the new column"
                                  className="font-mono text-xs px-2 py-1 rounded border border-indigo-200 bg-white text-indigo-700 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                >
                                  {DATA_TYPES.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                                  T1_new_table
                                </span>
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                                  <CheckCircle size={12} />Auto-approved
                                </span>
                              </>
                            ) : remap ? (
                              remap.matched ? (
                                <>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    table_exact
                                  </span>
                                  <span className="text-xs font-mono font-semibold text-green-600">exact</span>
                                </>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                  → semantic
                                </span>
                              )
                            ) : (
                              <>
                                <TierBadge tier={item.tier} />
                                <span className={`text-xs font-mono font-semibold ${
                                  confPct >= 95 ? "text-green-600" : confPct >= 85 ? "text-amber-600" : "text-red-500"
                                }`}>{confPct}%</span>
                              </>
                            )}
                          </div>
                          {remap ? (
                            <p className="text-xs text-slate-400 mt-1 truncate">
                              {remap.matched
                                ? `Exact column match on target table '${effectiveTarget}'`
                                : `No '${item.source_field}' column in '${effectiveTarget}' — will be sent to semantic`}
                            </p>
                          ) : item.rationale ? (
                            <p className="text-xs text-slate-400 mt-1 truncate">{item.rationale}</p>
                          ) : null}
                        </div>
                        {isNewTbl ? null : (
                          <div className="flex gap-1.5 shrink-0 pt-0.5">
                            <button
                              onClick={() => setDecision(tbl, item.source_field, "approve")}
                              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                                action === "approve" ? "bg-green-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >
                              <CheckCircle size={12} />Approve
                            </button>
                            <button
                              onClick={() => setDecision(tbl, item.source_field, "semantic")}
                              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                                action === "semantic" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >
                              <Search size={12} />Semantic
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Unresolved ("left-out") source fields. Offer a dropdown of the
                      leftover target columns so the user can assign one, else semantic. */}
                  {unresolved.map((field) => {
                    const k = `${tbl}.${field}`;
                    const exactSug = leftoverCols.find((c) => normCol(c) === normCol(field)) ?? "";
                    const assigned = unresolvedAssign[k] ?? exactSug;
                    const isNewTbl = !!tableTargets[tbl]?.isNew;
                    if (isNewTbl) {
                      // NEW table: every unresolved field is auto-approved as
                      // a new column on the new table. No semantic option, no
                      // canonical leftover dropdown — the column is deterministic.
                      const renameKey = `${tbl}.${field}`;
                      const newColName = (fieldRenames[renameKey] ?? "").trim() || toSnakeCase(field);
                      return (
                        <div key={field} className="px-5 py-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500">{field}</span>
                            <ArrowRight size={11} className="text-slate-300 shrink-0" />
                            <input
                              value={newColName}
                              onChange={(e) =>
                                setFieldRenames((prev) => ({ ...prev, [renameKey]: e.target.value }))
                              }
                              spellCheck={false}
                              title="New column name — defaults to snake_case of the source"
                              className="font-mono text-xs px-2 py-0.5 rounded border w-40 border-indigo-200 bg-indigo-50 text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                            <select
                              value={newColumnTypes[renameKey] ?? inferDataType(field)}
                              onChange={(e) =>
                                setNewColumnTypes((prev) => ({ ...prev, [renameKey]: e.target.value }))
                              }
                              title="SQL type for the new column"
                              className="font-mono text-xs px-2 py-1 rounded border border-indigo-200 bg-white text-indigo-700 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            >
                              {DATA_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                              T1_new_table
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 shrink-0">
                            <CheckCircle size={12} />Auto-approved
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={field} className="px-5 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500">{field}</span>
                          <ArrowRight size={11} className="text-slate-300 shrink-0" />
                          {leftoverCols.length ? (
                            <select
                              value={assigned}
                              onChange={(e) =>
                                setUnresolvedAssign((prev) => ({ ...prev, [k]: e.target.value }))
                              }
                              title="Assign a leftover column on the target table, or send to semantic"
                              className={`font-mono text-xs px-2 py-1 rounded border w-44 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                                assigned ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-500"
                              }`}
                            >
                              <option value="">→ semantic (let AI match)</option>
                              {leftoverCols.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-slate-400 italic">no remaining column</span>
                          )}
                          {assigned ? (
                            <span className="text-[10px] text-slate-400">on {confirmedTarget}</span>
                          ) : null}
                        </div>
                        {assigned ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 shrink-0">
                            <CheckCircle size={12} />assigned
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                            <Search size={12} />→ Semantic
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <div>{error}</div>
          <button
            type="button"
            onClick={handleRefreshGate}
            className="mt-2 inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            Continue / Refresh gate
          </button>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isPending || isAdvancing || isPreflighting}
        className="inline-flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white text-base font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {isPending || isAdvancing || isPreflighting ? (
          <>
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            {isPreflighting ? "Checking status…" : "Submitting…"}
          </>
        ) : (
          <>
            <CheckCircle size={18} />
            Confirm — {countApproved} approved · {countSemantic} → semantic
          </>
        )}
      </button>
      </>
      )}
    </div>
  );
}
