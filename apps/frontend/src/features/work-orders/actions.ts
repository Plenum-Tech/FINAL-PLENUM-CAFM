"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { apiFetchInternal } from "@/services/api/internal.server";

import type { WorkOrder, WorkOrderPriority, WorkOrderStatus } from "./types";

function isValidPriority(value: string): value is WorkOrderPriority {
  return value === "low" || value === "medium" || value === "high";
}

function isValidStatus(value: string): value is WorkOrderStatus {
  return (
    value === "open" || value === "in_progress" || value === "on_hold" || value === "completed"
  );
}

export type CreateWorkOrderState = { error?: string };

export async function createWorkOrderAction(
  _: CreateWorkOrderState,
  formData: FormData,
): Promise<CreateWorkOrderState> {
  const title = String(formData.get("title") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const asset = String(formData.get("asset") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();
  const assignedTo = String(formData.get("assignedTo") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();

  const priority: WorkOrderPriority = isValidPriority(priorityRaw) ? priorityRaw : "medium";
  const status: WorkOrderStatus = isValidStatus(statusRaw) ? statusRaw : "open";

  if (!title) return { error: "Work order title required." };
  if (!code) return { error: "Work order code required." };

  await apiFetchInternal<{ workOrder: WorkOrder }>("/api/work-orders", {
    method: "POST",
    body: {
      title,
      code,
      asset: asset || undefined,
      location: location || undefined,
      priority,
      status,
      assignedTo: assignedTo || undefined,
      dueDate: dueDate || undefined,
    },
  });

  revalidatePath(APP_ROUTES.workOrders);
  return {};
}

export async function deleteWorkOrderAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await apiFetchInternal(`/api/work-orders/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath(APP_ROUTES.workOrders);
}

export type UpdateWorkOrderState = { error?: string };

export async function updateWorkOrderAction(
  _: UpdateWorkOrderState,
  formData: FormData,
): Promise<UpdateWorkOrderState> {
  const id = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const asset = String(formData.get("asset") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "").trim();
  const assignedTo = String(formData.get("assignedTo") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();

  const priority: WorkOrderPriority = isValidPriority(priorityRaw) ? priorityRaw : "medium";
  const status: WorkOrderStatus = isValidStatus(statusRaw) ? statusRaw : "open";

  if (!id) return { error: "Missing id." };
  if (!title) return { error: "Work order title required." };
  if (!code) return { error: "Work order code required." };

  await apiFetchInternal<{ workOrder: WorkOrder }>(`/api/work-orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      title,
      code,
      asset: asset || undefined,
      location: location || undefined,
      priority,
      status,
      assignedTo: assignedTo || undefined,
      dueDate: dueDate || undefined,
    },
  });

  revalidatePath(APP_ROUTES.workOrders);
  redirect(APP_ROUTES.workOrdersNew);
}
