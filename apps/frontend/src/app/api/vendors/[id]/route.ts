import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

type Vendor = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  createdAt: string;
};

type VendorStore = {
  vendors: Vendor[];
};

function getStore(): VendorStore {
  const g = globalThis as unknown as { __cafmVendorStore?: VendorStore };
  if (!g.__cafmVendorStore) {
    g.__cafmVendorStore = {
      vendors: [
        {
          id: "ven_001",
          name: "Alpha Services",
          email: "alpha@vendor.com",
          phone: "+92 300 0000000",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ven_002",
          name: "Beta Supplies",
          email: "beta@vendor.com",
          phone: "+92 300 1111111",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return g.__cafmVendorStore;
}

async function requireUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value ?? "";
  const user = token ? decodeDemoToken(token) : null;
  if (!user) return null;
  return user;
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getStore();
  const vendor = store.vendors.find((v) => v.id === id);
  if (!vendor) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return NextResponse.json({ vendor });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getStore();
  const idx = store.vendors.findIndex((v) => v.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  store.vendors = [...store.vendors.slice(0, idx), ...store.vendors.slice(idx + 1)];
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const email = typeof body?.email === "string" ? body.email.trim() : undefined;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : undefined;

  const store = getStore();
  const idx = store.vendors.findIndex((v) => v.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const current = store.vendors[idx];
  const updated: Vendor = {
    ...current,
    name: name !== undefined ? name : current.name,
    email: email !== undefined ? email || undefined : current.email,
    phone: phone !== undefined ? phone || undefined : current.phone,
  };
  if (!updated.name.trim()) {
    return NextResponse.json({ message: "Vendor name required." }, { status: 400 });
  }

  store.vendors = [...store.vendors.slice(0, idx), updated, ...store.vendors.slice(idx + 1)];
  return NextResponse.json({ vendor: updated });
}
