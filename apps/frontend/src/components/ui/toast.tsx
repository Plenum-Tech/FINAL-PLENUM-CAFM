"use client";

import { useEffect } from "react";
import { create } from "zustand";

import { cn } from "@/utils";

type ToastVariant = "default" | "success" | "destructive";

type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  createdAt: number;
};

type ToastInput = Omit<ToastItem, "id" | "createdAt"> & {
  durationMs?: number;
};

type ToastState = {
  items: ToastItem[];
  push: (t: ToastInput) => void;
  remove: (id: string) => void;
};

const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = Math.random().toString(16).slice(2, 10);
    const createdAt = Date.now();
    const durationMs = t.durationMs ?? 4000;
    set({ items: [{ id, title: t.title, description: t.description, variant: t.variant, createdAt }, ...get().items] });
    globalThis.setTimeout(() => {
      get().remove(id);
    }, durationMs);
  },
  remove: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));

export function toast(input: { title: string; description?: string; variant?: ToastVariant; durationMs?: number }) {
  useToastStore.getState().push({
    title: input.title,
    description: input.description,
    variant: input.variant ?? "default",
    durationMs: input.durationMs,
  });
}

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const remove = useToastStore((s) => s.remove);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const first = items[0];
      if (first) remove(first.id);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [items, remove]);

  return (
    <div className="fixed right-4 top-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => remove(t.id)}
          className={cn(
            "rounded-lg border px-4 py-3 text-left shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80",
            t.variant === "default" && "border-border bg-background",
            t.variant === "success" && "border-emerald-600/30 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100",
            t.variant === "destructive" && "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <div className="text-sm font-semibold">{t.title}</div>
          {t.description ? <div className="mt-1 text-xs opacity-90">{t.description}</div> : null}
        </button>
      ))}
    </div>
  );
}

