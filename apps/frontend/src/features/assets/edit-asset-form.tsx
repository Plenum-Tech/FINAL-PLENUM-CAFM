"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";
import { ApiError, apiFetch } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import QRCode from "react-qr-code";

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type PlenumAsset = {
  id: string;
  organization_id: string;
  location_id: string | null;
  category_id: string | null;
  asset_name: string;
  asset_code: string;
  serial_number: string | null;
  manufacturer: string | null;
  model_number: string | null;
  installation_date: string | null;
  warranty_expiry: string | null;
  status: string;
  health_score: number | null;
  qr_code: string | null;
};

type FastApiValidationIssue = {
  loc: Array<string | number>;
  msg: string;
  type?: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
};

// FastAPI validation responses commonly return { detail: [{ loc: [...], msg: "..." }] }.
// We convert that into a { fieldName: message } map for inline form errors.
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
          const key = [...issue.loc].reverse().find((x) => typeof x === "string" && x.trim());
          if (typeof key === "string") out[key] = issue.msg;
        }
      }
    } else if (typeof detail === "string") {
      out._ = detail;
    }
  }
  return Object.keys(out).length ? out : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function generateQrCodeValue(): string {
  const g = globalThis as unknown as {
    crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return `qr_${uuid}`;

  const bytes = new Uint8Array(16);
  g.crypto?.getRandomValues?.(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex) return `qr_${hex}`;

  return `qr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchCategoriesPage({
  organizationId,
  limit,
  offset,
  signal,
}: {
  organizationId: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("organization_id", organizationId);
  const payload = await apiFetch<unknown>(`/api/v1/plenum/asset-categories?${params.toString()}`, {
    signal,
  });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : [];
  const data = raw
    .map((x): InfiniteSelectItem | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      const name =
        typeof r.name === "string" ? r.name : typeof r.category === "string" ? r.category : "";
      if (!id.trim() || !name.trim()) return null;
      return { id, label: name };
    })
    .filter((v): v is InfiniteSelectItem => Boolean(v));
  return { total, data };
}

async function fetchLocationsPage({
  organizationId,
  limit,
  offset,
  signal,
}: {
  organizationId: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("organization_id", organizationId);
  const payload = await apiFetch<unknown>(`/api/v1/plenum/locations?${params.toString()}`, { signal });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.locations) ? obj.locations : [];
  const data = raw
    .map((x): InfiniteSelectItem | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id =
        typeof r.id === "string" ? r.id : typeof r.location_id === "string" ? r.location_id : "";
      const name =
        typeof r.name === "string"
          ? r.name
          : typeof r.location_name === "string"
            ? r.location_name
            : "";
      if (!id.trim() || !name.trim()) return null;
      return { id, label: name };
    })
    .filter((v): v is InfiniteSelectItem => Boolean(v));
  return { total, data };
}

export function EditAssetForm({ assetId }: { assetId: string }) {
  const router = useRouter();
  const selectedOrg = useOrganizationStore((s) => s.selected);

  const assetQuery = useQuery<PlenumAsset, unknown>({
    queryKey: ["plenum-asset-edit", assetId],
    retry: 0,
    queryFn: ({ signal }) =>
      apiFetch<PlenumAsset>(`/api/v1/plenum/assets/${encodeURIComponent(assetId)}`, { signal }),
  });

  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // NOTE: We use controlled state so the form is truly prefilled even when data arrives async.
  const [organizationId, setOrganizationId] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [category, setCategory] = useState<InfiniteSelectItem | null>(null);
  const [locationSel, setLocationSel] = useState<InfiniteSelectItem | null>(null);
  const [assetName, setAssetName] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [installationDate, setInstallationDate] = useState("");
  const [warrantyExpiry, setWarrantyExpiry] = useState("");
  const [status, setStatus] = useState("active");
  const [healthScore, setHealthScore] = useState<number>(80);
  const [qrCode, setQrCode] = useState<string>("");

  useEffect(() => {
    if (!assetQuery.data) return;
    const a = assetQuery.data;
    setOrganizationId(a.organization_id);
    setAssetName(a.asset_name ?? "");
    setAssetCode(a.asset_code ?? "");
    setSerialNumber(a.serial_number ?? "");
    setManufacturer(a.manufacturer ?? "");
    setModelNumber(a.model_number ?? "");
    setInstallationDate(a.installation_date ?? "");
    setWarrantyExpiry(a.warranty_expiry ?? "");
    setStatus(a.status || "active");
    setHealthScore(typeof a.health_score === "number" ? a.health_score : 0);
    setQrCode(a.qr_code ?? "");

    // If we only have IDs (and no name lookup endpoint), we still prefill the selection using the ID.
    // When user opens the dropdown, they can switch to a proper name-based option.
    setCategory(a.category_id ? { id: a.category_id, label: a.category_id } : null);
    setLocationSel(a.location_id ? { id: a.location_id, label: a.location_id } : null);
    setFieldErrors({});
    setSubmitError(null);
  }, [assetQuery.data]);

  useEffect(() => {
    if (!assetQuery.isError) return;
    const e = assetQuery.error;
    if (e instanceof ApiError && e.status === 401) {
      router.replace(APP_ROUTES.login);
    }
  }, [assetQuery.error, assetQuery.isError, router]);

  const orgLabel = useMemo(() => {
    if (selectedOrg?.id && selectedOrg.id === organizationId) return selectedOrg.name;
    return selectedOrg?.name || organizationId || "Organization";
  }, [organizationId, selectedOrg?.id, selectedOrg?.name]);

  if (assetQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (assetQuery.isError) {
    const msg = assetQuery.error instanceof Error ? assetQuery.error.message : "Failed to load asset.";
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{msg}</p>
        <Button variant="outline" onClick={() => assetQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const disableSubmit = pending || !organizationId;

  return (
    <form
      className="w-full"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setSubmitError(null);

        const next: Record<string, string> = {};
        if (!organizationId) next.organization_id = "Organization is required.";
        else if (!isUuid(organizationId)) next.organization_id = "Invalid organization id.";

        if (!category?.id) next.category_id = "Category is required.";
        else if (!isUuid(category.id)) next.category_id = "Invalid category id.";

        if (!locationSel?.id) next.location_id = "Location is required.";
        else if (!isUuid(locationSel.id)) next.location_id = "Invalid location id.";

        if (!assetName.trim()) next.asset_name = "Asset name is required.";
        if (!assetCode.trim()) next.asset_code = "Asset code is required.";

        if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100)
          next.health_score = "Health score must be between 0 and 100.";

        if (installationDate.trim() && !isDateOnly(installationDate.trim()))
          next.installation_date = "Invalid date format.";
        if (warrantyExpiry.trim() && !isDateOnly(warrantyExpiry.trim()))
          next.warranty_expiry = "Invalid date format.";

        if (Object.keys(next).length) {
          setFieldErrors(next);
          return;
        }

        setFieldErrors({});
        setPending(true);
        try {
          await apiFetch(`/api/v1/plenum/assets/${encodeURIComponent(assetId)}`, {
            method: "PUT",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: {
              organization_id: organizationId,
              location_id: locationSel?.id ?? null,
              category_id: category?.id ?? null,
              asset_name: assetName.trim(),
              asset_code: assetCode.trim(),
              serial_number: serialNumber.trim() || undefined,
              manufacturer: manufacturer.trim() || undefined,
              model_number: modelNumber.trim() || undefined,
              installation_date: installationDate.trim() || undefined,
              warranty_expiry: warrantyExpiry.trim() || undefined,
              status,
              health_score: healthScore,
              qr_code: qrCode || undefined,
            },
          });
          router.push(`${APP_ROUTES.assets}/${assetId}`);
        } catch (err) {
          if (err instanceof ApiError) {
            const fe = extractFieldErrorsFromPayload(err.payload);
            if (fe) {
              const msg = fe._;
              const { _, ...rest } = fe as Record<string, string>;
              if (Object.keys(rest).length) setFieldErrors(rest);
              if (msg) setSubmitError(msg);
              if (!msg && Object.keys(rest).length === 0) setSubmitError(err.message);
            } else {
              setSubmitError(err.message);
            }
          } else if (err instanceof Error) {
            setSubmitError(err.message || "Something went wrong");
          } else {
            setSubmitError("Something went wrong");
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <Card className="w-full">
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <CardTitle>Edit Asset</CardTitle>
            <p className="text-sm text-muted-foreground">{assetCode}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization</label>
              <div className="h-10 flex items-center rounded-md border border-input px-3 text-sm bg-muted/40">
                <span className="truncate">{orgLabel}</span>
              </div>
              {fieldErrors.organization_id ? (
                <p className="text-xs text-destructive">{fieldErrors.organization_id}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setCategoryOpen((v) => !v)}
                  disabled={!organizationId}
                >
                  <span className="truncate">{category?.label ?? "Select category"}</span>
                </Button>
                <InfiniteSelect
                  open={categoryOpen}
                  onClose={() => setCategoryOpen(false)}
                  onSelect={(item) => setCategory(item)}
                  valueLabel={category?.label ?? ""}
                  placeholder="Search categories..."
                  pageSize={10}
                  cacheKey={organizationId ? `categories:${organizationId}` : undefined}
                  cacheTTL={90_000}
                  fetchPage={({ limit, offset, signal }) =>
                    fetchCategoriesPage({ organizationId, limit, offset, signal })
                  }
                />
              </div>
              {fieldErrors.category_id ? (
                <p className="text-xs text-destructive">{fieldErrors.category_id}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Location</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setLocationOpen((v) => !v)}
                  disabled={!organizationId}
                >
                  <span className="truncate">{locationSel?.label ?? "Select location"}</span>
                </Button>
                <InfiniteSelect
                  open={locationOpen}
                  onClose={() => setLocationOpen(false)}
                  onSelect={(item) => setLocationSel(item)}
                  valueLabel={locationSel?.label ?? ""}
                  placeholder="Search locations..."
                  pageSize={10}
                  cacheKey={organizationId ? `locations:${organizationId}` : undefined}
                  cacheTTL={90_000}
                  fetchPage={({ limit, offset, signal }) =>
                    fetchLocationsPage({ organizationId, limit, offset, signal })
                  }
                />
              </div>
              {fieldErrors.location_id ? (
                <p className="text-xs text-destructive">{fieldErrors.location_id}</p>
              ) : null}
            </div>

            <div className="space-y-2 lg:col-span-3">
              <label className="text-sm font-medium">Asset Name</label>
              <Input value={assetName} onChange={(e) => setAssetName(e.target.value)} required />
              {fieldErrors.asset_name ? (
                <p className="text-xs text-destructive">{fieldErrors.asset_name}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Asset Code</label>
              <Input value={assetCode} onChange={(e) => setAssetCode(e.target.value)} required />
              {fieldErrors.asset_code ? (
                <p className="text-xs text-destructive">{fieldErrors.asset_code}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Serial Number</label>
              <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Manufacturer</label>
              <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Model Number</label>
              <Input value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Installation Date</label>
              <Input
                type="date"
                value={installationDate}
                onChange={(e) => setInstallationDate(e.target.value)}
              />
              {fieldErrors.installation_date ? (
                <p className="text-xs text-destructive">{fieldErrors.installation_date}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Warranty Expiry</label>
              <Input
                type="date"
                value={warrantyExpiry}
                onChange={(e) => setWarrantyExpiry(e.target.value)}
              />
              {fieldErrors.warranty_expiry ? (
                <p className="text-xs text-destructive">{fieldErrors.warranty_expiry}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={selectClassName}
              >
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Health Score</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={Number.isFinite(healthScore) ? String(healthScore) : ""}
                onChange={(e) => setHealthScore(Number(e.target.value || "0"))}
                required
              />
              {fieldErrors.health_score ? (
                <p className="text-xs text-destructive">{fieldErrors.health_score}</p>
              ) : null}
            </div>

            <div className="space-y-2 lg:col-span-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">QR Code</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQrCode(generateQrCodeValue())}
                  disabled={pending}
                >
                  Generate QR Code
                </Button>
              </div>
              {qrCode ? (
                <div className="inline-block rounded-md border border-input bg-white p-4">
                  <QRCode value={qrCode} size={128} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No QR code generated yet.</p>
              )}
            </div>
          </div>

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

          <div className="flex items-center gap-2 justify-end">
            <Button asChild variant="secondary" disabled={pending}>
              <Link href={`${APP_ROUTES.assets}/${assetId}`}>Cancel</Link>
            </Button>
            <Button disabled={disableSubmit} type="submit">
              {pending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
