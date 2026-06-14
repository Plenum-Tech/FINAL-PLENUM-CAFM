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
