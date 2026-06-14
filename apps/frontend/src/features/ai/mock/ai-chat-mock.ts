export type MockDetectDataModeResponse = {
  migration_id: string;
  mode: "structured" | "unstructured" | "hybrid";
  confidence_pct: number;
  matched_columns: string[];
  unmatched_columns: string[];
  low_confidence_columns: Array<{ name: string; confidence_pct: number }>;
  matched_schema_name: string;
  explanation: string;
  execution_logs: string[];
};

export type MockUnstructuredParseResponse = {
  migration_id: string;
  parse_job_id: string;
  status: "queued" | "running" | "done" | "failed";
  pages: number;
  chunks: number;
  warnings: string[];
  error_message: string | null;
  execution_logs: string[];
};

export type MockUnstructuredExtractResponse = {
  migration_id: string;
  extract_job_id: string;
  status: "queued" | "running" | "done" | "failed";
  entities_found: number;
  tables: string[];
  sample_rows: Record<string, Array<Record<string, unknown>>>;
  error_message: string | null;
  execution_logs: string[];
};

export type MockUnstructuredBuildSchemaResponse = {
  migration_id: string;
  status: "done" | "failed";
  generated_schema: {
    tables: Array<{
      name: string;
      columns: Array<{ name: string; type: string; confidence_pct: number }>;
    }>;
  };
  schema_confidence: number;
  validation_errors: string[];
  error_message: string | null;
  execution_logs: string[];
};

export function buildMockDetectDataMode(migrationId: string): MockDetectDataModeResponse {
  return {
    migration_id: migrationId,
    mode: "hybrid",
    confidence_pct: 92.6,
    matched_columns: [
      "asset_id",
      "asset_name",
      "location",
      "category",
      "manufacturer",
      "model",
      "serial_number",
      "installed_date",
    ],
    unmatched_columns: ["notes", "remarks"],
    low_confidence_columns: [
      { name: "location", confidence_pct: 58 },
      { name: "category", confidence_pct: 62 },
    ],
    matched_schema_name: "CMMS Canonical Schema",
    explanation:
      "I analyzed your file and found partial schema alignment. You can proceed with structured mapping or treat this as unstructured data for AI-based extraction.",
    execution_logs: [
      "[INFO] [Decision] columns analyzed",
      "[INFO] [Decision] partial alignment detected",
      "[INFO] [Decision] suggested mode: hybrid",
    ],
  };
}

export function buildMockUnstructuredParse(migrationId: string): MockUnstructuredParseResponse {
  return {
    migration_id: migrationId,
    parse_job_id: "mock-parse-job-001",
    status: "done",
    pages: 12,
    chunks: 240,
    warnings: ["Some pages contained low-quality text, OCR fallback applied."],
    error_message: null,
    execution_logs: [
      "[INFO] [Unstructured] U1 parse started",
      "[INFO] [Unstructured] extracted text blocks",
      "[WARNING] [Unstructured] OCR fallback used for 일부 pages",
      "[INFO] [Unstructured] U1 parse done",
    ],
  };
}

export function buildMockUnstructuredExtract(migrationId: string): MockUnstructuredExtractResponse {
  return {
    migration_id: migrationId,
    extract_job_id: "mock-extract-job-001",
    status: "done",
    entities_found: 1200,
    tables: ["assets", "locations"],
    sample_rows: {
      assets: [
        {
          asset_name: "Pump A",
          location: "Plant 1",
          manufacturer: "ACME",
          serial_number: "SN-001",
          confidence_pct: 88,
        },
      ],
      locations: [{ location_name: "Plant 1", confidence_pct: 91 }],
    },
    error_message: null,
    execution_logs: [
      "[INFO] [Unstructured] U2 extraction started",
      "[INFO] [Unstructured] entities extracted",
      "[INFO] [Unstructured] U2 extraction done",
    ],
  };
}

export function buildMockUnstructuredSchema(migrationId: string): MockUnstructuredBuildSchemaResponse {
  return {
    migration_id: migrationId,
    status: "done",
    schema_confidence: 0.91,
    generated_schema: {
      tables: [
        {
          name: "assets",
          columns: [
            { name: "asset_name", type: "text", confidence_pct: 92 },
            { name: "location", type: "text", confidence_pct: 86 },
            { name: "manufacturer", type: "text", confidence_pct: 84 },
            { name: "serial_number", type: "text", confidence_pct: 88 },
          ],
        },
        {
          name: "locations",
          columns: [
            { name: "location_name", type: "text", confidence_pct: 91 },
            { name: "parent_location", type: "text", confidence_pct: 72 },
          ],
        },
      ],
    },
    validation_errors: [],
    error_message: null,
    execution_logs: [
      "[INFO] [Unstructured] U3 schema build started",
      "[INFO] [Unstructured] schema draft created",
      "[INFO] [Unstructured] schema validated",
      "[INFO] [Unstructured] U3 schema build done",
    ],
  };
}
