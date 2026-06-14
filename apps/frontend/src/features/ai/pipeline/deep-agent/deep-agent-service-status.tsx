"use client";

import { Loader2 } from "lucide-react";

import type { HealthResponse } from "@/features/ai/deep-agents-api";
import { cn } from "@/utils/cn";

export function DeepAgentServiceStatus(props: {
  loading?: boolean;
  health: HealthResponse | undefined;
  isError?: boolean;
  toolsCount?: number;
  variant?: "light" | "dark";
}) {
  const { loading, health, isError, toolsCount, variant = "light" } = props;
  const dark = variant === "dark";

  if (loading) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-medium",
          dark ? "text-slate-400" : "text-slate-400",
        )}
      >
        <Loader2 size={11} className="animate-spin" />
        Checking
      </span>
    );
  }

  if (isError || !health) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-medium",
          dark ? "text-red-300" : "text-red-600",
        )}
        title="Start svc-deepagents or use docker-compose with the /backend/deep-agents gateway route."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Offline
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium",
        dark ? "text-slate-300" : "text-slate-500",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Connected
      {typeof toolsCount === "number" ? (
        <span className={dark ? "text-slate-500" : "text-slate-400"}>· {toolsCount} tools</span>
      ) : null}
    </span>
  );
}
