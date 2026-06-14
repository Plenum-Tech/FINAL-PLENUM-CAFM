import { NextResponse, type NextRequest } from "next/server";

import {
  getPmStore,
  requireUser,
  type PmFrequency,
  type PmStatus,
  type PreventiveMaintenance,
} from "../store";

function isValidFrequency(value: unknown): value is PmFrequency {
  return value === "weekly" || value === "monthly" || value === "quarterly" || value === "yearly";
}

function isValidStatus(value: unknown): value is PmStatus {
  return value === "active" || value === "paused";
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getPmStore();
  const item = store.items.find((i) => i.id === id);
  if (!item) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return NextResponse.json({ item });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    code?: unknown;
    asset?: unknown;
    location?: unknown;
    frequency?: unknown;
    nextDue?: unknown;
    status?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : undefined;
  const asset = typeof body?.asset === "string" ? body.asset.trim() : undefined;
  const location = typeof body?.location === "string" ? body.location.trim() : undefined;
  const frequency =
    body?.frequency !== undefined && isValidFrequency(body.frequency) ? body.frequency : undefined;
  const nextDue = typeof body?.nextDue === "string" ? body.nextDue.trim() : undefined;
  const status = body?.status !== undefined && isValidStatus(body.status) ? body.status : undefined;

  const store = getPmStore();
  const idx = store.items.findIndex((i) => i.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const current = store.items[idx];
  const updated: PreventiveMaintenance = {
    ...current,
    name: name !== undefined ? name : current.name,
    code: code !== undefined ? code : current.code,
    asset: asset !== undefined ? asset || undefined : current.asset,
    location: location !== undefined ? location || undefined : current.location,
    frequency: frequency !== undefined ? frequency : current.frequency,
    nextDue: nextDue !== undefined ? nextDue || undefined : current.nextDue,
    status: status !== undefined ? status : current.status,
  };

  if (!updated.name.trim())
    return NextResponse.json({ message: "PM name required." }, { status: 400 });
  if (!updated.code.trim())
    return NextResponse.json({ message: "PM code required." }, { status: 400 });

  store.items = [...store.items.slice(0, idx), updated, ...store.items.slice(idx + 1)];
  return NextResponse.json({ item: updated });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getPmStore();
  const idx = store.items.findIndex((i) => i.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  store.items = [...store.items.slice(0, idx), ...store.items.slice(idx + 1)];
  return NextResponse.json({ ok: true });
}
