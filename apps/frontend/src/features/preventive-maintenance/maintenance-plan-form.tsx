"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, CardContent, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError, apiFetch } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import {
  createMaintenancePlan,
  getMaintenancePlan,
  updateMaintenancePlan,
  type PlenumMaintenancePlan,
} from "@/features/preventive-maintenance/plenum-api";

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

function normalizeDateOnly(v: string): string {
  const s = v.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

type AssetLite = { id: string; asset_name?: string | null; name?: string | null; asset_code?: string | null; code?: string | null };

function parseAssetLite(x: unknown): AssetLite | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : typeof r.asset_id === "string" ? r.asset_id : "";
  if (!id.trim()) return null;
  return {
    id,
    asset_name: typeof r.asset_name === "string" ? r.asset_name : null,
    name: typeof r.name === "string" ? r.name : null,
    asset_code: typeof r.asset_code === "string" ? r.asset_code : null,
    code: typeof r.code === "string" ? r.code : null,
  };
}

async function fetchAssetsSelectPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("organization_id", input.organizationId);
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  if (input.search.trim()) params.set("search", input.search.trim());

  let payload: unknown;
  try {
    payload = await apiFetch<unknown>(`/api/v1/plenum/assets?${params.toString()}`, { signal: input.signal });
  } catch (e) {
    if (input.search.trim()) {
      const fallback = new URLSearchParams();
      fallback.set("organization_id", input.organizationId);
      fallback.set("limit", String(input.limit));
      fallback.set("offset", String(input.offset));
      payload = await apiFetch<unknown>(`/api/v1/plenum/assets?${fallback.toString()}`, { signal: input.signal });
    } else {
      throw e;
    }
  }

  const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : [];
  const assets = raw.map(parseAssetLite).filter((v): v is AssetLite => Boolean(v));

  const data = assets.map((a) => {
    const name = (a.asset_name ?? a.name ?? "").trim();
    const code = (a.asset_code ?? a.code ?? "").trim();
    const label = name && code ? `${name} (${code})` : name || code || a.id;
    return { id: a.id, label };
  });
  return { total, data };
}

