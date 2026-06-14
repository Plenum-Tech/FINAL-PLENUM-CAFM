"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useImportWizard } from "@/store/importWizard";
import { Button, Card, CardContent, toast } from "@/components/ui";
import { fetchSchemaTables, getApiErrorMessage, isUnauthorized, type SchemaTable } from "../api";

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");
}

function simplifyForMatch(value: string): string {
  const v = normalizeKey(value).replace(/_/g, "");
  return v.replace(/^asset/, "").replace(/^workorder/, "").replace(/^vendor/, "");
}

function detectDelimiter(line: string): string {
  const candidates = [",", ";", "\t", "|"] as const;
  let best: (typeof candidates)[number] = ",";
  let bestCount = -1;
  for (const c of candidates) {
    const count = line.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

async function parseHeadersFromFile(file: File, format: string): Promise<string[]> {
  if (format === "csv") {
    const text = await file.text();
    const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    if (!firstLine) return [];
    const delim = detectDelimiter(firstLine);
    return firstLine
      .split(delim)
      .map((h) => h.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }

  if (format === "json") {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      const first = parsed.find((x) => typeof x === "object" && x !== null) as Record<string, unknown> | undefined;
      return first ? Object.keys(first) : [];
    }
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const arrayValue = Object.values(obj).find((v) => Array.isArray(v)) as unknown[] | undefined;
      if (arrayValue) {
        const first = arrayValue.find((x) => typeof x === "object" && x !== null) as Record<string, unknown> | undefined;
        return first ? Object.keys(first) : [];
      }
      return Object.keys(obj);
    }
    return [];
  }

  if (format === "xml") {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const root = doc.documentElement;
    if (!root) return [];
    const firstRow = Array.from(root.children).find((n) => n.children && n.children.length > 0) ?? null;
    if (!firstRow) return [];
    return Array.from(firstRow.children)
      .map((n) => n.tagName)
      .filter(Boolean);
  }

  return ["name", "code", "category"];
}

export function StepFieldMapping() {
  const router = useRouter();
  const { mapping, setMapping, connection, file, tableName, setTableName } = useImportWizard();

  const tablesQuery = useQuery<SchemaTable[], unknown>({
    queryKey: ["schema-tables"],
    retry: 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => fetchSchemaTables({ signal }),
  });

  useEffect(() => {
    const e = tablesQuery.error;
    if (!e) return;
    if (isUnauthorized(e)) router.replace("/login");
  }, [router, tablesQuery.error]);

  const tables = tablesQuery.data ?? [];
  const [selectedTable, setSelectedTable] = useState<string>(tableName ?? "");
  const [tableSearch, setTableSearch] = useState<string>("");
  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tableSearch, tables]);
  const activeTable = useMemo(
    () => tables.find((t) => t.name === selectedTable) ?? null,
    [selectedTable, tables],
  );
  const fields = activeTable?.columns ?? [];

  const [headers, setHeaders] = useState<string[]>([]);
  const [headersLoading, setHeadersLoading] = useState(false);

  useEffect(() => {
    const isFile = connection?.kind === "file";
    if (!isFile || !file) {
      setHeaders(["name", "code", "category"]);
      return;
    }

    setHeadersLoading(true);
    parseHeadersFromFile(file, connection.format)
      .then((h) => {
        setHeaders(h.length ? h : ["name", "code", "category"]);
      })
      .catch((e) => {
        setHeaders(["name", "code", "category"]);
        toast({ title: "Header parse failed", description: String((e as Error)?.message ?? e), variant: "destructive" });
      })
      .finally(() => setHeadersLoading(false));
  }, [connection, file]);

  useEffect(() => {
    if (tablesQuery.isLoading) return;
    if (!tables.length) return;
    if (tableName) {
      setSelectedTable(tableName);
      return;
    }
    const first = tables[0]?.name ?? "";
    if (!first) return;
    setSelectedTable(first);
    setTableName(first);
  }, [setSelectedTable, setTableName, tableName, tables, tablesQuery.isLoading]);

  const [local, setLocal] = useState(() =>
    mapping.length ? mapping : fields.map((t) => ({ source: "", target: t })),
  );

  useEffect(() => {
    if (mapping.length) return;
    if (!fields.length) return;
    const next = fields.map((t) => ({ source: "", target: t }));
    setLocal(next);
    setMapping(next);
  }, [fields, mapping.length, setMapping]);

  const autoSuggest = () => {
    if (!fields.length) {
      toast({ title: "Select a table first", variant: "destructive" });
      return;
    }
    const next = fields.map((t) => {
      const targetNorm = simplifyForMatch(t);
      const exact = headers.find((h) => simplifyForMatch(h) === targetNorm);
      const near =
        exact ??
        headers.find((h) => simplifyForMatch(h).includes(targetNorm) || targetNorm.includes(simplifyForMatch(h)));
      return { source: near ?? "", target: t };
    });
    setLocal(next);
    setMapping(next);
    toast({ title: "Auto mapping applied", variant: "success" });
  };

  const assign = (t: string, s: string) => {
    const next = local.map((p) => (p.target === t ? { ...p, source: s } : p));
    setLocal(next);
    setMapping(next);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Select Table</p>
            {tablesQuery.isError ? (
              <div className="space-y-2">
                <p className="text-xs text-destructive">{getApiErrorMessage(tablesQuery.error)}</p>
                <Button size="sm" variant="secondary" onClick={() => tablesQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search table..."
                  className="h-9 w-full sm:w-[260px] rounded-md border border-input bg-transparent px-3 text-sm"
                />
                <select
                  className="h-9 w-full sm:w-[260px] rounded-md border border-input bg-transparent px-3 text-sm"
                  value={selectedTable}
                  disabled={tablesQuery.isLoading || tables.length === 0}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSelectedTable(next);
                    setTableName(next);
                    const t = tables.find((x) => x.name === next);
                    const nextPairs = (t?.columns ?? []).map((col) => ({ source: "", target: col }));
                    setLocal(nextPairs);
                    setMapping(nextPairs);
                  }}
                >
                  {tablesQuery.isLoading ? <option value="">Loading...</option> : null}
                  {filteredTables.length === 0 ? <option value="">No tables found</option> : null}
                  {filteredTables.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex gap-2 sm:self-end">
        <Button
          size="sm"
          variant="secondary"
          onClick={autoSuggest}
          disabled={headersLoading || tablesQuery.isLoading || !fields.length}
        >
              {headersLoading ? "Reading headers..." : "Auto‑suggest"}
            </Button>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                File Headers
              </p>
              <ul className="rounded-md border border-border divide-y">
                {headers.map((f) => (
                  <li key={f} className="px-3 py-2 text-sm">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
                {(activeTable?.name ?? "table")} fields mapping
              </p>
              {fields.length === 0 ? (
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  No columns for selected table.
                </div>
              ) : (
                <div className="rounded-md border border-border divide-y">
                  {local.map((pair) => (
                    <div
                      key={pair.target}
                      className="grid grid-cols-1 sm:grid-cols-[1fr_40px_1fr] items-center gap-2 px-3 py-2"
                    >
                      <div className="text-sm font-medium">{pair.target}</div>
                      <div className="hidden sm:flex items-center justify-center text-muted-foreground">→</div>
                      <div>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                          value={pair.source}
                          onChange={(e) => assign(pair.target, e.target.value)}
                        >
                          <option value="">— select —</option>
                          {headers.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
