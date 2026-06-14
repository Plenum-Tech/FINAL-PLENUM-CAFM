import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

export type LocationType = "building" | "floor" | "area" | "room" | "zone";

export type Location = {
  id: string;
  name: string;
  type: LocationType;
  parent?: string;
  code?: string;
  createdAt: string;
};

type LocationStore = { locations: Location[] };

export function getLocationStore(): LocationStore {
  const g = globalThis as unknown as { __cafmLocationStore?: LocationStore };
  if (!g.__cafmLocationStore) {
    g.__cafmLocationStore = {
      locations: [
        {
          id: "loc_001",
          name: "Building A",
          type: "building",
          code: "BLD-A",
          createdAt: new Date().toISOString(),
        },
        {
          id: "loc_002",
          name: "Building A - Floor 3",
          type: "floor",
          parent: "Building A",
          code: "BLD-A-F3",
          createdAt: new Date().toISOString(),
        },
        {
          id: "loc_003",
          name: "Building B",
          type: "building",
          code: "BLD-B",
          createdAt: new Date().toISOString(),
        },
        {
          id: "loc_004",
          name: "Parking Level 1",
          type: "area",
          parent: "Building B",
          code: "BLD-B-P1",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return g.__cafmLocationStore;
}

export async function requireUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value ?? "";
  const user = token ? decodeDemoToken(token) : null;
  if (!user) return null;
  return user;
}
