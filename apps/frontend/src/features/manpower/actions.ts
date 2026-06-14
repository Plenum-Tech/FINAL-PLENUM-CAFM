"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { apiFetchInternal } from "@/services/api/internal.server";

import type { Manpower } from "./types";

export type CreateManpowerState = { error?: string };

export async function createManpowerAction(
  _: CreateManpowerState,
  formData: FormData,
): Promise<CreateManpowerState> {
  const name = String(formData.get("name") ?? "").trim();
  const designation = String(formData.get("designation") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!name) return { error: "Name required." };

  await apiFetchInternal<{ manpower: Manpower }>("/api/manpower", {
    method: "POST",
    body: {
      name,
      designation: designation || undefined,
      email: email || undefined,
      phone: phone || undefined,
    },
  });

  revalidatePath(APP_ROUTES.manpower);
  return {};
}

export async function deleteManpowerAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await apiFetchInternal(`/api/manpower/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath(APP_ROUTES.manpower);
}

export type UpdateManpowerState = { error?: string };

export async function updateManpowerAction(
  _: UpdateManpowerState,
  formData: FormData,
): Promise<UpdateManpowerState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const designation = String(formData.get("designation") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!id) return { error: "Missing id." };
  if (!name) return { error: "Name required." };

  await apiFetchInternal<{ manpower: Manpower }>(`/api/manpower/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      name,
      designation: designation || undefined,
      email: email || undefined,
      phone: phone || undefined,
    },
  });

  revalidatePath(APP_ROUTES.manpower);
  redirect(APP_ROUTES.manpower);
}
