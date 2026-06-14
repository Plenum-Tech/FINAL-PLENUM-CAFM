"use client";

import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

import { createTemplateAction, type CreateTemplateState } from "./actions";

const INITIAL_STATE: CreateTemplateState = {};

export function CreateTemplateForm() {
  const [state, formAction, pending] = useFormState(createTemplateAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>New Template</CardTitle>
            <p className="text-sm text-muted-foreground">
              Create templates for downstream modules.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input name="name" placeholder="Template name" required />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input name="description" placeholder="Short description (optional)" />
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
