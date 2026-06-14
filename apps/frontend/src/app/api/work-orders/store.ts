import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

export type WorkOrderPriority = "low" | "medium" | "high";
export type WorkOrderStatus = "open" | "in_progress" | "on_hold" | "completed";

export type WorkOrder = {
  id: string;
  title: string;
  code: string;
  asset?: string;
  location?: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assignedTo?: string;
  dueDate?: string;
  createdAt: string;
};

type WorkOrderStore = { workOrders: WorkOrder[] };

export function getWorkOrderStore(): WorkOrderStore {
  const g = globalThis as unknown as { __cafmWorkOrderStore?: WorkOrderStore };
  if (!g.__cafmWorkOrderStore) {
    g.__cafmWorkOrderStore = {
      workOrders: [
        {
          id: "wo_001",
          title: "Inspect HVAC vibration",
          code: "WO-0001",
          asset: "HVAC-A-301",
          location: "Building A - Floor 3",
          priority: "high",
          status: "open",
          assignedTo: "Ali Raza",
          dueDate: "2026-03-22",
          createdAt: new Date().toISOString(),
        },
        {
          id: "wo_002",
          title: "Replace parking light fixtures",
          code: "WO-0002",
          asset: "LIGHT-01",
          location: "Parking Level 1",
          priority: "medium",
          status: "in_progress",
          assignedTo: "Sara Khan",
          dueDate: "2026-03-28",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return g.__cafmWorkOrderStore;
}

export async function requireUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value ?? "";
  const user = token ? decodeDemoToken(token) : null;
  if (!user) return null;
  return user;
}
