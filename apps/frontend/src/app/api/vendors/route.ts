import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const store = getStore();
  return NextResponse.json({ vendors: store.vendors });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : undefined;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : undefined;

  if (!name) return NextResponse.json({ message: "Vendor name required." }, { status: 400 });

  const store = getStore();
  const vendor: Vendor = {
    id: `ven_${Math.random().toString(16).slice(2, 10)}`,
    name,
    email: email || undefined,
    phone: phone || undefined,
    createdAt: new Date().toISOString(),
  };
  store.vendors = [vendor, ...store.vendors];

  return NextResponse.json({ vendor }, { status: 201 });
}
