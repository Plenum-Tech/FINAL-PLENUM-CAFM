"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";

import { updateLocationAction, type UpdateLocationState } from "./actions";
import type { Location } from "./types";

const INITIAL_STATE: UpdateLocationState = {};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function EditLocationForm({ location }: { location: Location }) {
  const [state, formAction, pending] = useFormState(updateLocationAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={location.id} />
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Edit Location</CardTitle>
            <p className="text-sm text-muted-foreground">{location.id}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input name="name" defaultValue={location.name} required />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <select name="type" defaultValue={location.type} className={selectClassName}>
                <option value="building">Building</option>
                <option value="floor">Floor</option>
                <option value="area">Area</option>
                <option value="room">Room</option>
                <option value="zone">Zone</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Code (Optional)</label>
              <Input name="code" defaultValue={location.code ?? ""} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Parent (Optional)</label>
            <Input name="parent" defaultValue={location.parent ?? ""} />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={APP_ROUTES.locations}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
