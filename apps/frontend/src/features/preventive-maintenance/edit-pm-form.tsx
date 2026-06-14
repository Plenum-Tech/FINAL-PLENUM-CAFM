"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";

import { updatePmAction, type UpdatePmState } from "./actions";
import type { PreventiveMaintenance } from "./types";

const INITIAL_STATE: UpdatePmState = {};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function EditPmForm({ item }: { item: PreventiveMaintenance }) {
  const [state, formAction, pending] = useFormState(updatePmAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={item.id} />
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Edit PM Schedule</CardTitle>
            <p className="text-sm text-muted-foreground">{item.code}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input name="name" defaultValue={item.name} required />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Code</label>
              <Input name="code" defaultValue={item.code} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Next Due (Optional)</label>
              <Input name="nextDue" type="date" defaultValue={item.nextDue ?? ""} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Frequency</label>
              <select name="frequency" defaultValue={item.frequency} className={selectClassName}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select name="status" defaultValue={item.status} className={selectClassName}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Asset (Optional)</label>
            <Input name="asset" defaultValue={item.asset ?? ""} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Location (Optional)</label>
            <Input name="location" defaultValue={item.location ?? ""} />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={APP_ROUTES.preventiveMaintenance}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
