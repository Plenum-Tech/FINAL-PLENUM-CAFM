"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, CardContent, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { createVendor, getVendor, updateVendor, type PlenumVendor } from "@/features/vendor/plenum-api";

type Mode = "create" | "edit";

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

export function VendorForm({ mode, vendorId }: { mode: Mode; vendorId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const orgId = orgSelected?.id ?? "";
  const orgName = orgSelected?.name ?? "";

  const [vendorIdInput, setVendorIdInput] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [rateCardHourlyAed, setRateCardHourlyAed] = useState<string>("");
  const [slaResponseMins, setSlaResponseMins] = useState<string>("");
  const [address, setAddress] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const detailsQuery = useQuery<PlenumVendor, unknown>({
    queryKey: ["plenum-vendor", vendorId],
    enabled: mode === "edit" && Boolean(vendorId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getVendor({ id: vendorId ?? "", signal }),
  });

  useEffect(() => {
    if (mode !== "edit") return;
    const v = detailsQuery.data;
    if (!v) return;
    setVendorIdInput(v.id ?? "");
    setVendorName(v.name ?? "");
    setSpecialty(v.specialty ?? "");
    setRateCardHourlyAed(v.rate_card_hourly_aed === null ? "" : String(v.rate_card_hourly_aed));
    setSlaResponseMins(v.sla_response_mins === null ? "" : String(v.sla_response_mins));
    setAddress(v.address ?? "");
  }, [detailsQuery.data, mode]);

  const title = useMemo(() => (mode === "create" ? "New Vendor" : "Edit Vendor"), [mode]);
  const subtitle = useMemo(() => {
    const org = orgName || orgId;
    if (mode === "create") return org ? `Organization: ${org}` : "Select organization from header.";
    return vendorId ? `Vendor ID: ${vendorId}` : "";
  }, [mode, orgId, orgName, vendorId]);

  const mutation = useMutation<void, unknown>({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      const vid = vendorIdInput.trim();
      const vn = vendorName.trim();
      const sp = specialty.trim();
      const addr = address.trim();

      if (!orgId && mode === "create") errs.organization_id = "Organization is required.";
      if (mode === "create" && !vid) errs.vendor_id = "Vendor ID is required.";
      if (!vn) errs.vendor_name = "Vendor name is required.";
      if (!sp) errs.specialty = "Specialty is required.";

      const rateNum = Number(rateCardHourlyAed);
      if (!Number.isFinite(rateNum)) errs.rate_card_hourly_aed = "Rate card (hourly AED) must be a number.";
      else if (rateNum < 0) errs.rate_card_hourly_aed = "Rate card (hourly AED) must be >= 0.";

      const slaNum = Number(slaResponseMins);
      if (!Number.isFinite(slaNum)) errs.sla_response_mins = "SLA response mins must be a number.";
      else if (slaNum < 0) errs.sla_response_mins = "SLA response mins must be >= 0.";

      if (!addr) errs.address = "Address is required.";

      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        throw new Error("VALIDATION");
      }

      setFieldErrors({});
      setSubmitError(null);

      if (mode === "create") {
        await createVendor({
          organization_id: orgId,
          vendor_id: vid,
          vendor_name: vn,
          specialty: sp,
          rate_card_hourly_aed: rateNum,
          sla_response_mins: slaNum,
          address: addr,
        });
      } else {
        if (!vendorId) throw new Error("Missing vendor id.");
        await updateVendor({
          id: vendorId,
          body: {
            vendor_name: vn,
            specialty: sp,
            rate_card_hourly_aed: rateNum,
            sla_response_mins: slaNum,
            address: addr,
          },
        });
      }
    },
    onSuccess: async () => {
      toast({ title: mode === "create" ? "Vendor created" : "Vendor updated", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["plenum-vendors"] });
      if (vendorId) await queryClient.invalidateQueries({ queryKey: ["plenum-vendor", vendorId] });
      router.push(mode === "create" ? APP_ROUTES.vendors : `${APP_ROUTES.vendors}/${vendorId}`);
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
        setSubmitError(null);
        mutation.mutate();
      }}
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Vendor ID</label>
                <Input
                  value={vendorIdInput}
                  onChange={(e) => setVendorIdInput(e.target.value)}
                  placeholder="V0001"
                  disabled={mode === "edit"}
                />
                {fieldErrors.vendor_id ? <div className="text-xs text-destructive">{fieldErrors.vendor_id}</div> : null}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Specialty</label>
                <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="HVAC / BMS / Electrical" />
                {fieldErrors.specialty ? <div className="text-xs text-destructive">{fieldErrors.specialty}</div> : null}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Vendor Name</label>
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor name" />
              {fieldErrors.vendor_name ? <div className="text-xs text-destructive">{fieldErrors.vendor_name}</div> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Rate Card Hourly (AED)</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={rateCardHourlyAed}
                  onChange={(e) => setRateCardHourlyAed(e.target.value)}
                  placeholder="284"
                />
                {fieldErrors.rate_card_hourly_aed ? (
                  <div className="text-xs text-destructive">{fieldErrors.rate_card_hourly_aed}</div>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">SLA Response (mins)</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={slaResponseMins}
                  onChange={(e) => setSlaResponseMins(e.target.value)}
                  placeholder="120"
                />
                {fieldErrors.sla_response_mins ? (
                  <div className="text-xs text-destructive">{fieldErrors.sla_response_mins}</div>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Address</label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
              {fieldErrors.address ? <div className="text-xs text-destructive">{fieldErrors.address}</div> : null}
            </div>
          </div>

          {fieldErrors.organization_id ? <div className="text-xs text-destructive">{fieldErrors.organization_id}</div> : null}
          {submitError ? <div className="text-sm text-destructive">{submitError}</div> : null}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={mutation.isPending || (mode === "create" && !orgId)}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => router.push(mode === "edit" && vendorId ? `${APP_ROUTES.vendors}/${vendorId}` : APP_ROUTES.vendors)}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
