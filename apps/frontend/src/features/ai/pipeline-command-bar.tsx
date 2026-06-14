import { ArrowRight, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils";

type StepStatus = "pending" | "running" | "blocked" | "done" | "failed";

export function PipelineCommandBar(props: {
  steps: Array<{ id: string; title: string; status: StepStatus }>;
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  decisionRequired?: boolean;
  onSelectStructured?: () => void;
  onSelectUnstructured?: () => void;
  badges?: Array<{ label: string; tone: "mock" | "warning" | "info" }>;
}) {
  const { steps, primaryAction, secondaryAction, decisionRequired, onSelectStructured, onSelectUnstructured, badges } = props;

  const statusStyle = (status: StepStatus) => {
    if (status === "done") return { ring: "border-emerald-500/20", bg: "bg-emerald-500/10", text: "text-emerald-700", Icon: CheckCircle2 };
    if (status === "running") return { ring: "border-orange-500/20", bg: "bg-orange-500/10", text: "text-orange-700", Icon: Loader2 };
    if (status === "failed") return { ring: "border-red-500/20", bg: "bg-red-500/10", text: "text-red-700", Icon: XCircle };
    if (status === "blocked") return { ring: "border-blue-500/20", bg: "bg-blue-500/10", text: "text-blue-700", Icon: Circle };
    return { ring: "border-border/60", bg: "bg-muted/15", text: "text-muted-foreground", Icon: Circle };
  };

  const badgeStyle = (tone: "mock" | "warning" | "info") => {
    if (tone === "mock") return "border-blue-300 bg-blue-100 text-blue-800";
    if (tone === "warning") return "border-orange-300 bg-orange-100 text-orange-800";
    return "border-border/60 bg-muted/15 text-muted-foreground";
  };

  return (
    <div className="sticky top-0 z-10 -mx-6 px-6 py-3 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs font-semibold text-muted-foreground tracking-widest">PIPELINE</div>
            {badges?.length
              ? badges.map((b) => (
                  <span key={`${b.tone}_${b.label}`} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", badgeStyle(b.tone))}>
                    {b.label}
                  </span>
                ))
              : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {steps.map((s) => {
              const st = statusStyle(s.status);
              const Icon = st.Icon;
              return (
                <div key={s.id} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", st.ring, st.bg, st.text)}>
                  <Icon className={cn("h-3.5 w-3.5", s.status === "running" ? "animate-spin" : "")} />
                  <span className="truncate max-w-[160px]">{s.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {decisionRequired ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={onSelectStructured} disabled={!onSelectStructured}>
                Structured
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={onSelectUnstructured} disabled={!onSelectUnstructured}>
                Unstructured
              </Button>
            </>
          ) : null}
          {secondaryAction ? (
            <Button type="button" size="sm" variant="secondary" onClick={secondaryAction.onClick} disabled={secondaryAction.disabled}>
              {secondaryAction.label}
            </Button>
          ) : null}
          {primaryAction ? (
            <Button type="button" size="sm" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
              <ArrowRight className="h-4 w-4 mr-1.5" />
              {primaryAction.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

