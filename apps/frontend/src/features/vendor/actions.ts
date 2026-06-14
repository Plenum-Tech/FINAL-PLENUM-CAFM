"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { apiFetchInternal } from "@/services/api/internal.server";

import type { Vendor } from "./types";

export type CreateVendorState = { error?: string };

export async function createVendorAction(
  _: CreateVendorState,
  formData: FormData,
): Promise<CreateVendorState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!name) return { error: "Vendor name required." };

  await apiFetchInternal<{ vendor: Vendor }>("/api/vendors", {
    method: "POST",
    body: {
      name,
      email: email || undefined,
      phone: phone || undefined,
    },
  });

  revalidatePath(APP_ROUTES.vendors);
  return {};
}

export async function deleteVendorAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await apiFetchInternal(`/api/vendors/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath(APP_ROUTES.vendors);
}

export type UpdateVendorState = { error?: string };

export async function updateVendorAction(
  _: UpdateVendorState,
  formData: FormData,
): Promise<UpdateVendorState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!id) return { error: "Missing id." };
  if (!name) return { error: "Vendor name required." };

  await apiFetchInternal<{ vendor: Vendor }>(`/api/vendors/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { name, email: email || undefined, phone: phone || undefined },
  });

  revalidatePath(APP_ROUTES.vendors);
  redirect(APP_ROUTES.vendors);
}
