"use client";

import React from "react";
import {
  Database,
  FileDown,
  FileSpreadsheet,
  FileJson,
  FileCode,
  Files,
  Cloud,
  Server,
  Network,
} from "lucide-react";
import { useImportWizard, type SourceType } from "@/store/importWizard";

const SOURCES: Array<{ id: SourceType; label: string; icon: React.ReactNode; color: string }> = [
  { id: "postgres", label: "PostgreSQL", icon: <Database />, color: "text-sky-600" },
  { id: "mysql", label: "MySQL", icon: <Database />, color: "text-cyan-600" },
  { id: "mssql", label: "MSSQL", icon: <Server />, color: "text-red-600" },
  { id: "mongodb", label: "MongoDB", icon: <Database />, color: "text-green-600" },
  { id: "csv", label: "CSV", icon: <FileDown />, color: "text-amber-600" },
  { id: "excel", label: "Excel", icon: <FileSpreadsheet />, color: "text-green-700" },
  { id: "json", label: "JSON", icon: <FileJson />, color: "text-emerald-600" },
  { id: "xml", label: "XML", icon: <FileCode />, color: "text-indigo-600" },
  { id: "parquet", label: "Parquet", icon: <Files />, color: "text-purple-600" },
  { id: "rest", label: "REST", icon: <Cloud />, color: "text-blue-600" },
  { id: "soap", label: "SOAP", icon: <Network />, color: "text-violet-600" },
  { id: "odata", label: "OData", icon: <Network />, color: "text-fuchsia-600" },
];

export function StepSourceSelect() {
  const sourceType = useImportWizard((s) => s.sourceType);
  const setSourceType = useImportWizard((s) => s.setSourceType);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {SOURCES.map((s) => {
        const active = s.id === sourceType;
        return (
          <button
            type="button"
            key={s.id}
            onClick={() => setSourceType(s.id)}
            className={[
              "flex h-24 flex-col items-center justify-center rounded-xl border transition-colors",
              active ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
            ].join(" ")}
            title={s.label}
          >
            <span className={["mb-2 h-6 w-6", s.color].join(" ")}>{s.icon}</span>
            <span className="text-xs font-semibold">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
