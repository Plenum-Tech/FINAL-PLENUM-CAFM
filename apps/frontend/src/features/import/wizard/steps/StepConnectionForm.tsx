"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button, Input, Card, CardContent, toast } from "@/components/ui";
import { useImportWizard, type ConnectionPayload } from "@/store/importWizard";
import { createConnector, getApiErrorMessage, isUnauthorized, testConnector } from "../api";

export function StepConnectionForm() {
  const router = useRouter();
  const { sourceType, connection, setConnection, setConnectorId } = useImportWizard();
  const [local, setLocal] = useState<ConnectionPayload | null>(() => connection);
  const [error, setError] = useState<string | null>(null);

  const kind: ConnectionPayload["kind"] | null = useMemo(() => {
    if (!sourceType) return null;
    if (["postgres", "mysql", "mssql", "mongodb"].includes(sourceType)) return "db";
    if (["csv", "excel", "json", "xml", "parquet"].includes(sourceType)) return "file";
    return "api";
  }, [sourceType]);

  const fileFormat = useMemo(() => {
    if (!sourceType) return "csv";
    if (sourceType === "csv") return "csv";
    if (sourceType === "excel") return "excel";
    if (sourceType === "json") return "json";
    if (sourceType === "xml") return "xml";
    if (sourceType === "parquet") return "parquet";
    return "csv";
  }, [sourceType]);

  if (!sourceType || !kind) {
    return <p className="text-sm text-muted-foreground">Please select a source first.</p>;
  }

  const testMutation = useMutation({
    mutationFn: async (payload: ConnectionPayload) => testConnector(payload),
    onError: (e: unknown) => {
      if (isUnauthorized(e)) router.replace("/login");
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: ConnectionPayload) => createConnector(payload),
    onError: (e: unknown) => {
      if (isUnauthorized(e)) router.replace("/login");
    },
  });

  const pending = testMutation.isPending || createMutation.isPending;

  const onSave = async () => {
    setError(null);
    if (!local) return;

    try {
      await testMutation.mutateAsync(local);
      const { connectorId } = await createMutation.mutateAsync(local);
      setConnection(local);
      setConnectorId(connectorId);
      toast({ title: "Connection saved", variant: "success" });
    } catch (e) {
      const msg = getApiErrorMessage(e);
      setError(msg);
      toast({ title: "Connection failed", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {kind === "db" ? (
        <DbForm initial={local?.kind === "db" ? local : undefined} onChange={setLocal} />
      ) : null}
      {kind === "file" ? (
        <FileForm
          format={fileFormat}
          initial={local?.kind === "file" ? local : undefined}
          onChange={setLocal}
        />
      ) : null}
      {kind === "api" ? (
        <ApiForm initial={local?.kind === "api" ? local : undefined} onChange={setLocal} />
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {kind !== "file" ? (
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!local || pending}>
            {pending ? "Saving..." : "Save Connection"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DbForm({
  initial,
  onChange,
}: {
  initial?: Extract<ConnectionPayload, { kind: "db" }>;
  onChange: (v: ConnectionPayload) => void;
}) {
  const [v, setV] = useState<Extract<ConnectionPayload, { kind: "db" }>>(
    initial ?? {
      kind: "db",
      engine: "postgres",
      host: "",
      port: "",
      database: "",
      user: "",
      password: "",
      ssl: false,
    },
  );
  const set = (k: keyof typeof v, val: unknown) => {
    const next = { ...v, [k]: val };
    setV(next);
    onChange(next);
  };

  return (
    <Card>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Engine</label>
          <select
            value={v.engine}
            onChange={(e) => set("engine", e.target.value as typeof v.engine)}
            className="mt-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mssql">MSSQL</option>
            <option value="mongodb">MongoDB</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Host</label>
          <Input className="mt-1" value={v.host} onChange={(e) => set("host", e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Port</label>
          <Input
            className="mt-1"
            inputMode="numeric"
            value={v.port}
            onChange={(e) => set("port", e.target.value ? Number(e.target.value) : "")}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Database</label>
          <Input
            className="mt-1"
            value={v.database}
            onChange={(e) => set("database", e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">User</label>
          <Input className="mt-1" value={v.user} onChange={(e) => set("user", e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Password</label>
          <Input
            className="mt-1"
            type="password"
            value={v.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.ssl}
              onChange={(e) => set("ssl", e.target.checked)}
              className="h-4 w-4"
            />
            Use SSL
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function FileForm({
  format,
  initial,
  onChange,
}: {
  format: "csv" | "excel" | "json" | "xml" | "parquet";
  initial?: Extract<ConnectionPayload, { kind: "file" }>;
  onChange: (v: ConnectionPayload) => void;
}) {
  const { setFile, setConnection, setConnectorId } = useImportWizard();
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState(initial?.fileName ?? "");

  const applySelection = (f: File) => {
    setFileName(f.name);
    setFile(f);
    setConnectorId(null);
    const payload: Extract<ConnectionPayload, { kind: "file" }> = {
      kind: "file",
      format,
      fileName: f.name,
      fileSize: f.size,
    };
    setConnection(payload);
    onChange(payload);
    toast({ title: "File selected", variant: "success" });
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    applySelection(f);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    applySelection(f);
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="text-xs text-muted-foreground">
          Source: <span className="font-semibold text-foreground">{format.toUpperCase()}</span>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={[
            "flex h-36 items-center justify-center rounded-xl border-2 border-dashed text-sm",
            dragOver ? "border-primary bg-primary/5" : "border-border",
          ].join(" ")}
        >
          <div className="space-y-1 text-center">
            <p className="font-semibold">
              {fileName ? `Selected: ${fileName}` : "Drag & drop file here"}
            </p>
            <p className="text-muted-foreground">or</p>
            <label className="inline-flex cursor-pointer items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline">
              <input type="file" onChange={onPick} className="hidden" />
              Click to choose
            </label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiForm({
  initial,
  onChange,
}: {
  initial?: Extract<ConnectionPayload, { kind: "api" }>;
  onChange: (v: ConnectionPayload) => void;
}) {
  const [v, setV] = useState<Extract<ConnectionPayload, { kind: "api" }>>(
    initial ?? {
      kind: "api",
      protocol: "rest",
      baseUrl: "",
      authMode: "none",
      headers: "",
    },
  );
  const set = (k: keyof typeof v, val: unknown) => {
    const next = { ...v, [k]: val };
    setV(next);
    onChange(next);
  };
  return (
    <Card>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-muted-foreground">Protocol</label>
          <select
            value={v.protocol}
            onChange={(e) => set("protocol", e.target.value as typeof v.protocol)}
            className="mt-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="rest">REST</option>
            <option value="soap">SOAP</option>
            <option value="odata">OData</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-muted-foreground">Base URL</label>
          <Input className="mt-1" value={v.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Auth</label>
          <select
            value={v.authMode}
            onChange={(e) => set("authMode", e.target.value as typeof v.authMode)}
            className="mt-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="none">None</option>
            <option value="basic">Basic</option>
            <option value="bearer">Bearer</option>
          </select>
        </div>
        {v.authMode === "basic" ? (
          <>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Username</label>
              <Input className="mt-1" value={v.username ?? ""} onChange={(e) => set("username", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Password</label>
              <Input className="mt-1" type="password" value={v.password ?? ""} onChange={(e) => set("password", e.target.value)} />
            </div>
          </>
        ) : null}
        {v.authMode === "bearer" ? (
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground">Token</label>
            <Input className="mt-1" value={v.token ?? ""} onChange={(e) => set("token", e.target.value)} />
          </div>
        ) : null}
        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-muted-foreground">Headers (JSON)</label>
          <textarea
            rows={4}
            className="mt-1 w-full rounded-md border border-input bg-transparent p-3 text-sm"
            value={v.headers ?? ""}
            onChange={(e) => set("headers", e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
