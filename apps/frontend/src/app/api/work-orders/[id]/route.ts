import { NextResponse, type NextRequest } from "next/server";

import {
  getWorkOrderStore,
  requireUser,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "../store";

function isValidPriority(value: unknown): value is WorkOrderPriority {
  return value === "low" || value === "medium" || value === "high";
}

function isValidStatus(value: unknown): value is WorkOrderStatus {
  return (
    value === "open" || value === "in_progress" || value === "on_hold" || value === "completed"
  );
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getWorkOrderStore();
  const workOrder = store.workOrders.find((w) => w.id === id);
  if (!workOrder) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return NextResponse.json({ workOrder });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as null | {
    title?: unknown;
    code?: unknown;
    asset?: unknown;
    location?: unknown;
    priority?: unknown;
    status?: unknown;
    assignedTo?: unknown;
    dueDate?: unknown;
  };

  const title = typeof body?.title === "string" ? body.title.trim() : undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : undefined;
  const asset = typeof body?.asset === "string" ? body.asset.trim() : undefined;
  const location = typeof body?.location === "string" ? body.location.trim() : undefined;
  const priority =
    body?.priority !== undefined && isValidPriority(body.priority) ? body.priority : undefined;
  const status = body?.status !== undefined && isValidStatus(body.status) ? body.status : undefined;
  const assignedTo = typeof body?.assignedTo === "string" ? body.assignedTo.trim() : undefined;
  const dueDate = typeof body?.dueDate === "string" ? body.dueDate.trim() : undefined;

  const store = getWorkOrderStore();
  const idx = store.workOrders.findIndex((w) => w.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const current = store.workOrders[idx];
  const updated: WorkOrder = {
    ...current,
    title: title !== undefined ? title : current.title,
    code: code !== undefined ? code : current.code,
    asset: asset !== undefined ? asset || undefined : current.asset,
    location: location !== undefined ? location || undefined : current.location,
    priority: priority !== undefined ? priority : current.priority,
    status: status !== undefined ? status : current.status,
    assignedTo: assignedTo !== undefined ? assignedTo || undefined : current.assignedTo,
    dueDate: dueDate !== undefined ? dueDate || undefined : current.dueDate,
  };

  if (!updated.title.trim())
    return NextResponse.json({ message: "Work order title required." }, { status: 400 });
  if (!updated.code.trim())
    return NextResponse.json({ message: "Work order code required." }, { status: 400 });

  store.workOrders = [
    ...store.workOrders.slice(0, idx),
    updated,
    ...store.workOrders.slice(idx + 1),
  ];
  return NextResponse.json({ workOrder: updated });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const store = getWorkOrderStore();
  const idx = store.workOrders.findIndex((w) => w.id === id);
  if (idx === -1) return NextResponse.json({ message: "Not found" }, { status: 404 });

  store.workOrders = [...store.workOrders.slice(0, idx), ...store.workOrders.slice(idx + 1)];
  return NextResponse.json({ ok: true });
}
