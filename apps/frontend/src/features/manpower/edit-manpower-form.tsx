"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";

import { updateManpowerAction, type UpdateManpowerState } from "./actions";
import type { Manpower } from "./types";

const INITIAL_STATE: UpdateManpowerState = {};

export function EditManpowerForm({ manpower }: { manpower: Manpower }) {
  const [state, formAction, pending] = useFormState(updateManpowerAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={manpower.id} />
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Edit Manpower</CardTitle>
            <p className="text-sm text-muted-foreground">{manpower.id}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Name</label>
              <Input name="name" defaultValue={manpower.name} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Designation</label>
              <Input name="designation" defaultValue={manpower.designation ?? ""} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input name="phone" defaultValue={manpower.phone ?? ""} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Email</label>
              <Input name="email" type="email" defaultValue={manpower.email ?? ""} />
            </div>
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={APP_ROUTES.manpower}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
