"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/utils";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmVariant = "destructive",
  pending = false,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: "default" | "destructive";
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  const headingId = useMemo(() => `confirm_${Math.random().toString(16).slice(2, 10)}`, []);

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          if (!pending) onOpenChange(false);
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={cn(
          "relative w-full max-w-md rounded-xl border bg-card shadow-xl",
          "animate-in fade-in zoom-in-95 duration-200",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5">
          <div id={headingId} className="text-base font-semibold">
            {title}
          </div>
          {description ? <div className="mt-2 text-sm text-muted-foreground">{description}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button type="button" variant={confirmVariant} disabled={pending} onClick={() => onConfirm()}>
            {pending ? "Please wait..." : confirmText}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
