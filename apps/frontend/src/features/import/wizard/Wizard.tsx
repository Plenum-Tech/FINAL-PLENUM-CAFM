"use client";

import { createPortal } from "react-dom";
import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { X, ChevronRight, ChevronLeft, Database, FileDown, Globe } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardContent, toast } from "@/components/ui";
import { useImportWizard } from "@/store/importWizard";
import { StepSourceSelect } from "./steps/StepSourceSelect";
import { StepConnectionForm } from "./steps/StepConnectionForm";
import { StepFieldMapping } from "./steps/StepFieldMapping";
import { StepPreview } from "./steps/StepPreview";
import { StepConfig } from "./steps/StepConfig";
import { StepProgress } from "./steps/StepProgress";
import {
  getApiErrorMessage,
  isUnauthorized,
  prepareFileForImport,
  runFileImport,
  runImport,
  saveFieldMap,
} from "./api";

type Props = {
  open: boolean;
  onClose: () => void;
};

const steps = [
  { id: 1, title: "Source", icon: <Database className="h-4 w-4" /> },
  { id: 2, title: "Connection", icon: <Database className="h-4 w-4" /> },
  { id: 3, title: "Mapping", icon: <Globe className="h-4 w-4" /> },
  { id: 4, title: "Preview", icon: <FileDown className="h-4 w-4" /> },
  { id: 5, title: "Config", icon: <Globe className="h-4 w-4" /> },
  { id: 6, title: "Progress", icon: <Globe className="h-4 w-4" /> },
] as const;

export function ImportWizard({ open, onClose }: Props) {
  const router = useRouter();
  const {
    step,
    setStep,
    sourceType,
    connection,
    connectorId,
    file,
    tableName,
    mapping,
    previewRows,
    schedule,
    conflict,
    setJobId,
    updateProgress,
  } = useImportWizard();
  const [footerError, setFooterError] = useState<string | null>(null);

  const canNext = useMemo(() => {
    if (step === 1) return !!sourceType;
    if (step === 2) {
      if (!connection) return false;
      if (connection.kind === "file") return Boolean(file);
      return Boolean(connectorId);
    }
    if (step === 3)
      return Boolean(tableName) && mapping.some((m) => Boolean(m.source) && Boolean(m.target));
    if (step === 4) return previewRows.length >= 0; // preview is optional mocked
    if (step === 5) return !!schedule && !!conflict;
    return false;
  }, [
    step,
    sourceType,
    connection,
    connectorId,
    file,
    tableName,
    mapping,
    previewRows.length,
    schedule,
    conflict,
  ]);

  const saveMapMutation = useMutation({
    mutationFn: async () => {
      if (!connectorId) return;
      await saveFieldMap({ connectorId, mapping });
    },
    onError: (e: unknown) => {
      if (isUnauthorized(e)) router.replace("/login");
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error("Connection required.");
      const config = { schedule, conflict };

      if (connection.kind === "file") {
        if (!file) throw new Error("Please select a file first.");
        if (!tableName) throw new Error("Please select a table first.");
        const prepared = await prepareFileForImport({
          file,
          sourceType: connection.format,
          mapping,
        });
        return runFileImport({
          file: prepared,
          sourceType: connection.format,
          targetTable: tableName,
        });
      }

      if (!connectorId) throw new Error("Connector not saved yet.");
      return runImport({ connectorId, config });
    },
    onError: (e: unknown) => {
      if (isUnauthorized(e)) router.replace("/login");
    },
  });

  const pending = saveMapMutation.isPending || runMutation.isPending;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4 sm:p-6 lg:p-8">
      <Card className="relative z-10 w-full max-w-7xl h-full max-h-[90vh] flex flex-col bg-card shadow-2xl border-border/50">
        <CardHeader className="flex flex-row items-center justify-between py-4 border-b px-6 shrink-0">
          <div className="flex items-center gap-2">
            <CardTitle>Data Import Wizard</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 overflow-hidden p-6 space-y-6">
          {/* Stepper */}
          <div className="flex items-center gap-2 overflow-auto shrink-0 pb-2">
            {steps.map((s, i) => {
              const active = s.id === step;
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(s.id as typeof step)}
                    aria-current={active ? "step" : undefined}
                    className={[
                      "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70",
                    ].join(" ")}
                  >
                    {s.icon}
                    <span>{s.title}</span>
                  </button>
                  {i < steps.length - 1 ? (
                    <div className="h-px w-6 bg-border hidden md:block" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-2">
            {step === 1 && <StepSourceSelect />}
            {step === 2 && <StepConnectionForm />}
            {step === 3 && <StepFieldMapping />}
            {step === 4 && <StepPreview />}
            {step === 5 && <StepConfig />}
            {step === 6 && <StepProgress />}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setFooterError(null);
                setStep((Math.max(1, step - 1) as typeof step) || 1);
              }}
              disabled={step === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={async () => {
                setFooterError(null);
                if (pending) return;

                if (step === 1) {
                  setStep(2);
                  return;
                }

                if (step === 3) {
                  try {
                    await saveMapMutation.mutateAsync();
                    setStep(4);
                    toast({ title: "Mapping saved", variant: "success" });
                  } catch (e) {
                    const msg = getApiErrorMessage(e);
                    setFooterError(msg);
                    toast({ title: "Mapping save failed", description: msg, variant: "destructive" });
                  }
                  return;
                }

                if (step === 5) {
                  try {
                    const { jobId } = await runMutation.mutateAsync();
                    setJobId(jobId);
                    updateProgress({ status: "running", percent: 0, processed: 0, errors: [] });
                    setStep(6);
                    toast({ title: "Import started", description: `Job: ${jobId}`, variant: "success" });
                  } catch (e) {
                    const msg = getApiErrorMessage(e);
                    setFooterError(msg);
                    toast({ title: "Import start failed", description: msg, variant: "destructive" });
                  }
                  return;
                }

                setStep((Math.min(6, step + 1) as typeof step) || 6);
              }}
              disabled={!canNext || step >= 6 || pending}
            >
              {pending ? "Working..." : "Next"}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
          {footerError ? <p className="text-sm text-destructive">{footerError}</p> : null}
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}
