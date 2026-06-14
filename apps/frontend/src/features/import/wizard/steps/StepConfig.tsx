"use client";

import { useState } from "react";
import { Button, Card, CardContent, Input } from "@/components/ui";
import { useImportWizard } from "@/store/importWizard";
// config
export function StepConfig() {
  const { schedule, conflict, setConfig } = useImportWizard();
  const [mode, setMode] = useState(schedule.mode);
  const [cron, setCron] = useState(schedule.cron ?? "");
  const [c, setC] = useState(conflict);

  const save = () => {
    setConfig({ mode, cron: mode === "cron" ? cron : undefined }, c);
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Schedule</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="schedule"
                checked={mode === "oneoff"}
                onChange={() => setMode("oneoff")}
              />
              One-off (run now)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="schedule"
                checked={mode === "cron"}
                onChange={() => setMode("cron")}
              />
              Cron schedule
            </label>
            {mode === "cron" ? (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Cron Expression</label>
                <Input className="mt-1" value={cron} onChange={(e) => setCron(e.target.value)} />
              </div>
            ) : null}
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Conflict</p>
            {(["skip", "overwrite", "flag"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="conflict"
                  checked={c === m}
                  onChange={() => setC(m)}
                />
                {m}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={save}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
