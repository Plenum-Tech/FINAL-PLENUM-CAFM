"use client";

import { useFormState } from "react-dom";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";

import { loginAction, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = {};

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useFormState(loginAction, INITIAL_STATE);

  return (
    <form action={formAction} className="w-full max-w-md">
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <CardTitle>Sign in</CardTitle>
            <p className="text-sm text-muted-foreground">Demo login: any email + password.</p>
          </div>

          <input type="hidden" name="redirectTo" value={redirectTo || ""} />

          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <Input
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Password</label>
            <Input name="password" type="password" autoComplete="current-password" required />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button className="w-full" disabled={pending} type="submit">
            {pending ? "Signing in..." : "Sign in"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
