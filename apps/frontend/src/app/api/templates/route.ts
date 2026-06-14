import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, decodeDemoToken } from "@/services/auth";

type Template = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
};

type TemplateStore = {
  templates: Template[];
};

function getStore(): TemplateStore {
  const g = globalThis as unknown as { __cafmTemplateStore?: TemplateStore };
  if (!g.__cafmTemplateStore) {
    g.__cafmTemplateStore = {
      templates: [
        {
          id: "tpl_001",
          name: "Standard PM Checklist",
          description: "Default preventive maintenance checklist template.",
          createdAt: new Date().toISOString(),
        },
        {
          id: "tpl_002",
          name: "Vendor Onboarding",
          description: "Basic vendor onboarding data capture template.",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return g.__cafmTemplateStore;
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
  return NextResponse.json({ templates: store.templates });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    description?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!name) return NextResponse.json({ message: "Template name required." }, { status: 400 });

  const store = getStore();
  const template: Template = {
    id: `tpl_${Math.random().toString(16).slice(2, 10)}`,
    name,
    description: description || undefined,
    createdAt: new Date().toISOString(),
  };
  store.templates = [template, ...store.templates];

  return NextResponse.json({ template }, { status: 201 });
}
