import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

export type PmFrequency = "weekly" | "monthly" | "quarterly" | "yearly";
export type PmStatus = "active" | "paused";

export type PreventiveMaintenance = {
  id: string;
  name: string;
  code: string;
  asset?: string;
  location?: string;
  frequency: PmFrequency;
  nextDue?: string;
  status: PmStatus;
  createdAt: string;
};

type PmStore = { items: PreventiveMaintenance[] };

export function getPmStore(): PmStore {
  const g = globalThis as unknown as { __cafmPmStore?: PmStore };
  if (!g.__cafmPmStore) {
    g.__cafmPmStore = {
      items: [
        {
          id: "pm_001",
          name: "HVAC Monthly Inspection",
          code: "PM-0001",
          asset: "HVAC-A-301",
          location: "Building A - Floor 3",
          frequency: "monthly",
          nextDue: "2026-04-01",
          status: "active",
          createdAt: new Date().toISOString(),
        },
        {
          id: "pm_002",
          name: "Generator Quarterly Test Run",
          code: "PM-0002",
          asset: "GEN-C-501",
          location: "Building C - Basement",
          frequency: "quarterly",
          nextDue: "2026-06-01",
          status: "active",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return g.__cafmPmStore;
}

export async function requireUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value ?? "";
  const user = token ? decodeDemoToken(token) : null;
  if (!user) return null;
  return user;
}
