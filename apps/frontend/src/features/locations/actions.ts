"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { apiFetchInternal } from "@/services/api/internal.server";

import type { Location, LocationType } from "./types";

function isValidType(value: string): value is LocationType {
  return (
    value === "building" ||
    value === "floor" ||
    value === "area" ||
    value === "room" ||
    value === "zone"
  );
}

export type CreateLocationState = { error?: string };

export async function createLocationAction(
  _: CreateLocationState,
  formData: FormData,
): Promise<CreateLocationState> {
  const name = String(formData.get("name") ?? "").trim();
  const typeRaw = String(formData.get("type") ?? "").trim();
  const parent = String(formData.get("parent") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();

  const type: LocationType = isValidType(typeRaw) ? typeRaw : "area";

  if (!name) return { error: "Location name required." };

  await apiFetchInternal<{ location: Location }>("/api/locations", {
    method: "POST",
    body: { name, type, parent: parent || undefined, code: code || undefined },
  });

  revalidatePath(APP_ROUTES.locations);
  return {};
}

export async function deleteLocationAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await apiFetchInternal(`/api/locations/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath(APP_ROUTES.locations);
}

export type UpdateLocationState = { error?: string };

export async function updateLocationAction(
  _: UpdateLocationState,
  formData: FormData,
): Promise<UpdateLocationState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const typeRaw = String(formData.get("type") ?? "").trim();
  const parent = String(formData.get("parent") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();

  const type: LocationType = isValidType(typeRaw) ? typeRaw : "area";

  if (!id) return { error: "Missing id." };
  if (!name) return { error: "Location name required." };

  await apiFetchInternal<{ location: Location }>(`/api/locations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { name, type, parent: parent || undefined, code: code || undefined },
  });

  revalidatePath(APP_ROUTES.locations);
  redirect(APP_ROUTES.locations);
}
