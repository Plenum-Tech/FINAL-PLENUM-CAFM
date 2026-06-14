"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

export function DataImportWizardModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-default"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal Content - matching the user's screenshot */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl rounded-xl border bg-card p-6 shadow-xl flex items-center justify-between animate-in fade-in zoom-in-95 duration-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">Data Import Wizard</h2>
          <p className="text-sm text-muted-foreground">Import from DBs, files and APIs.</p>
        </div>

        <Button
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6 py-2 h-auto"
          onClick={() => {
            alert("Launch Wizard functionality to be implemented.");
            onOpenChange(false);
          }}
        >
          Launch Wizard
        </Button>
      </div>
    </div>,
    document.body,
  );
}
