import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseDotEnv(raw) {
  const out = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function normalizeBaseUrl(base) {
  return String(base ?? "").replace(/\/+$/, "");
}

function buildUrl(baseUrl, pathname) {
  const cleanPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${cleanPath}`;
}

async function safeJson(res) {
  const ct = res.headers.get("content-type") ?? "";
  const isJson = ct.includes("application/json") || ct.includes("+json");
  if (!isJson) {
    const text = await res.text().catch(() => "");
    return { __non_json: true, text };
  }
  return await res.json().catch(() => null);
}

async function requestJson(input) {
  const { url, method, headers, body } = input;
  const res = await fetch(url, {
    method,
    headers,
    body,
  });
  const payload = await safeJson(res);
  if (!res.ok) {
    const msg =
      payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string"
        ? payload.detail
        : `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function isRecord(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readString(v) {
  return typeof v === "string" ? v : null;
}

function readUnknownArray(v) {
  return Array.isArray(v) ? v : [];
}

async function writeSnapshot(dir, name, data) {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function capture() {
  const repoRoot = process.cwd();
  const envPath = path.join(repoRoot, ".env");
  const rawEnv = await readFile(envPath, "utf8").catch(() => "");
  const envFromFile = parseDotEnv(rawEnv);
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? envFromFile.NEXT_PUBLIC_API_BASE_URL);
  if (!baseUrl) throw new Error("Missing NEXT_PUBLIC_API_BASE_URL (set it in environment or .env)");

  const outDir = path.join(repoRoot, "src", "features", "ai", "api-response-snapshots", "schema-mapper");
  const inputCsv = path.join(repoRoot, "src", "features", "ai", "api-response-snapshots", "_inputs", "sample-assets.csv");
  const orgId = "00000000-0000-0000-0000-000000000001";

  const run = async (key, fn) => {
    const startedAt = new Date().toISOString();
    try {
      const value = await fn();
      await writeSnapshot(outDir, `${key}.json`, {
        ok: true,
        capturedAt: startedAt,
        response: value,
      });
      return value;
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Unknown error");
      await writeSnapshot(outDir, `${key}.json`, {
        ok: false,
        capturedAt: startedAt,
        error: {
          message: err.message,
          status: typeof err.status === "number" ? err.status : null,
          payload: "payload" in err ? err.payload : null,
        },
      });
      return null;
    }
  };

  await run("01_platforms_fiix_test-connection_GET", async () => {
    const url = buildUrl(baseUrl, "/schema-mapper/api/platforms/fiix/test-connection");
    return requestJson({ url, method: "GET" });
  });

  await run("02_platforms_fiix_test-connection_POST", async () => {
    const url = buildUrl(baseUrl, "/schema-mapper/api/platforms/fiix/test-connection");
    const body = { app_key: "", access_key: "", secret: "" };
    return requestJson({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  });

  await run("03_platforms_fiix_fetch-schema_GET", async () => {
    const url = buildUrl(baseUrl, "/schema-mapper/api/platforms/fiix/fetch-schema");
    return requestJson({ url, method: "GET" });
  });

  const ingestRes = await run("10_testing_ingest-with-semantic_POST", async () => {
    const bytes = await readFile(inputCsv);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "text/csv" }), "sample-assets.csv");
    form.append("mapper_json", "");
    form.append("cmms_name", "Custom");
    form.append("organization_id", orgId);
    form.append("file_type", "CSV");
    form.append("cleanliness", "Pre-cleaned");
    form.append("description", "Assets");

    const url = buildUrl(baseUrl, "/schema-mapper/api/testing/ingest-with-semantic");
    return requestJson({ url, method: "POST", body: form });
  });

  const ingestRoot = isRecord(ingestRes) ? ingestRes : null;
  const migrationId = readString(ingestRoot?.migration_id);

  const node4Res = await run("11_testing_human-review_node4_POST", async () => {
    if (!migrationId) throw new Error("Missing migration_id from ingest response");
    const tier1 = readUnknownArray(ingestRoot?.tier1_mappings);
    const tier2 = readUnknownArray(ingestRoot?.tier2_flagged_mappings);
    const tier2Unmappable = readUnknownArray(ingestRoot?.tier2_unmappable);
    const flaggedApprovals = tier2
      .map((raw) => (isRecord(raw) ? raw : null))
      .filter((x) => !!x)
      .map((x) => ({
        source_field: readString(x.source_field) ?? readString(x.sourceField) ?? readString(x.column) ?? "",
        target_field:
          readString(x.target_field) ?? readString(x.targetField) ?? readString(x.suggested_target_field) ?? readString(x.suggestedTargetField) ?? "",
        approved: true,
      }))
      .filter((x) => x.source_field.trim().length > 0);

    const url = buildUrl(baseUrl, "/schema-mapper/api/testing/human-review");
    const body = {
      migration_id: migrationId,
      tier1_mappings: tier1,
      tier2_flagged_mappings: tier2,
      tier2_unmappable: tier2Unmappable,
      flagged_approvals: flaggedApprovals,
      custom_mappings: [],
      intentionally_unmapped: [],
    };
    return requestJson({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  });

  const node4Root = isRecord(node4Res) ? node4Res : null;
  const finalMappings = readUnknownArray(node4Root?.final_mappings);

  const node5Res = await run("12_testing_preprocess_node5_POST", async () => {
    if (!migrationId) throw new Error("Missing migration_id");
    if (!ingestRoot) throw new Error("Missing ingest response");
    const parsedTables = isRecord(ingestRoot.parsed_tables) ? ingestRoot.parsed_tables : {};
    const cleanedTables = {};
    for (const [k, v] of Object.entries(parsedTables)) {
      cleanedTables[k] = readUnknownArray(v);
    }
    const tableNames = Array.isArray(ingestRoot.table_names) ? ingestRoot.table_names : Object.keys(cleanedTables);

    const url = buildUrl(baseUrl, "/schema-mapper/api/testing/preprocess");
    const body = {
      migration_id: migrationId,
      cleaned_tables: cleanedTables,
      final_mappings: finalMappings,
      table_names: tableNames,
    };
    return requestJson({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  });

  const node5Root = isRecord(node5Res) ? node5Res : null;
  const cleanedTablesFromNode5 = isRecord(node5Root?.cleaned_tables) ? node5Root.cleaned_tables : null;

  const node6Res = await run("13_testing_resolve-hierarchy_node6_POST", async () => {
    if (!migrationId) throw new Error("Missing migration_id");
    if (!cleanedTablesFromNode5) throw new Error("Missing cleaned_tables from node 5");
    const url = buildUrl(baseUrl, "/schema-mapper/api/testing/resolve-hierarchy");
    const body = {
      migration_id: migrationId,
      cleaned_tables: cleanedTablesFromNode5,
      final_mappings: finalMappings,
    };
    return requestJson({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  });

  const node6Root = isRecord(node6Res) ? node6Res : null;
  const confirmedHierarchies = readUnknownArray(node6Root?.confirmed_hierarchies);
  const hierarchyCycles = readUnknownArray(node6Root?.hierarchy_cycles);

  const node7Res = await run("14_testing_verify-hierarchy_node7_POST", async () => {
    if (!migrationId) throw new Error("Missing migration_id");
    const url = buildUrl(baseUrl, "/schema-mapper/api/testing/verify-hierarchy");
    const body = {
      migration_id: migrationId,
      confirmed_hierarchies: confirmedHierarchies,
      hierarchy_cycles: hierarchyCycles,
      customer_corrections: [],
    };
    return requestJson({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  });

  const node7Root = isRecord(node7Res) ? node7Res : null;
  const hierarchyRelationships = readUnknownArray(node7Root?.confirmed_hierarchies);

  const node8Res = await run("15_testing_generate-output_node8_POST", async () => {
    if (!migrationId) throw new Error("Missing migration_id");
    if (!cleanedTablesFromNode5) throw new Error("Missing cleaned_tables from node 5");
    const url = buildUrl(baseUrl, "/schema-mapper/api/testing/generate-output");
    const body = {
      migration_id: migrationId,
      final_mappings: finalMappings,
      cleaned_tables: cleanedTablesFromNode5,
      hierarchy_relationships: hierarchyRelationships,
    };
    return requestJson({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  });

  const node8Root = isRecord(node8Res) ? node8Res : null;
  const intermediateSchema = isRecord(node8Root?.intermediate_schema) ? node8Root.intermediate_schema : null;

  await run("16_testing_write-output_node9_POST", async () => {
    if (!migrationId) throw new Error("Missing migration_id");
    if (!intermediateSchema) throw new Error("Missing intermediate_schema from node 8");
    const url = buildUrl(baseUrl, "/schema-mapper/api/testing/write-output");
    const body = {
      migration_id: migrationId,
      intermediate_schema: intermediateSchema,
      customer_approval: true,
    };
    return requestJson({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  });

  await run("17_testing_artifacts_by_migrationId_GET", async () => {
    if (!migrationId) throw new Error("Missing migration_id");
    const url = buildUrl(baseUrl, `/schema-mapper/api/testing/artifacts/${encodeURIComponent(migrationId)}`);
    return requestJson({ url, method: "GET" });
  });

  await writeSnapshot(outDir, "99_meta.json", {
    ok: true,
    capturedAt: new Date().toISOString(),
    baseUrl,
    organizationId: orgId,
    note: "Each file contains either { ok: true, response } or { ok: false, error }.",
  });
}

await capture();
