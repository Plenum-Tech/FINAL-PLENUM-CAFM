import { NextResponse } from "next/server";

import { getAssetStore, requireUser, type Asset, type AssetStatus } from "./store";

function isValidStatus(value: unknown): value is AssetStatus {
  return (
    value === "active" || value === "maintenance" || value === "warning" || value === "critical"
  );
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const store = getAssetStore();
  return NextResponse.json({ assets: store.assets });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    code?: unknown;
    category?: unknown;
    location?: unknown;
    healthScore?: unknown;
    status?: unknown;
    warrantyExpiry?: unknown;
    lastMaintenance?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const healthScore =
    typeof body?.healthScore === "number" && Number.isFinite(body.healthScore)
      ? body.healthScore
      : 0;
  const status = isValidStatus(body?.status) ? body.status : ("active" satisfies AssetStatus);
  const warrantyExpiry = typeof body?.warrantyExpiry === "string" ? body.warrantyExpiry.trim() : "";
  const lastMaintenance =
    typeof body?.lastMaintenance === "string" ? body.lastMaintenance.trim() : "";

  if (!name) return NextResponse.json({ message: "Asset name required." }, { status: 400 });
  if (!code) return NextResponse.json({ message: "Asset code required." }, { status: 400 });
  if (!category) return NextResponse.json({ message: "Category required." }, { status: 400 });
  if (!location) return NextResponse.json({ message: "Location required." }, { status: 400 });

  const store = getAssetStore();
  const asset: Asset = {
    id: `ast_${Math.random().toString(16).slice(2, 10)}`,
    name,
    code,
    category,
    location,
    healthScore: Math.max(0, Math.min(100, Math.round(healthScore))),
    status,
    warrantyExpiry: warrantyExpiry || undefined,
    lastMaintenance: lastMaintenance || undefined,
    createdAt: new Date().toISOString(),
  };

  store.assets = [asset, ...store.assets];
  return NextResponse.json({ asset }, { status: 201 });
}
