"use client";

import { AlertCircle } from "lucide-react";

import { cn } from "@/utils/cn";

import type { ApprovalToolError } from "./approval-suggestion-parse";

export function DeepAgentApprovalErrorPanel(props: {
  error: ApprovalToolError;
  className?: string;
}) {
  const { error } = props;

  return (
    <div
      className={cn(
        "rounded-xl border border-red-200 bg-red-50/90 shadow-sm overflow-hidden",
        props.className,
      )}
      role="alert"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="h-9 w-9 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
          <AlertCircle size={18} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-red-900">Approval tool failed</h3>
          <p className="text-[11px] text-red-800/80 mt-0.5">
            <span className="font-mono">{error.sourceTool}</span>
            {error.statusCode != null ? (
              <>
                {" "}
                · HTTP {error.statusCode}
              </>
            ) : null}
          </p>
          <pre className="mt-2 text-xs text-red-900 whitespace-pre-wrap break-words font-sans leading-relaxed max-h-40 overflow-y-auto rounded-lg bg-white/80 border border-red-100 px-3 py-2">
            {error.message}
          </pre>
          <p className="text-[10px] text-red-700/80 mt-2">
            Check backend-app logs for{" "}
            <span className="font-mono">dynamic_approval.step_failed</span> or{" "}
            <span className="font-mono">api.suggest_approval.failed</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
