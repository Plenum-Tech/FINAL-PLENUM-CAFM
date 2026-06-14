"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

type UploadResult =
  | { ok: true; job: { id: string; fileName: string; fileType: string; rowsCount: number } }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function ImportUploader() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hint = useMemo(() => {
    if (!file) return "CSV or JSON file";
    return `${file.name} (${Math.ceil(file.size / 1024)} KB)`;
  }, [file]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!file) {
      setError("Please choose a file.");
      return;
    }

    setPending(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const payload = (await res.json().catch(() => null)) as unknown;
      const obj = isRecord(payload) ? payload : null;
      const jobObj = obj && isRecord(obj.job) ? obj.job : null;
      const job =
        jobObj &&
        typeof jobObj.id === "string" &&
        typeof jobObj.fileName === "string" &&
        typeof jobObj.fileType === "string" &&
        typeof jobObj.rowsCount === "number"
          ? {
              id: jobObj.id,
              fileName: jobObj.fileName,
              fileType: jobObj.fileType,
              rowsCount: jobObj.rowsCount,
            }
          : null;
      const message =
        obj && typeof obj.message === "string" ? obj.message : `Upload failed (${res.status})`;
      const result: UploadResult = res.ok && job ? { ok: true, job } : { ok: false, message };

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setFile(null);
      setSuccess(`Imported ${result.job.rowsCount} row(s) from ${result.job.fileName}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Upload</CardTitle>
            <p className="text-sm text-muted-foreground">{hint}</p>
          </div>

          <Input
            type="file"
            name="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? <p className="text-sm text-foreground">{success}</p> : null}

          <Button disabled={pending} type="submit">
            {pending ? "Uploading..." : "Import"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
