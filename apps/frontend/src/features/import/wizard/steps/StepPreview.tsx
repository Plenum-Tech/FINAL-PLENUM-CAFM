"use client";

import { useEffect, useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useImportWizard, type PreviewColumn, type PreviewRow } from "@/store/importWizard";
import { Badge, Button, toast } from "@/components/ui";
import { fetchPreview, getApiErrorMessage, isUnauthorized } from "../api";

const agGridGlobal = globalThis as unknown as { __cafmAgGridModulesRegistered?: boolean };
if (!agGridGlobal.__cafmAgGridModulesRegistered) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  agGridGlobal.__cafmAgGridModulesRegistered = true;
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

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

async function parseFilePreview(input: {
  file: File;
  format: string;
  limit: number;
}): Promise<{ headers: string[]; rows: Array<Record<string, unknown>> }> {
  if (input.format === "csv") {
    const text = await input.file.slice(0, 1024 * 256).text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const headerLine = lines[0] ?? "";
    if (!headerLine) return { headers: [], rows: [] };
    const delimiter = detectDelimiter(headerLine);
    const headers = parseCsvLine(headerLine, delimiter).map((h) => h.replace(/^"|"$/g, "").trim());
    const rows = lines.slice(1, input.limit + 1).map((line) => {
      const values = parseCsvLine(line, delimiter);
      return headers.reduce<Record<string, unknown>>((acc, h, idx) => {
        acc[h] = values[idx] ?? "";
        return acc;
      }, {});
    });
    return { headers, rows };
  }

  if (input.format === "json") {
    if (input.file.size > 5 * 1024 * 1024) throw new Error("JSON file too large for browser preview.");
    const text = await input.file.text();
    const parsed = JSON.parse(text) as unknown;
    let arr: Array<Record<string, unknown>> = [];
    if (Array.isArray(parsed)) {
      arr = parsed.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
    } else if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const arrayValue = Object.values(obj).find((v) => Array.isArray(v)) as unknown[] | undefined;
      if (arrayValue) {
        arr = arrayValue.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
      } else {
        arr = [obj];
      }
    }
    const rows = arr.slice(0, input.limit);
    const headers = Array.from(
      new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => typeof k === "string" && k.trim().length > 0)),
    );
    return { headers, rows };
  }

  if (input.format === "xml") {
    if (input.file.size > 5 * 1024 * 1024) throw new Error("XML file too large for browser preview.");
    const text = await input.file.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const root = doc.documentElement;
    if (!root) return { headers: [], rows: [] };
    const children = Array.from(root.children).slice(0, input.limit);
    const rows = children.map((node) => {
      const record: Record<string, unknown> = {};
      Array.from(node.children).forEach((c) => {
        record[c.tagName] = c.textContent ?? "";
      });
      return record;
    });
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return { headers, rows };
  }

  throw new Error(`Preview for ${input.format.toUpperCase()} is not supported in browser yet.`);
}

function buildMappedPreview(input: {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  mapping: Array<{ source: string; target: string }>;
}): { columns: PreviewColumn[]; rows: PreviewRow[] } {
  const cleaned = input.mapping.filter((m) => m.source && m.target);
  if (cleaned.length === 0) {
    const columns = input.headers.map((h) => ({ field: h, type: "string" }));
    return { columns, rows: input.rows };
  }
  const columns = cleaned.map((m) => ({ field: m.target, type: "string" }));
  const mappedRows = input.rows.map((r) =>
    cleaned.reduce<Record<string, unknown>>((acc, m) => {
      acc[m.target] = r[m.source] ?? "";
      return acc;
    }, {}),
  );
  return { columns, rows: mappedRows };
}

export function StepPreview() {
  const router = useRouter();
  const { previewColumns, previewRows, setPreview, connectorId, connection, file, mapping, tableName } =
    useImportWizard();
  const lastToastKey = useRef<string>("");

  const requestKey = useMemo(() => {
    if (connection?.kind === "file") {
      const f = file;
      const m = mapping
        .filter((x) => x.source && x.target)
        .map((x) => `${x.target}=${x.source}`)
        .join("|");
      return `file:${connection.format}:${f?.name ?? ""}:${f?.size ?? ""}:${f?.lastModified ?? ""}:${tableName ?? ""}:${m}`;
    }
    const m = mapping
      .filter((x) => x.source && x.target)
      .map((x) => `${x.target}=${x.source}`)
      .join("|");
    return `conn:${connectorId ?? ""}:${tableName ?? ""}:${m}`;
  }, [
    connection?.kind,
    connection && "format" in connection ? connection.format : undefined,
    connectorId,
    file,
    mapping,
    tableName,
  ]);

  const previewQuery = useQuery<{ columns: PreviewColumn[]; rows: PreviewRow[] }, unknown>({
    queryKey: ["import-preview", requestKey],
    enabled:
      Boolean(connection) &&
      (connection?.kind === "file" ? Boolean(file) : Boolean(connectorId)),
    retry: 0,
    queryFn: async ({ signal }) => {
      if (connection?.kind === "file") {
        if (!file) throw new Error("Please select a file first.");
        if (signal.aborted) throw new Error("Aborted");
        const { headers, rows } = await parseFilePreview({ file, format: connection.format, limit: 50 });
        return buildMappedPreview({ headers, rows, mapping });
      }
      if (!connectorId) throw new Error("Connector not saved yet.");
      if (!tableName) throw new Error("Please select a table first.");
      return fetchPreview({ connectorId, tableName, mapping, signal });
    },
  });

  useEffect(() => {
    const data = previewQuery.data;
    if (!data) return;
    setPreview(data.columns, data.rows);
  }, [previewQuery.data, setPreview]);

  useEffect(() => {
    const e = previewQuery.error;
    if (!e) return;
    if (isUnauthorized(e)) router.replace("/login");
  }, [previewQuery.error, router]);

  useEffect(() => {
    if (!previewQuery.isFetched) return;
    if (lastToastKey.current === requestKey) return;
    lastToastKey.current = requestKey;
    if (previewQuery.isSuccess) {
      toast({ title: "Preview loaded", variant: "success" });
      return;
    }
    if (previewQuery.isError) {
      toast({
        title: "Preview failed",
        description: getApiErrorMessage(previewQuery.error),
        variant: "destructive",
      });
    }
  }, [previewQuery.error, previewQuery.isError, previewQuery.isFetched, previewQuery.isSuccess, requestKey]);

  const colDefs = useMemo<ColDef[]>(
    () =>
      (previewColumns.length ? previewColumns : []).map((c) => ({
        field: c.field,
        headerName: c.field,
        cellRenderer: c.field === "status" ? statusRenderer : undefined,
      })),
    [previewColumns],
  );

  const loading = previewQuery.isFetching;
  const error = previewQuery.isError ? getApiErrorMessage(previewQuery.error) : null;

  return (
    <div className="ag-theme-quartz w-full">
      {error ? (
        <div className="space-y-2 rounded-md border border-border p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await previewQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {loading ? (
        <div className="h-64 animate-pulse rounded-md bg-muted/50" />
      ) : (
        <AgGridReact
          theme="legacy"
          rowData={previewRows}
          columnDefs={colDefs}
          domLayout="autoHeight"
          suppressMenuHide
          rowHeight={36}
        />
      )}
    </div>
  );
}

function statusRenderer(params: { value?: unknown }) {
  const v = String(params.value ?? "");
  const variant: "success" | "warning" | "destructive" =
    v === "active" ? "success" : v === "maintenance" || v === "warning" ? "warning" : "destructive";
  return Badge({ variant, children: v });
}
