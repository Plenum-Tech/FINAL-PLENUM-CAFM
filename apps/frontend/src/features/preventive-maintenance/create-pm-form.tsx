"use client";

import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

import { createPmAction, type CreatePmState } from "./actions";

const INITIAL_STATE: CreatePmState = {};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function CreatePmForm() {
  const [state, formAction, pending] = useFormState(createPmAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <CardTitle>Add PM Schedule</CardTitle>
            <p className="text-sm text-muted-foreground">Preventive maintenance schedule (demo).</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input name="name" placeholder="e.g. HVAC Monthly Inspection" required />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Code</label>
              <Input name="code" placeholder="e.g. PM-0003" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Next Due (Optional)</label>
              <Input name="nextDue" type="date" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Frequency</label>
              <select name="frequency" defaultValue="monthly" className={selectClassName}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select name="status" defaultValue="active" className={selectClassName}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Asset (Optional)</label>
            <Input name="asset" placeholder="e.g. HVAC-A-301" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Location (Optional)</label>
            <Input name="location" placeholder="e.g. Building A - Floor 3" />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button disabled={pending} type="submit" className="w-full">
            {pending ? "Saving..." : "Add PM"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
