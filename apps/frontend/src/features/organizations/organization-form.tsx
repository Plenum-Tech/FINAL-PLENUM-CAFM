"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, CardContent, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";

import { createOrganization, getOrganization, updateOrganization, type PlenumOrganization } from "./plenum-api";

type Mode = "create" | "edit";
type OrgStatus = "active" | "trial" | "suspended";

type FastApiValidationIssue = {
  loc: Array<string | number>;
  msg: string;
};

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
  if ("detail" in rec) {
    const detail = (rec as { detail: unknown }).detail;
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
  }
  return Object.keys(out).length ? out : null;
}

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function toOrgStatus(v: string | null | undefined): OrgStatus {
  if (v === "trial") return "trial";
  if (v === "suspended") return "suspended";
  return "active";
}

export function OrganizationForm({ mode, organizationId }: { mode: Mode; organizationId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setOrgSelected = useOrganizationStore((s) => s.setSelected);

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [address, setAddress] = useState("");
  const [country, setCountry] = useState("");
  const [timezone, setTimezone] = useState("");
  const [status, setStatus] = useState<OrgStatus>("active");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const detailsQuery = useQuery<PlenumOrganization, unknown>({
    queryKey: ["plenum-organization", organizationId],
    enabled: mode === "edit" && Boolean(organizationId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getOrganization({ id: organizationId ?? "", signal }),
  });

  useEffect(() => {
    if (mode !== "create") return;
    let tz = "UTC";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {}
    setTimezone(tz);
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit") return;
    const org = detailsQuery.data;
    if (!org) return;
    setName(org.name ?? "");
    setIndustry(org.industry ?? "");
    setAddress(org.address ?? "");
    setCountry(org.country ?? "");
    setTimezone(org.timezone ?? "");
    setStatus(toOrgStatus(org.status));
    setSubmitError(null);
    setFieldErrors({});
  }, [detailsQuery.data, mode]);

  const header = useMemo(() => (mode === "create" ? "Create Organization" : "Edit Organization"), [mode]);
  const sub = useMemo(() => (mode === "edit" && organizationId ? `Org ID: ${organizationId}` : "Create tenant for CAFM"), [mode, organizationId]);

  const mutation = useMutation<PlenumOrganization, unknown>({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      const n = name.trim();
      const i = industry.trim();
      const a = address.trim();
      const c = country.trim();
      const tz = timezone.trim();

      if (!n) errs.name = "Name is required.";
      if (!i) errs.industry = "Industry is required.";
      if (!a) errs.address = "Address is required.";
      if (!c) errs.country = "Country is required.";
      if (!tz) errs.timezone = "Timezone is required.";

      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        throw new Error("VALIDATION");
      }

      setFieldErrors({});
      setSubmitError(null);

      if (mode === "create") {
        return createOrganization({ name: n, industry: i, address: a, country: c, timezone: tz, status });
      }
      if (!organizationId) throw new Error("Missing organization id.");
      return updateOrganization({
        id: organizationId,
        body: { name: n, industry: i, address: a, country: c, timezone: tz, status },
      });
    },
    onSuccess: async (org) => {
      toast({ title: mode === "create" ? "Organization created" : "Organization updated", variant: "success" });
      setOrgSelected({ id: org.id, name: org.name });
      await queryClient.invalidateQueries({ queryKey: ["plenum-organizations"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-organization", org.id] });
      router.push(`${APP_ROUTES.organizations}/${org.id}`);
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "VALIDATION") return;
      if (e instanceof ApiError) {
        const fieldErrs = extractFieldErrorsFromPayload(e.payload);
        if (fieldErrs) setFieldErrors(fieldErrs);
      }
      setSubmitError(getErrorMessage(e));
    },
  });

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
        mutation.mutate();
      }}
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <CardTitle>{header}</CardTitle>
            <p className="text-sm text-muted-foreground">{sub}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Organization Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
              {fieldErrors.name ? <p className="text-xs text-destructive">{fieldErrors.name}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Industry</label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Real Estate" />
              {fieldErrors.industry ? <p className="text-xs text-destructive">{fieldErrors.industry}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Country</label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="UAE" />
              {fieldErrors.country ? <p className="text-xs text-destructive">{fieldErrors.country}</p> : null}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Address</label>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Full address"
              />
              {fieldErrors.address ? <p className="text-xs text-destructive">{fieldErrors.address}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Timezone</label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Dubai" />
              {fieldErrors.timezone ? <p className="text-xs text-destructive">{fieldErrors.timezone}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select className={selectClassName} value={status} onChange={(e) => setStatus(toOrgStatus(e.target.value))}>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="suspended">Suspended</option>
              </select>
              {fieldErrors.status ? <p className="text-xs text-destructive">{fieldErrors.status}</p> : null}
            </div>
          </div>

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button asChild variant="secondary" disabled={mutation.isPending}>
              <Link href={mode === "edit" && organizationId ? `${APP_ROUTES.organizations}/${organizationId}` : APP_ROUTES.organizations}>
                Cancel
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
