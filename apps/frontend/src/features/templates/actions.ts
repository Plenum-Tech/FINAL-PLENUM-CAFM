"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { apiFetchInternal } from "@/services/api/internal.server";

import type { Template } from "./types";

export type CreateTemplateState = { error?: string };

export async function createTemplateAction(
  _: CreateTemplateState,
  formData: FormData,
): Promise<CreateTemplateState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) return { error: "Template name required." };

  await apiFetchInternal<{ template: Template }>("/api/templates", {
    method: "POST",
    body: { name, description: description || undefined },
  });

  revalidatePath(APP_ROUTES.templates);
  return {};
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await apiFetchInternal(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath(APP_ROUTES.templates);
}

export type UpdateTemplateState = { error?: string };

export async function updateTemplateAction(
  _: UpdateTemplateState,
  formData: FormData,
): Promise<UpdateTemplateState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!id) return { error: "Missing id." };
  if (!name) return { error: "Template name required." };

  await apiFetchInternal<{ template: Template }>(`/api/templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { name, description: description || undefined },
  });

  revalidatePath(APP_ROUTES.templates);
  redirect(APP_ROUTES.templates);
}
