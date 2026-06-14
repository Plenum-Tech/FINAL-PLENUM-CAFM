type EnvKey =
  | "NEXT_PUBLIC_APP_NAME"
  | "NEXT_PUBLIC_API_BASE_URL"
  | "NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL"
  | "NEXT_PUBLIC_DOC_RAG_BASE_URL"
  | "NEXT_PUBLIC_DEEP_AGENTS_BASE_URL"
  | "NEXT_PUBLIC_UDR_BASE_URL"
  | "NEXT_PUBLIC_SOCKET_URL"
  | "NEXT_PUBLIC_ORGANIZATION_ID"
  | "NEXT_PUBLIC_WO_BASE_URL";

const ENV_MAP: Record<EnvKey, string | undefined> = {
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL: process.env.NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL,
  NEXT_PUBLIC_DOC_RAG_BASE_URL: process.env.NEXT_PUBLIC_DOC_RAG_BASE_URL,
  NEXT_PUBLIC_DEEP_AGENTS_BASE_URL: process.env.NEXT_PUBLIC_DEEP_AGENTS_BASE_URL,
  NEXT_PUBLIC_UDR_BASE_URL: process.env.NEXT_PUBLIC_UDR_BASE_URL,
  NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
  NEXT_PUBLIC_ORGANIZATION_ID: process.env.NEXT_PUBLIC_ORGANIZATION_ID,
  NEXT_PUBLIC_WO_BASE_URL: process.env.NEXT_PUBLIC_WO_BASE_URL,
};

function readEnv(key: EnvKey): string | undefined {
  const value = ENV_MAP[key];
  if (typeof value === "string" && value.trim().length > 0) return value;
  return undefined;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  appName: readEnv("NEXT_PUBLIC_APP_NAME") ?? "CAFM Web",
  apiBaseUrl: readEnv("NEXT_PUBLIC_API_BASE_URL") ?? "",
  schemaMapperBaseUrl: readEnv("NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL") ?? "",
  docRagBaseUrl: readEnv("NEXT_PUBLIC_DOC_RAG_BASE_URL") ?? "",
  deepAgentsBaseUrl: readEnv("NEXT_PUBLIC_DEEP_AGENTS_BASE_URL") ?? "/backend/deep-agents",
  udrBaseUrl: readEnv("NEXT_PUBLIC_UDR_BASE_URL") ?? "/backend/udr",
  socketUrl: readEnv("NEXT_PUBLIC_SOCKET_URL") ?? "http://localhost:3002",
  organizationId: readEnv("NEXT_PUBLIC_ORGANIZATION_ID") ?? "",
  woBaseUrl: readEnv("NEXT_PUBLIC_WO_BASE_URL") ?? "http://localhost:8007",
} as const;
