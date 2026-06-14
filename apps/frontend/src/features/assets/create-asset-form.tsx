"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardTitle, Input } from "@/components";
import { APP_ROUTES } from "@/constants";
import { apiFetch, ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import QRCode from "react-qr-code";
 

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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

type FastApiValidationIssue = {
  loc: Array<string | number>;
  msg: string;
  type?: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
};

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
  const payload = await apiFetch<unknown>(`/api/v1/plenum/locations?${params.toString()}`, {
    signal,
  });
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

export function CreateAssetForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [localFieldErrors, setLocalFieldErrors] = useState<Record<string, string>>({});

  const selectedOrg = useOrganizationStore((s) => s.selected);
  const organizationId = selectedOrg?.id ?? "";
  const organizationName = selectedOrg?.name ?? "";

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [category, setCategory] = useState<InfiniteSelectItem | null>(null);
  const [locationSel, setLocationSel] = useState<InfiniteSelectItem | null>(null);
  const [qrCode, setQrCode] = useState<string>("");

  // Reset category/location when organization changes to avoid stale selection
  useEffect(() => {
    setCategory(null);
    setLocationSel(null);
    setQrCode("");
  }, [organizationId]);

  const fieldErrors = useMemo(() => {
    return { ...localFieldErrors };
  }, [localFieldErrors]);

  return (
    <form
      className="w-full"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setSubmitError(null);

        const fd = new FormData(e.currentTarget);

        const next: Record<string, string> = {};
        const orgId = String(fd.get("organization_id") ?? "").trim();
        const locId = String(fd.get("location_id") ?? "").trim();
        const catId = String(fd.get("category_id") ?? "").trim();
        const assetName = String(fd.get("asset_name") ?? "").trim();
        const assetCode = String(fd.get("asset_code") ?? "").trim();
        const serialNumber = String(fd.get("serial_number") ?? "").trim();
        const manufacturer = String(fd.get("manufacturer") ?? "").trim();
        const modelNumber = String(fd.get("model_number") ?? "").trim();
        const installationDate = String(fd.get("installation_date") ?? "").trim();
        const warrantyExpiry = String(fd.get("warranty_expiry") ?? "").trim();
        const status = String(fd.get("status") ?? "").trim() || "active";
        const healthScore = Number(String(fd.get("health_score") ?? "").trim() || "NaN");
        const qrCode = String(fd.get("qr_code") ?? "").trim();

        if (!orgId) next.organization_id = "Organization is required.";
        else if (!isUuid(orgId)) next.organization_id = "Invalid organization id.";

        if (!locId) next.location_id = "Location is required.";
        else if (!isUuid(locId)) next.location_id = "Invalid location id.";

        if (!catId) next.category_id = "Category is required.";
        else if (!isUuid(catId)) next.category_id = "Invalid category id.";

        if (!assetName) next.asset_name = "Asset name is required.";
        if (!assetCode) next.asset_code = "Asset code is required.";

        if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100)
          next.health_score = "Health score must be between 0 and 100.";

        if (installationDate && !isDateOnly(installationDate))
          next.installation_date = "Invalid date format.";
        if (warrantyExpiry && !isDateOnly(warrantyExpiry)) next.warranty_expiry = "Invalid date format.";

        if (Object.keys(next).length) {
          setLocalFieldErrors(next);
          return;
        }

        setLocalFieldErrors({});
        setPending(true);
        try {
          await apiFetch("/api/v1/plenum/assets", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: {
              organization_id: orgId,
              location_id: locId,
              category_id: catId,
              asset_name: assetName,
              asset_code: assetCode,
              serial_number: serialNumber || undefined,
              manufacturer: manufacturer || undefined,
              model_number: modelNumber || undefined,
              installation_date: installationDate || undefined,
              warranty_expiry: warrantyExpiry || undefined,
              status,
              health_score: healthScore,
              qr_code: qrCode || undefined,
            },
          });
          router.push(APP_ROUTES.assets);
        } catch (err) {
          if (err instanceof ApiError) {
            const fe = extractFieldErrorsFromPayload(err.payload);
            if (fe) {
              const msg = fe._;
              const { _, ...rest } = fe as Record<string, string>;
              if (Object.keys(rest).length) setLocalFieldErrors(rest);
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
      <Card className="w-full py-6">
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <CardTitle>New Asset</CardTitle>
            <p className="text-sm text-muted-foreground">Create an asset entry for CAFM modules.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization</label>
              <input type="hidden" name="organization_id" value={organizationId} />
              <div className="h-10 flex items-center rounded-md border border-input px-3 text-sm bg-muted/40">
                <span className="truncate">
                  {organizationName || "No organization selected (choose from header)"}
                </span>
              </div>

              {fieldErrors.organization_id ? (
                <p className="text-xs text-destructive">{fieldErrors.organization_id}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <input type="hidden" name="category_id" value={category?.id ?? ""} />
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
              <input type="hidden" name="location_id" value={locationSel?.id ?? ""} />
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
              <Input name="asset_name" placeholder="HVAC Unit - Main Hall" required />
              {fieldErrors.asset_name ? (
                <p className="text-xs text-destructive">{fieldErrors.asset_name}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Asset Code</label>
              <Input name="asset_code" placeholder="HVAC-A-301" required />
              {fieldErrors.asset_code ? (
                <p className="text-xs text-destructive">{fieldErrors.asset_code}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Serial Number</label>
              <Input name="serial_number" placeholder="SN-001234" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Manufacturer</label>
              <Input name="manufacturer" placeholder="e.g. Carrier" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Model Number</label>
              <Input name="model_number" placeholder="e.g. ABC-100" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Installation Date</label>
              <Input name="installation_date" type="date" />
              {fieldErrors.installation_date ? (
                <p className="text-xs text-destructive">{fieldErrors.installation_date}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Warranty Expiry</label>
              <Input name="warranty_expiry" type="date" />
              {fieldErrors.warranty_expiry ? (
                <p className="text-xs text-destructive">{fieldErrors.warranty_expiry}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <div>

              <select name="status" defaultValue="active" className={selectClassName}>
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Health Score</label>
              <Input
                name="health_score"
                type="number"
                min={0}
                max={100}
                defaultValue={80}
                required
              />
              {fieldErrors.health_score ? (
                <p className="text-xs text-destructive">{fieldErrors.health_score}</p>
              ) : null}
            </div>

            <div className="space-y-2 lg:col-span-3">
              <div className="flex items-center justify-between-e">
                {/* <label className="text-sm font-medium">QR Code</label> */}
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
                <>
                  <input type="hidden" name="qr_code" value={qrCode} />
                  <div className="inline-block rounded-md border border-input bg-white p-4">
                    <QRCode value={qrCode} size={128} />
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild variant="secondary" disabled={pending}>
              <Link href={APP_ROUTES.assets}>Cancel</Link>
            </Button>
            <Button disabled={pending || !organizationId} type="submit" className="sm:min-w-40">
              {pending ? "Saving..." : "Create Asset"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
