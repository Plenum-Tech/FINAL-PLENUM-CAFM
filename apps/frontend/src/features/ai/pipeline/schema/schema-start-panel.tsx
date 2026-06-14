"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { Database, Upload, Zap, FileText, Code, Link } from "lucide-react";
import { useSchemaMappingStart } from "../../chat-api";

type ConnectorType = "fiix" | "upload";
type UploadFormat = "yaml" | "json" | "sql" | "db_url";

const FORMAT_LABELS: Record<UploadFormat, { label: string; icon: ReactNode; placeholder: string }> = {
  yaml:   { label: "YAML",    icon: <FileText size={14} />, placeholder: "# YAML schema\ntables:\n  - name: assets\n    columns: ..." },
  json:   { label: "JSON",    icon: <Code size={14} />,     placeholder: '{\n  "tables": [...]\n}' },
  sql:    { label: "SQL DDL", icon: <Database size={14} />, placeholder: "CREATE TABLE assets (\n  id INT PRIMARY KEY,\n  ...\n);" },
  db_url: { label: "DB URL",  icon: <Link size={14} />,     placeholder: "postgresql://user:pass@host:5432/dbname" },
};

interface Props {
  orgId: string;
  onStarted: (sessionId: string) => void;
}

export default function SchemaStartPanel({ orgId, onStarted }: Props) {
  const [connectorType, setConnectorType] = useState<ConnectorType>("fiix");
  const [cmmsName, setCmmsName] = useState("");
  const [uploadFormat, setUploadFormat] = useState<UploadFormat>("yaml");
  const [schemaContent, setSchemaContent] = useState("");

  // Fiix credentials
  const [fiixSubdomain, setFiixSubdomain] = useState("");
  const [fiixAppKey, setFiixAppKey] = useState("");
  const [fiixAccessKey, setFiixAccessKey] = useState("");
  const [fiixSecretKey, setFiixSecretKey] = useState("");

  const [error, setError] = useState<string | null>(null);

  const { mutate: startMapping, isPending } = useSchemaMappingStart({
    onSuccess: (res) => onStarted(res.schema_mapping_id),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to start schema mapping"),
  });

  function handleSubmit() {
    setError(null);
    const body = {
      connector_type: connectorType,
      external_cmms_name: cmmsName || (connectorType === "fiix" ? "Fiix" : "Custom"),
      organization_id: orgId,
      ...(connectorType === "fiix" && {
        fiix_subdomain: fiixSubdomain,
        fiix_app_key: fiixAppKey,
        fiix_access_key: fiixAccessKey,
        fiix_secret_key: fiixSecretKey,
      }),
      ...(connectorType === "upload" && uploadFormat !== "db_url" && {
        schema_content: schemaContent,
        schema_format: uploadFormat,
        schema_source: `${uploadFormat}_file`,
      }),
      ...(connectorType === "upload" && uploadFormat === "db_url" && {
        schema_content: schemaContent,
        schema_format: "json",
        schema_source: "db_introspection",
      }),
    };
    startMapping(body);
  }

  const fiixValid =
    fiixSubdomain.trim().length > 0 &&
    fiixAppKey.trim().length > 0 &&
    fiixAccessKey.trim().length > 0 &&
    fiixSecretKey.trim().length > 0;

  const isValid =
    (connectorType === "fiix" && fiixValid) ||
    (connectorType === "upload" && schemaContent.trim().length > 0);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900">Schema Mapper</h2>
        <p className="text-sm text-slate-500 mt-1">
          Map an external CMMS schema to the Plenum CAFM canonical fields using
          a multi-node AI pipeline with HITL review gates.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 space-y-5">
        {/* CMMS name */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">CMMS name</label>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Fiix, Maximo, SAP PM, ServiceNow…"
            value={cmmsName}
            onChange={(e) => setCmmsName(e.target.value)}
          />
        </div>

        {/* Source type */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Schema source</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setConnectorType("fiix"); setError(null); }}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                connectorType === "fiix" ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${connectorType === "fiix" ? "bg-indigo-100" : "bg-slate-100"}`}>
                <Zap size={16} className={connectorType === "fiix" ? "text-indigo-600" : "text-slate-500"} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800">Fiix CMMS API</div>
                <div className="text-xs text-slate-500 mt-0.5">Live fetch from connected Fiix instance</div>
              </div>
            </button>

            <button
              onClick={() => { setConnectorType("upload"); setError(null); }}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                connectorType === "upload" ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${connectorType === "upload" ? "bg-indigo-100" : "bg-slate-100"}`}>
                <Upload size={16} className={connectorType === "upload" ? "text-indigo-600" : "text-slate-500"} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800">Custom schema</div>
                <div className="text-xs text-slate-500 mt-0.5">Paste YAML, JSON, SQL DDL, or DB URL</div>
              </div>
            </button>
          </div>
        </div>

        {/* Upload section */}
        {connectorType === "upload" && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Format</label>
              <div className="flex gap-2">
                {(Object.keys(FORMAT_LABELS) as UploadFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setUploadFormat(fmt)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      uploadFormat === fmt ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {FORMAT_LABELS[fmt].icon}
                    {FORMAT_LABELS[fmt].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {uploadFormat === "db_url" ? "Database URL" : "Schema content"}
              </label>
              <textarea
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                rows={uploadFormat === "db_url" ? 2 : 10}
                placeholder={FORMAT_LABELS[uploadFormat].placeholder}
                value={schemaContent}
                onChange={(e) => setSchemaContent(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Fiix credentials */}
        {connectorType === "fiix" && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">Fiix credentials</label>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Subdomain (e.g. plenumtechnology)"
              value={fiixSubdomain}
              onChange={(e) => { setFiixSubdomain(e.target.value); }}
            />
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="App Key"
              value={fiixAppKey}
              onChange={(e) => { setFiixAppKey(e.target.value); }}
            />
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Access Key"
              value={fiixAccessKey}
              onChange={(e) => { setFiixAccessKey(e.target.value); }}
            />
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              type="password"
              placeholder="Secret Key"
              value={fiixSecretKey}
              onChange={(e) => { setFiixSecretKey(e.target.value); }}
            />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={isPending || !isValid}
          className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white text-base font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Starting…
            </>
          ) : (
            <>
              <Database size={18} />
              Start schema mapping
            </>
          )}
        </button>

        {isPending && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-indigo-900">
                  {connectorType === "fiix" ? "Connecting CMMS live data…" : "Uploading schema content…"}
                </div>
                <div className="text-xs text-indigo-700 mt-1">
                  Session initialized
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pipeline overview */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Pipeline overview</h3>
        <div className="space-y-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-slate-300" />
            Nodes & gates appear after you start a session (right sidebar).
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-slate-300" />
            You will review decisions at HITL gates, then continue the pipeline.
          </div>
        </div>
      </div>
    </div>
  );
}
