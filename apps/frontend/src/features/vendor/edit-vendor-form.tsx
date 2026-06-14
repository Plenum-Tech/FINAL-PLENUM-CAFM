"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";

import { updateVendorAction, type UpdateVendorState } from "./actions";
import type { Vendor } from "./types";

const INITIAL_STATE: UpdateVendorState = {};

export function EditVendorForm({ vendor }: { vendor: Vendor }) {
  const [state, formAction, pending] = useFormState(updateVendorAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={vendor.id} />
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Edit Vendor</CardTitle>
            <p className="text-sm text-muted-foreground">{vendor.id}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Name</label>
              <Input name="name" defaultValue={vendor.name} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input name="email" type="email" defaultValue={vendor.email ?? ""} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input name="phone" defaultValue={vendor.phone ?? ""} />
            </div>
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={APP_ROUTES.vendors}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
