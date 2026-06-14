"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useImportWizard } from "@/store/importWizard";
import { Button, Card, CardContent, toast } from "@/components/ui";
import {
  cancelImport,
  getApiErrorMessage,
  getImportLog,
  getImportStatus,
  type ImportStatus,
  isUnauthorized,
} from "../api";

export function StepProgress() {
  const router = useRouter();
  const { progress, updateProgress, jobId } = useImportWizard();
  const jobKey = jobId ?? "";
  const lastToastStatus = useRef<string>("");

  useEffect(() => {
    if (!jobId) {
      updateProgress({ status: "idle", percent: 0, processed: 0, errors: [] });
    }
  }, [jobId, updateProgress]);

  const statusQuery = useQuery<ImportStatus>({
    queryKey: ["import-status", jobKey],
    queryFn: () => getImportStatus(jobKey),
    enabled: Boolean(jobKey) && progress.status === "running",
    refetchInterval: 5000,
  });

  useEffect(() => {
    const data = statusQuery.data;
    if (!data) return;
    updateProgress({
      percent: data.percent,
      processed: data.processed,
      status: data.status === "failed" ? "done" : data.status,
    });
    if (data.status !== "running" && lastToastStatus.current !== data.status) {
      lastToastStatus.current = data.status;
      if (data.status === "done") toast({ title: "Import completed", description: `Job: ${jobKey}`, variant: "success" });
      if (data.status === "canceled") toast({ title: "Import canceled", description: `Job: ${jobKey}`, variant: "default" });
      if (data.status === "failed") toast({ title: "Import failed", description: `Job: ${jobKey}`, variant: "destructive" });
    }
  }, [jobKey, statusQuery.data, updateProgress]);

  useEffect(() => {
    const e = statusQuery.error;
    if (!e) return;
    if (isUnauthorized(e)) router.replace("/login");
  }, [router, statusQuery.error]);

  const logQuery = useQuery<Array<{ index: number; message: string }>>({
    queryKey: ["import-log", jobKey],
    queryFn: () => getImportLog(jobKey),
    enabled: Boolean(jobKey) && (progress.status === "done" || progress.status === "canceled"),
  });

  useEffect(() => {
    if (!logQuery.data) return;
    updateProgress({
      errors: logQuery.data.map((e) => ({
        index: e.index,
        message: e.message,
      })),
    });
  }, [logQuery.data, updateProgress]);

  useEffect(() => {
    const e = logQuery.error;
    if (!e) return;
    if (isUnauthorized(e)) router.replace("/login");
  }, [router, logQuery.error]);

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) return;
      await cancelImport(jobId);
    },
    onError: (e: unknown) => {
      if (isUnauthorized(e)) router.replace("/login");
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Importing...</p>
          <p className="text-xs text-muted-foreground">{progress.processed} rows processed</p>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {statusQuery.error ? (
          <p className="mt-2 text-sm text-destructive">{getApiErrorMessage(statusQuery.error)}</p>
        ) : null}
        {progress.status === "running" && jobId ? (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={cancelMutation.isPending}
              onClick={async () => {
                try {
                  await cancelMutation.mutateAsync();
                  updateProgress({ status: "canceled" });
                  toast({ title: "Cancel requested", description: `Job: ${jobKey}`, variant: "default" });
                } catch (e) {
                  const msg = getApiErrorMessage(e);
                  toast({ title: "Cancel failed", description: msg, variant: "destructive" });
                }
              }}
            >
              {cancelMutation.isPending ? "Canceling..." : "Cancel"}
            </Button>
          </div>
        ) : null}
      </div>

      {progress.status === "done" ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm font-semibold">Import completed</p>
            <p className="text-xs text-muted-foreground">Job: {jobId ?? "-"}</p>
          </CardContent>
        </Card>
      ) : null}

      {progress.errors.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="rounded-md border">
              {progress.errors.map((e) => (
                <div
                  key={e.index}
                  className="flex items-center justify-between border-b last:border-b-0 bg-red-50 dark:bg-red-950/20 px-3 py-2"
                >
                  <span className="text-xs font-semibold text-red-700 dark:text-red-300">
                    Row {e.index}
                  </span>
                  <span className="text-xs text-red-600 dark:text-red-300">{e.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
