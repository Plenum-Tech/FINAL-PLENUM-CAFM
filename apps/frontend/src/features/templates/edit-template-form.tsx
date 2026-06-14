"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";

import { updateTemplateAction, type UpdateTemplateState } from "./actions";
import type { Template } from "./types";

const INITIAL_STATE: UpdateTemplateState = {};

export function EditTemplateForm({ template }: { template: Template }) {
  const [state, formAction, pending] = useFormState(updateTemplateAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={template.id} />
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Edit Template</CardTitle>
            <p className="text-sm text-muted-foreground">{template.id}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input name="name" defaultValue={template.name} required />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input name="description" defaultValue={template.description ?? ""} />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex items-center gap-2">
            <Button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={APP_ROUTES.templates}>Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
