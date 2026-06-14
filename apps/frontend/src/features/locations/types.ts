export type LocationType = "building" | "floor" | "area" | "room" | "zone";

export type PlenumLocation = {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  code?: string | null;
  parent?: string | null;
  parent_location_id: string | null;
  level: number | null;
  created_at?: string;
  updated_at?: string;
};

export type Location = PlenumLocation;
