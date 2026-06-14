import { NextResponse } from "next/server";

import {
  getPmStore,
  requireUser,
  type PmFrequency,
  type PmStatus,
  type PreventiveMaintenance,
} from "./store";

function isValidFrequency(value: unknown): value is PmFrequency {
  return value === "weekly" || value === "monthly" || value === "quarterly" || value === "yearly";
}

function isValidStatus(value: unknown): value is PmStatus {
  return value === "active" || value === "paused";
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const store = getPmStore();
  return NextResponse.json({ items: store.items });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    code?: unknown;
    asset?: unknown;
    location?: unknown;
    frequency?: unknown;
    nextDue?: unknown;
    status?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const asset = typeof body?.asset === "string" ? body.asset.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const frequency = isValidFrequency(body?.frequency)
    ? body.frequency
    : ("monthly" satisfies PmFrequency);
  const nextDue = typeof body?.nextDue === "string" ? body.nextDue.trim() : "";
  const status = isValidStatus(body?.status) ? body.status : ("active" satisfies PmStatus);

  if (!name) return NextResponse.json({ message: "PM name required." }, { status: 400 });
  if (!code) return NextResponse.json({ message: "PM code required." }, { status: 400 });

  const store = getPmStore();
  const item: PreventiveMaintenance = {
    id: `pm_${Math.random().toString(16).slice(2, 10)}`,
    name,
    code,
    asset: asset || undefined,
    location: location || undefined,
    frequency,
    nextDue: nextDue || undefined,
    status,
    createdAt: new Date().toISOString(),
  };

  store.items = [item, ...store.items];
  return NextResponse.json({ item }, { status: 201 });
}
