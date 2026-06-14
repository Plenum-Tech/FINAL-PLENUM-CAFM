import { NextResponse, type NextRequest } from "next/server";

import { getAssetStore, requireUser, type Asset, type AssetStatus } from "../store";

function isValidStatus(value: unknown): value is AssetStatus {
  return (
    value === "active" || value === "maintenance" || value === "warning" || value === "critical"
  );
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getAssetStore();
  const asset = store.assets.find((a) => a.id === id);
  if (!asset) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return NextResponse.json({ asset });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getAssetStore();
  const idx = store.assets.findIndex((a) => a.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  store.assets = [...store.assets.slice(0, idx), ...store.assets.slice(idx + 1)];
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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

  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : undefined;
  const category = typeof body?.category === "string" ? body.category.trim() : undefined;
  const location = typeof body?.location === "string" ? body.location.trim() : undefined;
  const healthScore =
    typeof body?.healthScore === "number" && Number.isFinite(body.healthScore)
      ? body.healthScore
      : undefined;
  const status =
    body?.status !== undefined ? (isValidStatus(body.status) ? body.status : null) : undefined;
  const warrantyExpiry =
    typeof body?.warrantyExpiry === "string" ? body.warrantyExpiry.trim() : undefined;
  const lastMaintenance =
    typeof body?.lastMaintenance === "string" ? body.lastMaintenance.trim() : undefined;

  if (status === null) return NextResponse.json({ message: "Invalid status." }, { status: 400 });

  const store = getAssetStore();
  const idx = store.assets.findIndex((a) => a.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const current = store.assets[idx];
  const updated: Asset = {
    ...current,
    name: name !== undefined ? name : current.name,
    code: code !== undefined ? code : current.code,
    category: category !== undefined ? category : current.category,
    location: location !== undefined ? location : current.location,
    healthScore:
      healthScore !== undefined
        ? Math.max(0, Math.min(100, Math.round(healthScore)))
        : current.healthScore,
    status: status !== undefined ? status : current.status,
    warrantyExpiry:
      warrantyExpiry !== undefined ? warrantyExpiry || undefined : current.warrantyExpiry,
    lastMaintenance:
      lastMaintenance !== undefined ? lastMaintenance || undefined : current.lastMaintenance,
  };

  if (!updated.name.trim())
    return NextResponse.json({ message: "Asset name required." }, { status: 400 });
  if (!updated.code.trim())
    return NextResponse.json({ message: "Asset code required." }, { status: 400 });
  if (!updated.category.trim())
    return NextResponse.json({ message: "Category required." }, { status: 400 });
  if (!updated.location.trim())
    return NextResponse.json({ message: "Location required." }, { status: 400 });

  store.assets = [...store.assets.slice(0, idx), updated, ...store.assets.slice(idx + 1)];
  return NextResponse.json({ asset: updated });
}
