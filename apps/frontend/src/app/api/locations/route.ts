import { NextResponse } from "next/server";

import { getLocationStore, requireUser, type Location, type LocationType } from "./store";

function isValidType(value: unknown): value is LocationType {
  return (
    value === "building" ||
    value === "floor" ||
    value === "area" ||
    value === "room" ||
    value === "zone"
  );
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const store = getLocationStore();
  return NextResponse.json({ locations: store.locations });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    type?: unknown;
    parent?: unknown;
    code?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = isValidType(body?.type) ? body.type : ("area" satisfies LocationType);
  const parent = typeof body?.parent === "string" ? body.parent.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!name) return NextResponse.json({ message: "Location name required." }, { status: 400 });

  const store = getLocationStore();
  const location: Location = {
    id: `loc_${Math.random().toString(16).slice(2, 10)}`,
    name,
    type,
    parent: parent || undefined,
    code: code || undefined,
    createdAt: new Date().toISOString(),
  };

  store.locations = [location, ...store.locations];
  return NextResponse.json({ location }, { status: 201 });
}
