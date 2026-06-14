"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { apiFetchInternal } from "@/services/api/internal.server";

import type { PmFrequency, PmStatus, PreventiveMaintenance } from "./types";

function isValidFrequency(value: string): value is PmFrequency {
  return value === "weekly" || value === "monthly" || value === "quarterly" || value === "yearly";
}

function isValidStatus(value: string): value is PmStatus {
  return value === "active" || value === "paused";
}

export type CreatePmState = { error?: string };

export async function createPmAction(_: CreatePmState, formData: FormData): Promise<CreatePmState> {
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const asset = String(formData.get("asset") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const frequencyRaw = String(formData.get("frequency") ?? "").trim();
  const nextDue = String(formData.get("nextDue") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();

  const frequency: PmFrequency = isValidFrequency(frequencyRaw) ? frequencyRaw : "monthly";
  const status: PmStatus = isValidStatus(statusRaw) ? statusRaw : "active";

  if (!name) return { error: "PM name required." };
  if (!code) return { error: "PM code required." };

  await apiFetchInternal<{ item: PreventiveMaintenance }>("/api/preventive-maintenance", {
    method: "POST",
    body: {
      name,
      code,
      asset: asset || undefined,
      location: location || undefined,
      frequency,
      nextDue: nextDue || undefined,
      status,
    },
  });

  revalidatePath(APP_ROUTES.preventiveMaintenance);
  return {};
}

export async function deletePmAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await apiFetchInternal(`/api/preventive-maintenance/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  revalidatePath(APP_ROUTES.preventiveMaintenance);
}

export type UpdatePmState = { error?: string };

export async function updatePmAction(_: UpdatePmState, formData: FormData): Promise<UpdatePmState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const asset = String(formData.get("asset") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const frequencyRaw = String(formData.get("frequency") ?? "").trim();
  const nextDue = String(formData.get("nextDue") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();

  const frequency: PmFrequency = isValidFrequency(frequencyRaw) ? frequencyRaw : "monthly";
  const status: PmStatus = isValidStatus(statusRaw) ? statusRaw : "active";

  if (!id) return { error: "Missing id." };
  if (!name) return { error: "PM name required." };
  if (!code) return { error: "PM code required." };

  await apiFetchInternal<{ item: PreventiveMaintenance }>(
    `/api/preventive-maintenance/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: {
        name,
        code,
        asset: asset || undefined,
        location: location || undefined,
        frequency,
        nextDue: nextDue || undefined,
        status,
      },
    },
  );

  revalidatePath(APP_ROUTES.preventiveMaintenance);
  redirect(APP_ROUTES.preventiveMaintenance);
}
