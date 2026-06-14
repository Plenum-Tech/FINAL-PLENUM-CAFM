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
