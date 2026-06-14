"use client";

import { env } from "@/config";
import { apiFetch, ApiError } from "@/services/api";
import type {
  ConflictMode,
  ConnectionPayload,
  MappingPair,
  PreviewColumn,
  PreviewRow,
  ScheduleMode,
} from "@/store/importWizard";

type ImportRunConfig = {
  schedule: { mode: ScheduleMode; cron?: string };
  conflict: ConflictMode;
};

type ApiSourceType =
  | "postgresql"
  | "mysql"
  | "mssql"
  | "mongodb"
  | "csv"
  | "excel"
  | "json"
  | "xml"
  | "parquet"
  | "rest"
  | "soap"
  | "odata";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOrganizationId(): string {
  return env.organizationId || "2dcfd411-3676-465e-a3c0-ae2c0e1e4caa";
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function pickString(obj: unknown, keys: string[]): string | null {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = obj[k];
    const s = getString(v);
    if (s) return s;
  }
  return null;
}

function extractNestedString(obj: unknown, path: string[]): string | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return null;
    cur = cur[key];
  }
  return getString(cur);
}

export function getApiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message || "Something went wrong";
  return "Something went wrong";
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

function toApiSourceType(sourceType: string): ApiSourceType {
  if (sourceType === "postgres") return "postgresql";
  if (sourceType === "mysql") return "mysql";
  if (sourceType === "mssql") return "mssql";
  if (sourceType === "mongodb") return "mongodb";
  if (sourceType === "csv") return "csv";
  if (sourceType === "excel") return "excel";
  if (sourceType === "json") return "json";
  if (sourceType === "xml") return "xml";
  if (sourceType === "parquet") return "parquet";
  if (sourceType === "rest") return "rest";
  if (sourceType === "soap") return "soap";
  return "odata";
}

function toConflictMode(mode: ConflictMode): string {
  if (mode === "skip") return "skip";
  if (mode === "overwrite") return "overwrite";
  return "flag";
}

function toScheduleValue(schedule: ImportRunConfig["schedule"]): string {
  if (schedule.mode === "cron") return "cron";
  return "one_off";
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
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function escapeCsvValue(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const needsQuotes = /[",\n\r\t;]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function toRowObjects(input: {
  headers: string[];
  rows: string[][];
}): Array<Record<string, unknown>> {
  return input.rows.map((values) =>
    input.headers.reduce<Record<string, unknown>>((acc, h, idx) => {
      acc[h] = values[idx] ?? "";
      return acc;
    }, {}),
  );
}

function buildMappedRows(input: {
  rows: Array<Record<string, unknown>>;
  mapping: MappingPair[];
}): Array<Record<string, unknown>> {
  const cleaned = input.mapping.filter((m) => m.source && m.target);
  if (cleaned.length === 0) return input.rows;
  return input.rows.map((r) =>
    cleaned.reduce<Record<string, unknown>>((acc, m) => {
      acc[m.target] = r[m.source] ?? "";
      return acc;
    }, {}),
  );
}

export async function prepareFileForImport(input: {
  file: File;
  sourceType: Extract<ApiSourceType, "csv" | "excel" | "json" | "xml" | "parquet">;
  mapping: MappingPair[];
}): Promise<File> {
  const cleaned = input.mapping.filter((m) => m.source && m.target);
  if (cleaned.length === 0) return input.file;

  if (input.file.size > 20 * 1024 * 1024) {
    throw new Error("File is too large to prepare in browser. Please upload a smaller file.");
  }

  if (input.sourceType === "csv") {
    const text = await input.file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const headerLine = lines[0] ?? "";
    if (!headerLine) throw new Error("CSV is empty.");
    const delimiter = detectDelimiter(headerLine);
    const headers = parseCsvLine(headerLine, delimiter).map((h) => h.replace(/^"|"$/g, "").trim());
    const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
    const objects = toRowObjects({ headers, rows });
    const mapped = buildMappedRows({ rows: objects, mapping: cleaned });
    const outHeaders = cleaned.map((m) => m.target);
    const outLines = [
      outHeaders.map(escapeCsvValue).join(","),
      ...mapped.map((r) => outHeaders.map((h) => escapeCsvValue(r[h])).join(",")),
    ];
    const out = outLines.join("\n");
    return new File([out], input.file.name.replace(/\.[^.]+$/, "") + ".csv", { type: "text/csv" });
  }

  if (input.sourceType === "json") {
    const text = await input.file.text();
    const parsed = JSON.parse(text) as unknown;
    let rows: Array<Record<string, unknown>> = [];
    if (Array.isArray(parsed)) {
      rows = parsed.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
    } else if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const arrayValue = Object.values(obj).find((v) => Array.isArray(v)) as unknown[] | undefined;
      if (arrayValue) {
        rows = arrayValue.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
      } else {
        rows = [obj];
      }
    }
    const mapped = buildMappedRows({ rows, mapping: cleaned });
    const out = JSON.stringify(mapped);
    return new File([out], input.file.name.replace(/\.[^.]+$/, "") + ".json", { type: "application/json" });
  }

  if (input.sourceType === "xml") {
    const text = await input.file.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const root = doc.documentElement;
    if (!root) throw new Error("XML is empty.");
    const children = Array.from(root.children);
    const rows = children.map((node) => {
      const record: Record<string, unknown> = {};
      Array.from(node.children).forEach((c) => {
        record[c.tagName] = c.textContent ?? "";
      });
      return record;
    });
    const mapped = buildMappedRows({ rows, mapping: cleaned });
    const outDoc = document.implementation.createDocument("", "rows", null);
    const outRoot = outDoc.documentElement;
    for (const r of mapped) {
      const rowEl = outDoc.createElement("row");
      for (const m of cleaned) {
        const el = outDoc.createElement(m.target);
        el.textContent = String(r[m.target] ?? "");
        rowEl.appendChild(el);
      }
      outRoot.appendChild(rowEl);
    }
    const out = new XMLSerializer().serializeToString(outDoc);
    return new File([out], input.file.name.replace(/\.[^.]+$/, "") + ".xml", { type: "application/xml" });
  }

  throw new Error(`File preparation for ${input.sourceType.toUpperCase()} is not supported yet.`);
}

