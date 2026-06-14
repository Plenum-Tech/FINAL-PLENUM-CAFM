import { Button } from "@/components/ui";
import { cn } from "@/utils";
import { getSidebarLogMetrics } from "@/features/ai/right-sidebar-metrics";

type NodeKey =
  | "Node 1"
  | "Node 2"
  | "Node 3"
  | "Node 4"
  | "Node 5"
  | "Node 6"
  | "Node 7"
  | "Node 8"
  | "Node 9"
  | "Unstructured";

type LogTone = "success" | "warning" | "error" | "neutral";

function toneDot(tone: LogTone) {
  if (tone === "error") return "bg-red-500";
  if (tone === "warning") return "bg-orange-500";
  if (tone === "success") return "bg-emerald-500";
  return "bg-muted-foreground/40";
}

export function NodeInspector(props: {
  options: NodeKey[];
  selectedKey: NodeKey;
  onChangeSelectedKey: (key: NodeKey) => void;
  ingestResponse: unknown;
  summaries: Parameters<typeof getSidebarLogMetrics>[0]["summaries"];
  logGroups: Array<{ key: string; name: string; tone: LogTone; lines: string[] }>;
  onViewLogs: () => void;
  className?: string;
}) {
  const { options, selectedKey, onChangeSelectedKey, ingestResponse, summaries, logGroups, onViewLogs, className } = props;

  const logsByKey = new Map<string, { tone: LogTone; name: string; lines: string[] }>();
  for (const g of logGroups) logsByKey.set(g.key, g);

  return (
    <div className={cn("rounded-2xl border border-border/60 bg-background/60 p-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-muted-foreground tracking-widest">NODE INSPECTOR</div>
      </div>

      <div className="mt-3 space-y-2">
        {options.map((k) => {
          const isOpen = k === selectedKey;
          const metrics = getSidebarLogMetrics({ groupKey: k, ingestResponse, summaries });
          const logGroup = logsByKey.get(k);
          const logs = logGroup?.lines ?? [];
          const tone = logGroup?.tone ?? "neutral";

          return (
            <details
              key={k}
              open={isOpen}
              className={cn("group rounded-xl border border-border/60 bg-background/60 overflow-hidden", isOpen ? "ring-1 ring-primary/20" : "")}
            >
              <summary
                className={cn(
                  "list-none cursor-pointer px-3 py-2",
                  "hover:bg-muted/20 transition-colors",
                )}
                onClick={() => onChangeSelectedKey(k)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", toneDot(tone))} />
                      <div className="text-sm font-semibold truncate">{k}</div>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground truncate">
                      {metrics.primary === "--" ? "No metrics yet" : metrics.primary}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground shrink-0">
                    {logs.length ? `${logs.length} logs` : "No logs"}
                  </div>
                </div>
              </summary>

              <div className="px-3 pb-3">
                <div className="rounded-xl border border-border/60 bg-muted/10 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{metrics.primary === "--" ? "No metrics yet" : metrics.primary}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {logGroup?.name ? logGroup.name : "No logs captured for this node yet"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!logs.length}
                      onClick={(e) => {
                        e.preventDefault();
                        onChangeSelectedKey(k);
                        onViewLogs();
                      }}
                    >
                      View logs
                    </Button>
                  </div>

                  {metrics.secondary.length ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {metrics.secondary.slice(0, 4).map((m) => (
                        <div key={m.k} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
                          <div className="text-[10px] font-semibold text-muted-foreground tracking-widest">{m.k}</div>
                          <div className="mt-0.5 text-sm font-bold">{m.v}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {logs.length ? (
                    <div className="mt-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap max-h-[160px] overflow-auto">
                      {logs.slice(-8).join("\n")}
                    </div>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
