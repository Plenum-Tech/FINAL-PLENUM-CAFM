import { Button } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { cn } from "@/utils";

type UnstructuredRun = {
  status: "idle" | "running" | "blocked" | "done" | "failed";
  u1: "pending" | "running" | "blocked" | "done" | "failed";
  u2: "pending" | "running" | "blocked" | "done" | "failed";
  u3: "pending" | "running" | "blocked" | "done" | "failed";
  error: string | null;
};

export function UnstructuredPipelinePanel(props: {
  dataModeChoice: "structured" | "unstructured" | null;
  dataModeConfirmedAt: number | null;
  formatTime: (ts: number) => string;
  unstructuredRun: UnstructuredRun;
  setUnstructuredRun: (value: UnstructuredRun | ((prev: UnstructuredRun) => UnstructuredRun)) => void;
  startUnstructuredExtraction: () => void | Promise<void>;
  setCenterTab: (tab: "logs") => void;
}) {
  const { dataModeChoice, dataModeConfirmedAt, formatTime, unstructuredRun, setUnstructuredRun, startUnstructuredExtraction, setCenterTab } = props;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold tracking-widest text-orange-800">UNSTRUCTURED PIPELINE</div>
        </div>
        <div className="mt-2 text-sm text-orange-900">
          File marked as unstructured. This branch will run AI extraction and dynamic schema generation.
        </div>
        <div className="mt-3 text-xs text-orange-800/90">Decision time: {dataModeConfirmedAt ? formatTime(dataModeConfirmedAt) : "--"}</div>
        <div className="mt-1 text-xs text-orange-800/90">Selection: {dataModeChoice ?? "--"}</div>
        <div className="mt-2 text-xs text-orange-800/80">Backend APIs are required to run this flow.</div>
      </div>

      {unstructuredRun.error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
          <div className="text-sm font-semibold text-red-700">Blocked</div>
          <div className="mt-1 text-xs text-red-700/90 whitespace-pre-wrap">{unstructuredRun.error}</div>
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setCenterTab("logs")}>
              View logs
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setUnstructuredRun(() => ({ status: "idle", u1: "pending", u2: "pending", u3: "pending", error: null }));
                toast({ title: "Reset", description: "Unstructured pipeline reset.", variant: "success" });
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
          <div className="text-[11px] font-semibold text-muted-foreground tracking-widest">STEP U1</div>
          <div className="mt-1 text-sm font-semibold">Document Parsing</div>
          <div className="mt-1 text-xs text-muted-foreground">Parse PDF/text/mixed sheets into normalized chunks.</div>
          <span
            className={cn(
              "mt-3 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              unstructuredRun.u1 === "running"
                ? "border-orange-500/20 bg-orange-500/10 text-orange-700"
                : unstructuredRun.u1 === "done"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                  : unstructuredRun.u1 === "blocked"
                    ? "border-red-500/20 bg-red-500/10 text-red-700"
                    : "border-border/60 bg-muted/20 text-muted-foreground",
            )}
          >
            {unstructuredRun.u1.toUpperCase()}
          </span>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
          <div className="text-[11px] font-semibold text-muted-foreground tracking-widest">STEP U2</div>
          <div className="mt-1 text-sm font-semibold">Entity Extraction</div>
          <div className="mt-1 text-xs text-muted-foreground">AI extracts assets, fields, and relationships from free-form data.</div>
          <span
            className={cn(
              "mt-3 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              unstructuredRun.u2 === "running"
                ? "border-orange-500/20 bg-orange-500/10 text-orange-700"
                : unstructuredRun.u2 === "done"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                  : unstructuredRun.u2 === "blocked"
                    ? "border-red-500/20 bg-red-500/10 text-red-700"
                    : "border-border/60 bg-muted/20 text-muted-foreground",
            )}
          >
            {unstructuredRun.u2.toUpperCase()}
          </span>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
          <div className="text-[11px] font-semibold text-muted-foreground tracking-widest">STEP U3</div>
          <div className="mt-1 text-sm font-semibold">Dynamic Schema Build</div>
          <div className="mt-1 text-xs text-muted-foreground">Generate and validate a dynamic schema for downstream mapping.</div>
          <span
            className={cn(
              "mt-3 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              unstructuredRun.u3 === "running"
                ? "border-orange-500/20 bg-orange-500/10 text-orange-700"
                : unstructuredRun.u3 === "done"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                  : unstructuredRun.u3 === "blocked"
                    ? "border-red-500/20 bg-red-500/10 text-red-700"
                    : "border-border/60 bg-muted/20 text-muted-foreground",
            )}
          >
            {unstructuredRun.u3.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/60 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Next Action</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Unstructured extraction requires backend integration.</div>
          </div>
          <Button
            type="button"
            disabled
            onClick={startUnstructuredExtraction}
          >
            Start Unstructured Extraction
          </Button>
        </div>
      </div>
    </div>
  );
}
