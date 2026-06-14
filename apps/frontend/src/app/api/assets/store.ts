import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

export type AssetStatus = "active" | "maintenance" | "warning" | "critical";

export type Asset = {
  id: string;
  name: string;
  code: string;
  category: string;
  location: string;
  healthScore: number;
  status: AssetStatus;
  warrantyExpiry?: string;
  lastMaintenance?: string;
  createdAt: string;
};

type AssetStore = {
  assets: Asset[];
};

export function getAssetStore(): AssetStore {
  const g = globalThis as unknown as { __cafmAssetStore?: AssetStore };
  if (!g.__cafmAssetStore) {
    g.__cafmAssetStore = {
      assets: [
        {
          id: "ast_001",
          name: "HVAC Unit - Main Hall",
          code: "HVAC-A-301",
          category: "HVAC",
          location: "Building A - Floor 3",
          healthScore: 92,
          status: "active",
          warrantyExpiry: "2025-12-15",
          lastMaintenance: "2026-02-28",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ast_002",
          name: "Elevator #1",
          code: "ELV-B-01",
          category: "Elevator",
          location: "Building B - Main",
          healthScore: 78,
          status: "maintenance",
          warrantyExpiry: "2024-08-20",
          lastMaintenance: "2026-03-05",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ast_003",
          name: "Generator - Backup",
          code: "GEN-C-501",
          category: "Generator",
          location: "Building C - Basement",
          healthScore: 85,
          status: "active",
          warrantyExpiry: "2026-06-30",
          lastMaintenance: "2026-03-01",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ast_004",
          name: "Chiller System",
          code: "CHLL-A-801",
          category: "HVAC",
          location: "Building A - Roof",
          healthScore: 45,
          status: "warning",
          warrantyExpiry: "2025-03-15",
          lastMaintenance: "2026-01-20",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ast_005",
          name: "Fire Suppression System",
          code: "FIRE-B-201",
          category: "Safety",
          location: "Building B - Floor 2",
          healthScore: 95,
          status: "active",
          warrantyExpiry: "2027-11-10",
          lastMaintenance: "2026-03-10",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ast_006",
          name: "Boiler Unit",
          code: "BOL-A-801",
          category: "HVAC",
          location: "Building A - Basement",
          healthScore: 62,
          status: "warning",
          warrantyExpiry: "2025-03-05",
          lastMaintenance: "2026-02-15",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ast_007",
          name: "Lighting System - Parking",
          code: "LIGHT-01",
          category: "Electrical",
          location: "Parking Level 1",
          healthScore: 88,
          status: "active",
          warrantyExpiry: "2026-04-20",
          lastMaintenance: "2026-03-08",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ast_008",
          name: "Water Pump - Main",
          code: "PUMP-A-101",
          category: "Plumbing",
          location: "Building A - Basement",
          healthScore: 38,
          status: "critical",
          warrantyExpiry: "2024-12-01",
          lastMaintenance: "2026-02-20",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return g.__cafmAssetStore;
}

export async function requireUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value ?? "";
  const user = token ? decodeDemoToken(token) : null;
  if (!user) return null;
  return user;
}
