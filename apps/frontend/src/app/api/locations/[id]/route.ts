import { NextResponse, type NextRequest } from "next/server";

import { getLocationStore, requireUser, type Location, type LocationType } from "../store";

function isValidType(value: unknown): value is LocationType {
  return (
    value === "building" ||
    value === "floor" ||
    value === "area" ||
    value === "room" ||
    value === "zone"
  );
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getLocationStore();
  const location = store.locations.find((l) => l.id === id);
  if (!location) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return NextResponse.json({ location });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    type?: unknown;
    parent?: unknown;
    code?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const type = body?.type !== undefined && isValidType(body.type) ? body.type : undefined;
  const parent = typeof body?.parent === "string" ? body.parent.trim() : undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : undefined;

  const store = getLocationStore();
  const idx = store.locations.findIndex((l) => l.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const current = store.locations[idx];
  const updated: Location = {
    ...current,
    name: name !== undefined ? name : current.name,
    type: type !== undefined ? type : current.type,
    parent: parent !== undefined ? parent || undefined : current.parent,
    code: code !== undefined ? code || undefined : current.code,
  };

  if (!updated.name.trim())
    return NextResponse.json({ message: "Location name required." }, { status: 400 });

  store.locations = [...store.locations.slice(0, idx), updated, ...store.locations.slice(idx + 1)];
  return NextResponse.json({ location: updated });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getLocationStore();
  const idx = store.locations.findIndex((l) => l.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  store.locations = [...store.locations.slice(0, idx), ...store.locations.slice(idx + 1)];
  return NextResponse.json({ ok: true });
}