function buildConnectorPayload(connection: ConnectionPayload): {
  source_type: ApiSourceType;
  connection_params: Record<string, unknown>;
  credentials: Record<string, unknown>;
} {
  if (connection.kind === "db") {
    return {
      source_type: toApiSourceType(connection.engine),
      connection_params: {
        host: connection.host,
        port: typeof connection.port === "number" ? connection.port : undefined,
        database: connection.database || undefined,
        username: connection.user || undefined,
        ssl: connection.ssl ? true : undefined,
      },
      credentials: {
        password: connection.password || undefined,
      },
    };
  }

  if (connection.kind === "api") {
    const headersJson = (() => {
      const raw = connection.headers?.trim();
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as unknown;
      return isRecord(parsed) ? parsed : undefined;
    })();

    const credentials: Record<string, unknown> =
      connection.authMode === "basic"
        ? { username: connection.username || undefined, password: connection.password || undefined }
        : connection.authMode === "bearer"
          ? { token: connection.token || undefined }
          : {};

    return {
      source_type: toApiSourceType(connection.protocol),
      connection_params: {
        base_url: connection.baseUrl,
        auth_mode: connection.authMode,
        headers: headersJson,
      },
      credentials,
    };
  }

  return {
    source_type: toApiSourceType(connection.format),
    connection_params: {
      file_name: connection.fileName || undefined,
      file_size: connection.fileSize ?? undefined,
    },
    credentials: {},
  };
}

export async function testConnector(connection: ConnectionPayload): Promise<void> {
  const body = buildConnectorPayload(connection);
  await apiFetch("/api/v1/connectors/test", {
    method: "POST",
    body,
  });
}

