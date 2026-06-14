import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

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

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getStore();
  const template = store.templates.find((t) => t.id === id);
  if (!template) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return NextResponse.json({ template });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getStore();
  const idx = store.templates.findIndex((t) => t.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  store.templates = [...store.templates.slice(0, idx), ...store.templates.slice(idx + 1)];
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as null | {
    name?: unknown;
    description?: unknown;
  };

  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;

  const store = getStore();
  const idx = store.templates.findIndex((t) => t.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const current = store.templates[idx];
  const updated: Template = {
    ...current,
    name: name !== undefined ? name : current.name,
    description: description !== undefined ? description || undefined : current.description,
  };
  if (!updated.name.trim()) {
    return NextResponse.json({ message: "Template name required." }, { status: 400 });
  }

  store.templates = [...store.templates.slice(0, idx), updated, ...store.templates.slice(idx + 1)];
  return NextResponse.json({ template: updated });
}
