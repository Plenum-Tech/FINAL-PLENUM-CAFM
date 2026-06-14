"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";

import { updateWorkOrderAction, type UpdateWorkOrderState } from "./actions";
import type { WorkOrder } from "./types";

const INITIAL_STATE: UpdateWorkOrderState = {};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function EditWorkOrderForm({ workOrder }: { workOrder: WorkOrder }) {
  const [state, formAction, pending] = useFormState(updateWorkOrderAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={workOrder.id} />
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Edit Work Order</CardTitle>
            <p className="text-sm text-muted-foreground">{workOrder.code}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input name="title" defaultValue={workOrder.title} required />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Code</label>
              <Input name="code" defaultValue={workOrder.code} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Due Date (Optional)</label>
              <Input name="dueDate" type="date" defaultValue={workOrder.dueDate ?? ""} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <select name="priority" defaultValue={workOrder.priority} className={selectClassName}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select name="status" defaultValue={workOrder.status} className={selectClassName}>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Asset (Optional)</label>
            <Input name="asset" defaultValue={workOrder.asset ?? ""} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Location (Optional)</label>
            <Input name="location" defaultValue={workOrder.location ?? ""} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Assigned To (Optional)</label>
            <Input name="assignedTo" defaultValue={workOrder.assignedTo ?? ""} />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={APP_ROUTES.workOrdersList}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