export async function createConnector(connection: ConnectionPayload): Promise<{ connectorId: string }> {
  const base = buildConnectorPayload(connection);
  const organizationId = getOrganizationId();
  const now = new Date();
  const suffix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(
    2,
    "0",
  )}`;

  const body = {
    name: `import-${base.source_type}-${suffix}`,
    source_type: base.source_type,
    connection_params: base.connection_params,
    credentials: base.credentials,
    options: { organization_id: organizationId },
    description: `Import connector (${base.source_type})`,
  };

  const payload = await apiFetch<unknown>("/api/v1/connectors", {
    method: "POST",
    body,
  });

  const connectorId =
    pickString(payload, ["id", "connector_id", "connectorId"]) ??
    extractNestedString(payload, ["connector", "id"]);

  if (!connectorId) {
    throw new Error("Connector id missing from response.");
  }

  return { connectorId };
}

export async function saveFieldMap(input: {
  connectorId: string;
  mapping: MappingPair[];
}): Promise<void> {
  const cleaned = input.mapping.filter((m) => Boolean(m.source) && Boolean(m.target));
  await apiFetch("/api/v1/imports/field-map", {
    method: "POST",
    body: {
      connector_id: input.connectorId,
      mappings: cleaned.map((m) => ({
        source_field: m.source,
        target_field: m.target,
        transform_fn: null,
      })),
    },
  });
}

export async function fetchPreview(input: {
  connectorId?: string | null;
  tableName?: string | null;
  mapping?: MappingPair[];
  signal?: AbortSignal;
}): Promise<{ columns: PreviewColumn[]; rows: PreviewRow[] }> {
  const cleaned = input.mapping?.filter((m) => Boolean(m.source) && Boolean(m.target)) ?? [];
  const fieldMapObject = cleaned.reduce<Record<string, string>>((acc, cur) => {
    acc[cur.target] = cur.source;
    return acc;
  }, {});

  const payload = await apiFetch<unknown>("/api/v1/imports/preview", {
    method: "POST",
    body: {
      connector_id: input.connectorId ?? undefined,
      table_name: input.tableName ?? null,
      field_map: cleaned.length ? [fieldMapObject] : null,
    },
    signal: input.signal,
  });

  if (!isRecord(payload)) return { columns: [], rows: [] };
  const cols = Array.isArray(payload.columns) ? payload.columns : Array.isArray(payload.previewColumns) ? payload.previewColumns : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.previewRows) ? payload.previewRows : [];

  const columns: PreviewColumn[] = cols
    .map((c) =>
      isRecord(c) && typeof c.field === "string" && typeof c.type === "string"
        ? { field: c.field, type: c.type }
        : null,
    )
    .filter((v): v is PreviewColumn => Boolean(v));

  const parsedRows: PreviewRow[] = rows.filter((r): r is PreviewRow => isRecord(r));

  return { columns, rows: parsedRows };
}

export async function fetchPreviewUpload(input: {
  connectorId: string;
  file: File;
  signal?: AbortSignal;
}): Promise<{ columns: PreviewColumn[]; rows: PreviewRow[] }> {
  const fd = new FormData();
  fd.set("file", input.file);

  const payload = await apiFetch<unknown>(
    `/api/v1/imports/preview/upload?connector_id=${encodeURIComponent(input.connectorId)}`,
    {
    method: "POST",
    body: fd,
    signal: input.signal,
    },
  );

  if (!isRecord(payload)) return { columns: [], rows: [] };
  const cols = Array.isArray(payload.columns)
    ? payload.columns
    : Array.isArray(payload.previewColumns)
      ? payload.previewColumns
      : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.previewRows) ? payload.previewRows : [];

  const columns: PreviewColumn[] = cols
    .map((c) =>
      isRecord(c)
        ? typeof c.field === "string" && typeof c.type === "string"
          ? { field: c.field, type: c.type }
          : typeof c.name === "string"
            ? { field: c.name, type: typeof c.sample_type === "string" ? c.sample_type : "string" }
            : null
        : null,
    )
    .filter((v): v is PreviewColumn => Boolean(v));
  const parsedRows: PreviewRow[] = rows.filter((r): r is PreviewRow => isRecord(r));

  return { columns, rows: parsedRows };
}

export type SchemaTable = { name: string; columns: string[] };

export async function fetchSchemaTables(input?: { signal?: AbortSignal }): Promise<SchemaTable[]> {
  const payload = await apiFetch<unknown>("/api/v1/schema/tables", { signal: input?.signal });

  const extractColNames = (columns: unknown): string[] => {
    if (!Array.isArray(columns)) return [];
    const names: string[] = [];
    for (const c of columns) {
      if (typeof c === "string" && c.trim()) {
        names.push(c);
      } else if (typeof c === "object" && c !== null && "name" in (c as Record<string, unknown>)) {
        const n = (c as Record<string, unknown>).name;
        if (typeof n === "string" && n.trim()) names.push(n);
      }
    }
    return names;
  };

  const tables: SchemaTable[] = [];
  const pushTable = (name: unknown, columns: unknown) => {
    if (typeof name !== "string" || !name.trim()) return;
    const cols = extractColNames(columns);
    tables.push({ name, columns: cols });
  };

  if (Array.isArray(payload)) {
    for (const t of payload) {
      if (typeof t === "string") pushTable(t, []);
      else if (isRecord(t))
        pushTable(
          (t.name as unknown) ?? (t.table as unknown) ?? (t.table_name as unknown),
          (t.columns as unknown) ?? (t.fields as unknown),
        );
    }
    return tables.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (isRecord(payload)) {
    if (Array.isArray(payload.tables)) {
      for (const t of payload.tables as unknown[]) {
        if (typeof t === "string") pushTable(t, []);
        else if (isRecord(t))
          pushTable(
            (t.name as unknown) ?? (t.table as unknown) ?? (t.table_name as unknown),
            (t.columns as unknown) ?? (t.fields as unknown),
          );
      }
      return tables.sort((a, b) => a.name.localeCompare(b.name));
    }

    const entries = Object.entries(payload).filter(
      ([k]) => !["schema", "total", "total_tables", "tables"].includes(k),
    );
    for (const [name, cols] of entries) {
      pushTable(name, cols);
    }
    return tables.sort((a, b) => a.name.localeCompare(b.name));
  }

  return tables;
}

export async function runImport(input: {
  connectorId: string;
  config: ImportRunConfig;
}): Promise<{ jobId: string }> {
  const payload = await apiFetch<unknown>("/api/v1/imports/run", {
    method: "POST",
    body: {
      connector_id: input.connectorId,
      conflict_mode: toConflictMode(input.config.conflict),
      schedule: toScheduleValue(input.config.schedule),
      table_name: null,
      cron_expr: input.config.schedule.mode === "cron" ? input.config.schedule.cron ?? null : null,
    },
  });

  const jobId =
    pickString(payload, ["job_id", "jobId", "id"]) ??
    extractNestedString(payload, ["job", "id"]);

  if (!jobId) throw new Error("Job id missing from response.");
  return { jobId };
}

export async function runFileImport(input: {
  file: File;
  sourceType: Extract<ApiSourceType, "csv" | "excel" | "json" | "xml" | "parquet">;
  organizationId?: string;
  targetTable?: string;
  signal?: AbortSignal;
}): Promise<{ jobId: string; status?: string; queuedAt?: string }> {
  const organizationId = input.organizationId ?? getOrganizationId();
  const fd = new FormData();
  fd.set("file", input.file);
  fd.set("source_type", input.sourceType);
  fd.set("organization_id", organizationId);
  if (input.targetTable) fd.set("target_table", input.targetTable);

  const payload = await apiFetch<unknown>("/api/v1/imports/file/run", {
    method: "POST",
    body: fd,
    signal: input.signal,
  });

  const jobId =
    pickString(payload, ["job_id", "jobId", "id"]) ??
    extractNestedString(payload, ["job", "id"]);

  if (!jobId) throw new Error("Job id missing from response.");
  const status = pickString(payload, ["status"]);
  const queuedAt = pickString(payload, ["queued_at", "queuedAt"]);
  return { jobId, status: status ?? undefined, queuedAt: queuedAt ?? undefined };
}

export type ImportStatus = {
  status: "idle" | "running" | "done" | "canceled" | "failed";
  percent: number;
  processed: number;
};

export async function getImportStatus(jobId: string): Promise<ImportStatus> {
  const payload = await apiFetch<unknown>(`/api/v1/imports/${encodeURIComponent(jobId)}/status`);
  if (!isRecord(payload)) {
    return { status: "running", percent: 0, processed: 0 };
  }

  const statusRaw =
    getString(payload.status) ??
    getString(payload.state) ??
    (isRecord(payload.job) ? getString(payload.job.status) : null);

  const status: ImportStatus["status"] =
    statusRaw === "done" || statusRaw === "completed"
      ? "done"
      : statusRaw === "canceled" || statusRaw === "cancelled"
        ? "canceled"
        : statusRaw === "failed" || statusRaw === "error"
          ? "failed"
          : "running";

  const percent =
    (typeof payload.percent === "number" ? payload.percent : null) ??
    (typeof payload.progress === "number" ? payload.progress : null) ??
    (isRecord(payload.job) && typeof payload.job.percent === "number" ? payload.job.percent : null) ??
    0;

  const processed =
    (typeof payload.processed === "number" ? payload.processed : null) ??
    (typeof payload.imported_rows === "number" ? payload.imported_rows : null) ??
    (typeof payload.rows_processed === "number" ? payload.rows_processed : null) ??
    (isRecord(payload.job) && typeof payload.job.processed === "number" ? payload.job.processed : null) ??
    0;

  return {
    status,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    processed: Math.max(0, Math.round(processed)),
  };
}

export async function getImportLog(jobId: string): Promise<Array<{ index: number; message: string }>> {
  const payload = await apiFetch<unknown>(`/api/v1/imports/${encodeURIComponent(jobId)}/log`);
  if (!isRecord(payload)) return [];

  const items = Array.isArray(payload.errors)
    ? payload.errors
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.rows)
        ? payload.rows
        : [];

  return items
    .map((it) => {
      if (!isRecord(it)) return null;
      const index =
        typeof it.index === "number"
          ? it.index
          : typeof it.row === "number"
            ? it.row
            : typeof it.row_index === "number"
              ? it.row_index
              : null;
      const message = getString(it.message) ?? getString(it.error) ?? getString(it.detail);
      if (index === null || !message) return null;
      return { index, message };
    })
    .filter((v): v is { index: number; message: string } => Boolean(v));
}

export async function cancelImport(jobId: string): Promise<void> {
  await apiFetch(`/api/v1/imports/${encodeURIComponent(jobId)}/cancel`, { method: "PUT" });
}
