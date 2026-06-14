"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { apiFetchInternal } from "@/services/api/internal.server";
import { apiFetchServer } from "@/services/api/server";
import { ApiError } from "@/services/api";

import type { Asset, AssetStatus } from "./types";

export type CreateAssetState = { error?: string; fieldErrors?: Record<string, string> };

function isValidStatus(value: string): value is AssetStatus {
  return (
    value === "active" || value === "maintenance" || value === "warning" || value === "critical"
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function extractFastApiFieldErrors(payload: unknown): Record<string, string> | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const obj = payload as Record<string, unknown>;
  if (!("detail" in obj) || !Array.isArray(obj.detail)) return undefined;

  const out: Record<string, string> = {};
  for (const item of obj.detail) {
    if (typeof item !== "object" || item === null) continue;
    const it = item as Record<string, unknown>;
    if (!Array.isArray(it.loc) || typeof it.msg !== "string") continue;
    const key = [...it.loc].reverse().find((x) => typeof x === "string" && x.trim());
    if (typeof key === "string" && key.trim()) out[key] = it.msg;
  }
  return Object.keys(out).length ? out : undefined;
}

function extractFastApiMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const obj = payload as Record<string, unknown>;
  if ("detail" in obj) {
    if (typeof obj.detail === "string" && obj.detail.trim()) return obj.detail;
    if (Array.isArray(obj.detail) && obj.detail.length > 0) {
      const first = obj.detail[0];
      if (typeof first === "object" && first !== null) {
        const f = first as Record<string, unknown>;
        if (typeof f.msg === "string" && f.msg.trim()) return f.msg;
      }
    }
  }
  if ("message" in obj && typeof obj.message === "string" && obj.message.trim()) return obj.message;
  return undefined;
}

export async function createAssetAction(
  _: CreateAssetState,
  formData: FormData,
): Promise<CreateAssetState> {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const assetName = String(formData.get("asset_name") ?? "").trim();
  const assetCode = String(formData.get("asset_code") ?? "").trim();
  const serialNumber = String(formData.get("serial_number") ?? "").trim();
  const manufacturer = String(formData.get("manufacturer") ?? "").trim();
  const modelNumber = String(formData.get("model_number") ?? "").trim();
  const installationDate = String(formData.get("installation_date") ?? "").trim();
  const warrantyExpiry = String(formData.get("warranty_expiry") ?? "").trim();
  const qrCode = String(formData.get("qr_code") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();
  const healthScoreRaw = String(formData.get("health_score") ?? "").trim();

  const status: AssetStatus = isValidStatus(statusRaw) ? statusRaw : "active";
  const healthScore = Number(healthScoreRaw || "0");

  const fieldErrors: Record<string, string> = {};
  if (!organizationId) fieldErrors.organization_id = "Organization is required.";
  else if (!isUuid(organizationId)) fieldErrors.organization_id = "Invalid organization id.";

  if (!locationId) fieldErrors.location_id = "Location is required.";
  else if (!isUuid(locationId)) fieldErrors.location_id = "Invalid location id.";

  if (!categoryId) fieldErrors.category_id = "Category is required.";
  else if (!isUuid(categoryId)) fieldErrors.category_id = "Invalid category id.";

  if (!assetName) fieldErrors.asset_name = "Asset name is required.";
  if (!assetCode) fieldErrors.asset_code = "Asset code is required.";

  if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100)
    fieldErrors.health_score = "Health score must be between 0 and 100.";

  if (installationDate && !isDateOnly(installationDate))
    fieldErrors.installation_date = "Invalid date format.";
  if (warrantyExpiry && !isDateOnly(warrantyExpiry)) fieldErrors.warranty_expiry = "Invalid date format.";

  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors };

  try {
    await apiFetchServer<unknown>("/api/v1/plenum/assets", {
      method: "POST",
      body: {
        organization_id: organizationId,
        location_id: locationId,
        category_id: categoryId,
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
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(APP_ROUTES.login);
    if (e instanceof ApiError) {
      const serverFieldErrors = extractFastApiFieldErrors(e.payload);
      const msg = extractFastApiMessage(e.payload) ?? e.message;
      return { error: msg, fieldErrors: serverFieldErrors };
    }
    if (e instanceof Error) return { error: e.message || "Something went wrong" };
    return { error: "Something went wrong" };
  }

  revalidatePath(APP_ROUTES.assets);
  redirect(APP_ROUTES.assets);
}

export type UpdateAssetState = { error?: string };

export async function updateAssetAction(
  _: UpdateAssetState,
  formData: FormData,
): Promise<UpdateAssetState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();
  const healthScoreRaw = String(formData.get("healthScore") ?? "").trim();
  const warrantyExpiry = String(formData.get("warrantyExpiry") ?? "").trim();
  const lastMaintenance = String(formData.get("lastMaintenance") ?? "").trim();

  const status: AssetStatus = isValidStatus(statusRaw) ? statusRaw : "active";
  const healthScore = Number(healthScoreRaw || "0");

  if (!id) return { error: "Missing id." };
  if (!name) return { error: "Asset name required." };
  if (!code) return { error: "Asset code required." };
  if (!category) return { error: "Category required." };
  if (!location) return { error: "Location required." };
  if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100)
    return { error: "Health score must be between 0 and 100." };

  await apiFetchInternal<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      name,
      code,
      category,
      location,
      status,
      healthScore,
      warrantyExpiry: warrantyExpiry || undefined,
      lastMaintenance: lastMaintenance || undefined,
    },
  });

  revalidatePath(APP_ROUTES.assets);
  revalidatePath(`${APP_ROUTES.assets}/${id}`);
  redirect(`${APP_ROUTES.assets}/${id}`);
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await apiFetchInternal(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath(APP_ROUTES.assets);
  redirect(APP_ROUTES.assets);
}
