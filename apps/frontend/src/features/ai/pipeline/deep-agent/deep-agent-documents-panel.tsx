"use client";

import { BookOpen } from "lucide-react";

import { CardDescription, CardHeader, CardTitle } from "@/components/ui";
import DocRagContent from "@/features/ai/pipeline/doc-rag/doc-rag-content";
import { cn } from "@/utils/cn";

type Props = {
  initialDocumentId?: string | null;
  embeddedRail?: boolean;
  className?: string;
};

export function DeepAgentDocumentsPanel({
  initialDocumentId,
  embeddedRail,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-xl border border-slate-200/90 bg-white shadow-sm overflow-hidden",
        embeddedRail ? "" : "",
        className,
      )}
    >
      <CardHeader className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-rose-50/50 to-white py-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-rose-600 flex items-center justify-center shrink-0">
            <BookOpen size={16} className="text-white" />
          </div>
          <div>
            <CardTitle className="text-base">Documents & Doc RAG</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Upload certificates and PDFs, match rows to CMMS, and query indexed content.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <DocRagContent initialDocumentId={initialDocumentId ?? null} onReset={() => undefined} />
      </div>
    </div>
  );
}
