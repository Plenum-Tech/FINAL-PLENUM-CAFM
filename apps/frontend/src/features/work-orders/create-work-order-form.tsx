"use client";

import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

import { createWorkOrderAction, type CreateWorkOrderState } from "./actions";

const INITIAL_STATE: CreateWorkOrderState = {};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function CreateWorkOrderForm() {
  const [state, formAction, pending] = useFormState(createWorkOrderAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <CardTitle>Add Work Order</CardTitle>
            <p className="text-sm text-muted-foreground">Create a work order (demo).</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input name="title" placeholder="e.g. Inspect elevator noise" required />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Code</label>
              <Input name="code" placeholder="e.g. WO-0003" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Due Date (Optional)</label>
              <Input name="dueDate" type="date" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <select name="priority" defaultValue="medium" className={selectClassName}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select name="status" defaultValue="open" className={selectClassName}>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Assigned To (Optional)</label>
            <Input name="assignedTo" placeholder="e.g. Ali Raza" />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button disabled={pending} type="submit" className="w-full">
            {pending ? "Saving..." : "Add Work Order"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
