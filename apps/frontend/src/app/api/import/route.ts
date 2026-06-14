import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

type ImportRow = Record<string, string | number | boolean | null>;

type ImportJob = {
  id: string;
  fileName: string;
  fileType: "csv" | "json";
  rowsCount: number;
  preview: ImportRow[];
  createdAt: string;
};

type ImportStore = {
  jobs: ImportJob[];
};

function getStore(): ImportStore {
  const g = globalThis as unknown as { __cafmImportStore?: ImportStore };
  if (!g.__cafmImportStore) g.__cafmImportStore = { jobs: [] };
  return g.__cafmImportStore;
}

async function requireUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value ?? "";
  const user = token ? decodeDemoToken(token) : null;
  if (!user) return null;
  return user;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): { headers: string[]; rows: ImportRow[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map((h, idx) => h || `col_${idx + 1}`);
  const rows: ImportRow[] = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row: ImportRow = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

function normalizeJsonRows(input: unknown): ImportRow[] {
  if (Array.isArray(input)) {
    return input.filter((v) => typeof v === "object" && v !== null).map((v) => v as ImportRow);
  }
  if (typeof input === "object" && input !== null) return [input as ImportRow];
  return [];
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const store = getStore();
  return NextResponse.json({ jobs: store.jobs });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ message: "Invalid form data." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "File required." }, { status: 400 });
  }

  const fileName = file.name || "upload";
  const lower = fileName.toLowerCase();
  const fileType: ImportJob["fileType"] = lower.endsWith(".json") ? "json" : "csv";

  const buf = await file.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(buf);

  let rows: ImportRow[] = [];
  if (fileType === "json") {
    const parsed = JSON.parse(text) as unknown;
    rows = normalizeJsonRows(parsed);
  } else {
    rows = parseCsv(text).rows;
  }

  const job: ImportJob = {
    id: `imp_${Math.random().toString(16).slice(2, 10)}`,
    fileName,
    fileType,
    rowsCount: rows.length,
    preview: rows.slice(0, 5),
    createdAt: new Date().toISOString(),
  };

  const store = getStore();
  store.jobs = [job, ...store.jobs].slice(0, 20);

  return NextResponse.json({ job }, { status: 201 });
}
