"use client";

import { useActionState } from "react";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

import { createLocationAction, type CreateLocationState } from "./actions";

const INITIAL_STATE: CreateLocationState = {};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function CreateLocationForm() {
  const [state, formAction, pending] = useActionState(createLocationAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <CardTitle>Add Location</CardTitle>
            <p className="text-sm text-muted-foreground">Create a new location (demo).</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input name="name" placeholder="e.g. Building A - Floor 2" required />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <select name="type" defaultValue="area" className={selectClassName}>
                <option value="building">Building</option>
                <option value="floor">Floor</option>
                <option value="area">Area</option>
                <option value="room">Room</option>
                <option value="zone">Zone</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Code (Optional)</label>
              <Input name="code" placeholder="e.g. BLD-A-F2" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Parent (Optional)</label>
            <Input name="parent" placeholder="e.g. Building A" />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button disabled={pending} type="submit" className="w-full">
            {pending ? "Saving..." : "Add Location"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
