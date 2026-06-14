"use client";

import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

import { createVendorAction, type CreateVendorState } from "./actions";

const INITIAL_STATE: CreateVendorState = {};

export function CreateVendorForm() {
  const [state, formAction, pending] = useFormState(createVendorAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>New Vendor</CardTitle>
            <p className="text-sm text-muted-foreground">Create vendor entry for CAFM modules.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Name</label>
              <Input name="name" placeholder="Vendor name" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input name="email" type="email" placeholder="vendor@company.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input name="phone" placeholder="+92 ..." />
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
