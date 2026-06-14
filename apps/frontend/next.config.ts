import type { NextConfig } from "next";

const trim = (v?: string) => v?.replace(/\/$/, "");

/** Full-stack Docker gateway (nginx on host :3000) — use with `npm run dev:local` */
const localDev = process.env.LOCAL_DEV === "1";

const deepAgentsDevProxy = trim(process.env.DEEP_AGENTS_DEV_PROXY);
const woDevProxy = trim(process.env.WO_DEV_PROXY) ?? "http://127.0.0.1:8007";
const schemaDevProxy = trim(process.env.SCHEMA_MAPPER_DEV_PROXY) ?? "http://127.0.0.1:8003";
const connectorDevProxy = trim(process.env.CONNECTOR_DEV_PROXY) ?? "http://127.0.0.1:8000";
const docRagDevProxy = trim(process.env.DOC_RAG_DEV_PROXY) ?? `${schemaDevProxy}/doc-rag`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    if (localDev) {
      return [
        {
          source: "/backend/deep-agents/:path*",
          destination: `${deepAgentsDevProxy ?? "http://127.0.0.1:8008"}/:path*`,
        },
        {
          source: "/backend/work-order/:path*",
          destination: `${woDevProxy}/:path*`,
        },
        {
          source: "/backend/schema-mapper/:path*",
          destination: `${schemaDevProxy}/:path*`,
        },
        {
          source: "/backend/doc-rag/:path*",
          destination: `${docRagDevProxy}/:path*`,
        },
        {
          source: "/backend/connector/:path*",
          destination: `${connectorDevProxy}/:path*`,
        },
      ];
    }

    if (!deepAgentsDevProxy) return [];
    return [
      {
        source: "/backend/deep-agents/:path*",
        destination: `${deepAgentsDevProxy}/:path*`,
      },
    ];
  },
};

export default nextConfig;