export function MaintenancePlanForm({ mode, planId }: { mode: Mode; planId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const orgId = orgSelected?.id ?? "";
  const orgName = orgSelected?.name ?? "";

  const [assetOpen, setAssetOpen] = useState(false);
  const [asset, setAsset] = useState<InfiniteSelectItem | null>(null);

  const [maintenanceType, setMaintenanceType] = useState("");
  const [frequencyType, setFrequencyType] = useState("monthly");
  const [frequencyValue, setFrequencyValue] = useState<string>("1");
  const [nextDueDate, setNextDueDate] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const detailsQuery = useQuery<PlenumMaintenancePlan, unknown>({
    queryKey: ["plenum-maintenance-plan", planId],
    enabled: mode === "edit" && Boolean(planId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getMaintenancePlan({ id: planId ?? "", signal }),
  });

  const resolvedAssetId = detailsQuery.data?.asset_id ?? "";
  const assetLabelQuery = useQuery<{ label: string }, unknown>({
    queryKey: ["plenum-asset-lite", resolvedAssetId],
    enabled: mode === "edit" && Boolean(resolvedAssetId),
    retry: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const payload = await apiFetch<unknown>(`/api/v1/plenum/assets/${encodeURIComponent(resolvedAssetId)}`, { signal });
      const a = parseAssetLite(payload);
      if (!a) return { label: resolvedAssetId };
      const name = (a.asset_name ?? a.name ?? "").trim();
      const code = (a.asset_code ?? a.code ?? "").trim();
      const label = name && code ? `${name} (${code})` : name || code || a.id;
      return { label };
    },
  });

  useEffect(() => {
    if (mode !== "edit") return;
    const p = detailsQuery.data;
    if (!p) return;
    const aId = p.asset_id ?? "";
    setAsset(aId ? { id: aId, label: aId } : null);
    setMaintenanceType(p.maintenance_type ?? "");
    setFrequencyType(p.frequency_type ?? "monthly");
    setFrequencyValue(typeof p.frequency_value === "number" ? String(p.frequency_value) : "1");
    setNextDueDate(typeof p.next_due_date === "string" ? p.next_due_date.slice(0, 10) : "");
  }, [detailsQuery.data, mode]);

  useEffect(() => {
    if (mode !== "edit") return;
    if (!resolvedAssetId) return;
    const label = assetLabelQuery.data?.label;
    if (!label?.trim()) return;
    setAsset((prev) => {
      if (!prev || prev.id !== resolvedAssetId) return prev;
      if (prev.label && prev.label !== resolvedAssetId) return prev;
      return { ...prev, label };
    });
  }, [assetLabelQuery.data?.label, mode, resolvedAssetId]);

  const title = useMemo(() => (mode === "create" ? "New Maintenance Plan" : "Edit Maintenance Plan"), [mode]);
  const subtitle = useMemo(() => {
    const org = orgName || orgId;
    if (mode === "create") return org ? `Organization: ${org}` : "Select organization from header.";
    return planId ? `Plan ID: ${planId}` : "";
  }, [mode, orgId, orgName, planId]);

  const saveMutation = useMutation<void, unknown>({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      const mt = maintenanceType.trim();
      const ft = frequencyType.trim();
      const fv = Number(frequencyValue);
      const nd = normalizeDateOnly(nextDueDate);
      const assetId = asset?.id ?? "";

      if (mode === "create" && !orgId) errs.organization_id = "Organization is required.";
      if (!assetId) errs.asset_id = "Asset is required.";
      if (!mt) errs.maintenance_type = "Maintenance type is required.";
      if (!ft) errs.frequency_type = "Frequency type is required.";
      if (Number.isNaN(fv) || fv <= 0) errs.frequency_value = "Frequency value must be greater than 0.";
      if (!nd) errs.next_due_date = "Next due date is required.";

      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        throw new Error("VALIDATION");
      }
      setFieldErrors({});
      setSubmitError(null);

      if (mode === "create") {
        await createMaintenancePlan({
          organization_id: orgId,
          asset_id: assetId,
          maintenance_type: mt,
          frequency_type: ft,
          frequency_value: fv,
          next_due_date: nd,
        });
      } else {
        if (!planId) throw new Error("Missing plan id.");
        await updateMaintenancePlan({
          id: planId,
          body: {
            asset_id: assetId,
            maintenance_type: mt,
            frequency_type: ft,
            frequency_value: fv,
            next_due_date: nd,
          },
        });
      }
    },
    onSuccess: async () => {
      toast({ title: mode === "create" ? "Maintenance plan created" : "Maintenance plan updated", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["plenum-maintenance-plans"] });
      if (planId) await queryClient.invalidateQueries({ queryKey: ["plenum-maintenance-plan", planId] });
      router.push(mode === "create" ? APP_ROUTES.preventiveMaintenance : `${APP_ROUTES.preventiveMaintenance}/${planId}`);
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
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Asset</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setAssetOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{asset?.label ?? "Select asset"}</span>
                </Button>
                <InfiniteSelect
                  open={assetOpen}
                  onClose={() => setAssetOpen(false)}
                  onSelect={(item) => setAsset(item)}
                  valueLabel={asset?.label ?? ""}
                  placeholder="Search assets..."
                  pageSize={10}
                  cacheKey={orgId ? `pm-assets:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchAssetsSelectPage({ organizationId: orgId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.asset_id ? <p className="text-xs text-destructive">{fieldErrors.asset_id}</p> : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Maintenance Type</label>
              <Input value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)} placeholder="e.g. HVAC Inspection" />
              {fieldErrors.maintenance_type ? (
                <p className="text-xs text-destructive">{fieldErrors.maintenance_type}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Frequency Type</label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={frequencyType}
                onChange={(e) => setFrequencyType(e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
              {fieldErrors.frequency_type ? <p className="text-xs text-destructive">{fieldErrors.frequency_type}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Frequency Value</label>
              <Input value={frequencyValue} onChange={(e) => setFrequencyValue(e.target.value)} inputMode="numeric" />
              {fieldErrors.frequency_value ? (
                <p className="text-xs text-destructive">{fieldErrors.frequency_value}</p>
              ) : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Next Due Date</label>
              <Input value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} type="date" />
              {fieldErrors.next_due_date ? <p className="text-xs text-destructive">{fieldErrors.next_due_date}</p> : null}
            </div>
          </div>

          {fieldErrors.organization_id ? <p className="text-xs text-destructive">{fieldErrors.organization_id}</p> : null}
          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saveMutation.isPending || (mode === "create" && !orgId)}>
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saveMutation.isPending}
              onClick={() =>
                router.push(mode === "edit" && planId ? `${APP_ROUTES.preventiveMaintenance}/${planId}` : APP_ROUTES.preventiveMaintenance)
              }
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
