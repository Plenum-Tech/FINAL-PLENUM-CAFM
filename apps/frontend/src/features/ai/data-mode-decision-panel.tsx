import { Button } from "@/components/ui";
import { cn } from "@/utils";

export type DecisionInsights = {
  matchedCount: number;
  totalCount: number;
  confidencePct: number;
  schemaName: string;
  matchedColumns: string[];
  unmatchedColumns: string[];
  lowConfidenceColumns: string[];
  explanation: string | null;
};

export function DataModeDecisionPanel(props: {
  dataModeChoice: "structured" | "unstructured" | null;
  dataModeConfirmedAt: number | null;
  decisionDetailsOpen: boolean;
  onToggleDetails: () => void;
  decisionInsights: DecisionInsights;
  formatTime: (ts: number) => string;
  onConfirm: (mode: "structured" | "unstructured") => void | Promise<void>;
}) {
  const {
    dataModeChoice,
    dataModeConfirmedAt,
    decisionDetailsOpen,
    onToggleDetails,
    decisionInsights,
    formatTime,
    onConfirm,
  } = props;

  return (
    <div className="space-y-4">
      {dataModeChoice && dataModeConfirmedAt ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="text-sm font-semibold text-primary">
            Selected: {dataModeChoice === "structured" ? "Structured" : "Unstructured"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Saved at {formatTime(dataModeConfirmedAt)}</div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold tracking-widest text-blue-800">AI EXPLANATION</div>
        </div>
        <div className="mt-2 text-sm text-blue-900">
          {decisionInsights.explanation ??
            "I analyzed your file and found partial schema alignment. You can proceed with structured mapping or treat this as unstructured data for AI-based extraction."}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className={cn(
            "rounded-2xl border p-5 bg-emerald-50/80 border-emerald-200 shadow-sm transition-all duration-200 hover:shadow-md",
            dataModeChoice === "structured" ? "ring-2 ring-emerald-400/60" : "",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-bold text-emerald-900">Structured Data Detected</div>
          </div>
          <div className="mt-2 text-sm text-emerald-900">
            {decisionInsights.matchedCount} out of {decisionInsights.totalCount} columns matched with schema
          </div>
          <div className="mt-1 text-sm font-semibold text-emerald-800">Confidence: {decisionInsights.confidencePct.toFixed(1)}%</div>
          <div className="mt-1 text-xs text-emerald-700/90">Schema: {decisionInsights.schemaName}</div>
          <div className="mt-4 space-y-1.5 text-sm text-emerald-900">
            <div>✔ Columns aligned with database schema</div>
            <div>✔ Ready for mapping pipeline</div>
            <div>✔ Minimal manual intervention required</div>
          </div>
          <Button
            type="button"
            className="mt-5 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={dataModeConfirmedAt !== null && dataModeChoice !== "structured"}
            onClick={() => void onConfirm("structured")}
          >
            Continue as Structured
          </Button>
        </div>

        <div
          className={cn(
            "rounded-2xl border p-5 bg-orange-50/80 border-orange-200 shadow-sm transition-all duration-200 hover:shadow-md",
            dataModeChoice === "unstructured" ? "ring-2 ring-orange-400/60" : "",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-bold text-orange-900">Unstructured Data Detected</div>
          </div>
          <div className="mt-2 text-sm text-orange-900">Some or no columns matched with schema</div>
          <div className="mt-2 text-sm text-orange-900/90">
            Data does not align with existing schema. Likely contains free-text, mixed formats, or unknown structure.
          </div>
          <div className="mt-4 space-y-1.5 text-sm text-orange-900">
            <div>✔ Suitable for PDFs, text, mixed Excel</div>
            <div>✔ Requires AI-based extraction</div>
            <div>✔ Schema will be generated dynamically</div>
          </div>
          <Button
            type="button"
            className="mt-5 bg-orange-600 hover:bg-orange-700 text-white"
            disabled={dataModeConfirmedAt !== null && dataModeChoice !== "unstructured"}
            onClick={() => void onConfirm("unstructured")}
          >
            Treat as Unstructured
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/60 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">Optional Diagnostics</div>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">View matched/unmatched and low-confidence columns.</div>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onToggleDetails}>
            {decisionDetailsOpen ? "Hide Details" : "View Details"}
          </Button>
        </div>

        {decisionDetailsOpen ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold tracking-widest text-emerald-800">MATCHED COLUMNS</div>
              <div className="mt-2 max-h-28 overflow-auto space-y-1 text-xs text-emerald-900">
                {decisionInsights.matchedColumns.length ? (
                  decisionInsights.matchedColumns.map((name, idx) => <div key={`${name}_${idx}`}>{name}</div>)
                ) : (
                  <div className="text-xs text-muted-foreground">No matched columns yet.</div>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
              <div className="text-xs font-semibold tracking-widest text-orange-800">UNMATCHED COLUMNS</div>
              <div className="mt-2 max-h-28 overflow-auto space-y-1 text-xs text-orange-900">
                {decisionInsights.unmatchedColumns.length ? (
                  decisionInsights.unmatchedColumns.map((name, idx) => <div key={`${name}_${idx}`}>{name}</div>)
                ) : (
                  <div className="text-xs text-muted-foreground">No unmatched columns.</div>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-semibold tracking-widest text-red-800">LOW CONFIDENCE</div>
              <div className="mt-2 max-h-28 overflow-auto space-y-1 text-xs text-red-900">
                {decisionInsights.lowConfidenceColumns.length ? (
                  decisionInsights.lowConfidenceColumns.map((name, idx) => <div key={`${name}_${idx}`}>{name}</div>)
                ) : (
                  <div className="text-xs text-muted-foreground">No low confidence columns.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/60 p-5">
        <div className="text-sm font-semibold">AI Assistant</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Do you want me to proceed with structured mapping or handle this as unstructured data?
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={dataModeConfirmedAt !== null && dataModeChoice !== "structured"}
            onClick={() => void onConfirm("structured")}
          >
            Structured
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={dataModeConfirmedAt !== null && dataModeChoice !== "unstructured"}
            onClick={() => void onConfirm("unstructured")}
          >
            Unstructured
          </Button>
        </div>
        {dataModeChoice ? (
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
            Selection captured: {dataModeChoice === "structured" ? "Structured" : "Unstructured"}.
          </div>
        ) : null}
      </div>
    </div>
  );
}
