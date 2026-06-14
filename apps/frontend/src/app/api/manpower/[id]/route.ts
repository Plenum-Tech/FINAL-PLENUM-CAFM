import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

type Manpower = {
  id: string;
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  createdAt: string;
};

type ManpowerStore = {
  manpower: Manpower[];
};

function getStore(): ManpowerStore {
  const g = globalThis as unknown as { __cafmManpowerStore?: ManpowerStore };
  if (!g.__cafmManpowerStore) {
    g.__cafmManpowerStore = {
      manpower: [
        {
          id: "mp_001",
          name: "Ali Raza",
          designation: "Supervisor",
          email: "ali.raza@cafm.local",
          phone: "+92 300 2222222",
          createdAt: new Date().toISOString(),
        },
        {
          id: "mp_002",
          name: "Sara Khan",
          designation: "Technician",
          email: "sara.khan@cafm.local",
          phone: "+92 300 3333333",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return g.__cafmManpowerStore;
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
  const manpower = store.manpower.find((m) => m.id === id);
  if (!manpower) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return NextResponse.json({ manpower });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getStore();
  const idx = store.manpower.findIndex((m) => m.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  store.manpower = [...store.manpower.slice(0, idx), ...store.manpower.slice(idx + 1)];
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    designation?: unknown;
    email?: unknown;
    phone?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const designation = typeof body?.designation === "string" ? body.designation.trim() : undefined;
  const email = typeof body?.email === "string" ? body.email.trim() : undefined;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : undefined;

  const store = getStore();
  const idx = store.manpower.findIndex((m) => m.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const current = store.manpower[idx];
  const updated: Manpower = {
    ...current,
    name: name !== undefined ? name : current.name,
    designation: designation !== undefined ? designation || undefined : current.designation,
    email: email !== undefined ? email || undefined : current.email,
    phone: phone !== undefined ? phone || undefined : current.phone,
  };

  if (!updated.name.trim()) {
    return NextResponse.json({ message: "Name required." }, { status: 400 });
  }

  store.manpower = [...store.manpower.slice(0, idx), updated, ...store.manpower.slice(idx + 1)];
  return NextResponse.json({ manpower: updated });
}
