"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, CardContent, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { createUser, getUser, updateUser, type PlenumUser } from "@/features/users/plenum-api";

type Mode = "create" | "edit";

type FastApiValidationIssue = {
  loc: Array<string | number>;
  msg: string;
};

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const p = err.payload as unknown;
    if (typeof p === "object" && p !== null) {
      const r = p as Record<string, unknown>;
      if (typeof r.detail === "string" && r.detail.trim()) return r.detail;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message || "Something went wrong";
  return "Something went wrong";
}

function extractFieldErrorsFromPayload(payload: unknown): Record<string, string> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  const out: Record<string, string> = {};
  const detail = (rec as { detail?: unknown }).detail;
  if (Array.isArray(detail)) {
    for (const it of detail) {
      if (typeof it !== "object" || it === null) continue;
      const issue = it as Partial<FastApiValidationIssue>;
      if (Array.isArray(issue.loc) && typeof issue.msg === "string") {
        const key = [...issue.loc].reverse().find((x) => typeof x === "string" && (x as string).trim());
        if (typeof key === "string") out[key] = issue.msg;
      }
    }
  } else if (typeof detail === "string") {
    out._ = detail;
  }
  return Object.keys(out).length ? out : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function UserForm({ mode, userId }: { mode: Mode; userId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const orgId = orgSelected?.id ?? "";
  const orgName = orgSelected?.name ?? "";

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [emailVerified, setEmailVerified] = useState(false);
  const [password, setPassword] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const detailsQuery = useQuery<PlenumUser, unknown>({
    queryKey: ["plenum-user", userId],
    enabled: mode === "edit" && Boolean(userId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) => getUser({ id: userId ?? "", signal }),
  });

  useEffect(() => {
    if (mode !== "edit") return;
    const u = detailsQuery.data;
    if (!u) return;
    setFullName(u.full_name ?? "");
    setEmail(u.email ?? "");
    setPhone(u.phone ?? "");
    setStatus(u.status === "inactive" ? "inactive" : "active");
    setEmailVerified(Boolean(u.email_verified));
    setPassword("");
    setSubmitError(null);
    setFieldErrors({});
  }, [detailsQuery.data, mode]);

  const saveMutation = useMutation<PlenumUser, unknown>({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      if (!orgId) errs.organization_id = "Organization is required.";
      const fn = fullName.trim();
      if (!fn) errs.full_name = "Full name is required.";
      const em = email.trim();
      if (!em) errs.email = "Email is required.";
      else if (!isValidEmail(em)) errs.email = "Invalid email.";

      const pw = password.trim();
      if (mode === "create" && !pw) errs.password_hash = "Password is required.";

      const st = status.trim();
      if (!st) errs.status = "Status is required.";

      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        throw new Error("VALIDATION");
      }
      setFieldErrors({});
      setSubmitError(null);

      if (mode === "create") {
        return createUser({
          organization_id: orgId,
          full_name: fn,
          email: em,
          password_hash: pw,
          phone: phone.trim(),
          status,
          email_verified: emailVerified,
        });
      }

      const body: {
        full_name: string;
        email: string;
        phone: string;
        status: "active" | "inactive";
        email_verified: boolean;
        password_hash?: string;
      } = {
        full_name: fn,
        email: em,
        phone: phone.trim(),
        status,
        email_verified: emailVerified,
      };
      if (pw) body.password_hash = pw;

      return updateUser({ id: userId ?? "", body });
    },
    onSuccess: async (u) => {
      toast({ title: mode === "create" ? "User created" : "User updated", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["plenum-users"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-user", u.id] });
      if (mode === "create") router.push(APP_ROUTES.users);
      else router.push(`${APP_ROUTES.users}/${u.id}`);
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "VALIDATION") return;
      if (e instanceof ApiError && e.status === 401) {
        router.replace(APP_ROUTES.login);
        return;
      }
      if (e instanceof ApiError) {
        const fe = extractFieldErrorsFromPayload(e.payload);
        if (fe) {
          const msg = fe._;
          const { _, ...rest } = fe as Record<string, string>;
          if (Object.keys(rest).length) setFieldErrors(rest);
          if (msg) setSubmitError(msg);
          if (!msg && Object.keys(rest).length === 0) setSubmitError(e.message);
          return;
        }
      }
      setSubmitError(getErrorMessage(e));
    },
  });

  const pending = saveMutation.isPending;
  const disableSubmit = pending || !orgId || (mode === "edit" && !userId);

  const title = useMemo(() => (mode === "create" ? "Add User" : "Edit User"), [mode]);
  const subtitle = useMemo(() => {
    if (!orgId) return "Select organization from header";
    return orgName || orgId;
  }, [orgId, orgName]);

  if (mode === "edit" && detailsQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (mode === "edit" && detailsQuery.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{getErrorMessage(detailsQuery.error)}</p>
        <Button variant="outline" type="button" onClick={() => detailsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <form
      className="w-full"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitError(null);
        saveMutation.mutate();
      }}
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Full Name</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              {fieldErrors.full_name ? <p className="text-xs text-destructive">{fieldErrors.full_name}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              {fieldErrors.email ? <p className="text-xs text-destructive">{fieldErrors.email}</p> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
              {fieldErrors.phone ? <p className="text-xs text-destructive">{fieldErrors.phone}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value === "inactive" ? "inactive" : "active")}
                className={selectClassName}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {fieldErrors.status ? <p className="text-xs text-destructive">{fieldErrors.status}</p> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{mode === "create" ? "Password" : "Password (Optional)"}</label>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder={mode === "create" ? "" : "Leave blank to keep unchanged"}
              />
              {fieldErrors.password_hash ? (
                <p className="text-xs text-destructive">{fieldErrors.password_hash}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email Verified</label>
              <div className="flex items-center gap-2 h-10">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={emailVerified}
                  onChange={(e) => setEmailVerified(e.target.checked)}
                />
                <span className="text-sm text-muted-foreground">Verified</span>
              </div>
              {fieldErrors.email_verified ? (
                <p className="text-xs text-destructive">{fieldErrors.email_verified}</p>
              ) : null}
            </div>
          </div>

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          {fieldErrors.organization_id ? (
            <p className="text-sm text-destructive">{fieldErrors.organization_id}</p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="secondary" disabled={pending}>
              <Link href={APP_ROUTES.users}>Cancel</Link>
            </Button>
            <Button disabled={disableSubmit} type="submit">
              {pending ? "Saving..." : mode === "create" ? "Add User" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
