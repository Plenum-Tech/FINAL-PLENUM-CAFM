"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { DeepAgentOrchestratorShell } from "@/features/ai/pipeline/deep-agent/deep-agent-orchestrator-shell";
import { parseOrchestratorSpaceParam } from "@/features/ai/pipeline/deep-agent/orchestrator-space-params";

function AiOrchestratorInner() {
  const searchParams = useSearchParams();
  const initialSpace = parseOrchestratorSpaceParam(searchParams.get("space"));
  return <DeepAgentOrchestratorShell initialSpace={initialSpace} />;
}

export function AiOrchestratorPageClient() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[480px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        </div>
      }
    >
      <AiOrchestratorInner />
    </Suspense>
  );
}
