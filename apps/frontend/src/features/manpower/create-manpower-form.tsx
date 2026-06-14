"use client";

import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

import { createManpowerAction, type CreateManpowerState } from "./actions";

const INITIAL_STATE: CreateManpowerState = {};

export function CreateManpowerForm() {
  const [state, formAction, pending] = useFormState(createManpowerAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>New Manpower</CardTitle>
            <p className="text-sm text-muted-foreground">Create manpower records (demo).</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Name</label>
              <Input name="name" placeholder="Full name" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Designation</label>
              <Input name="designation" placeholder="Technician / Supervisor" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input name="phone" placeholder="+92 ..." />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Email</label>
              <Input name="email" type="email" placeholder="name@company.com" />
            </div>
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button disabled={pending} type="submit">
            {pending ? "Saving..." : "Create"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
