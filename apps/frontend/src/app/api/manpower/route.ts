import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const store = getStore();
  return NextResponse.json({ manpower: store.manpower });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    designation?: unknown;
    email?: unknown;
    phone?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const designation = typeof body?.designation === "string" ? body.designation.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!name) return NextResponse.json({ message: "Name required." }, { status: 400 });

  const store = getStore();
  const entry: Manpower = {
    id: `mp_${Math.random().toString(16).slice(2, 10)}`,
    name,
    designation: designation || undefined,
    email: email || undefined,
    phone: phone || undefined,
    createdAt: new Date().toISOString(),
  };

  store.manpower = [entry, ...store.manpower];

  return NextResponse.json({ manpower: entry }, { status: 201 });
}
