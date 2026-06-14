import { NextResponse } from "next/server";

import {
  getWorkOrderStore,
  requireUser,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "./store";

function isValidPriority(value: unknown): value is WorkOrderPriority {
  return value === "low" || value === "medium" || value === "high";
}

function isValidStatus(value: unknown): value is WorkOrderStatus {
  return (
    value === "open" || value === "in_progress" || value === "on_hold" || value === "completed"
  );
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const store = getWorkOrderStore();
  return NextResponse.json({ workOrders: store.workOrders });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

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

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const asset = typeof body?.asset === "string" ? body.asset.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const priority = isValidPriority(body?.priority)
    ? body.priority
    : ("medium" satisfies WorkOrderPriority);
  const status = isValidStatus(body?.status) ? body.status : ("open" satisfies WorkOrderStatus);
  const assignedTo = typeof body?.assignedTo === "string" ? body.assignedTo.trim() : "";
  const dueDate = typeof body?.dueDate === "string" ? body.dueDate.trim() : "";

  if (!title) return NextResponse.json({ message: "Work order title required." }, { status: 400 });
  if (!code) return NextResponse.json({ message: "Work order code required." }, { status: 400 });

  const store = getWorkOrderStore();
  const workOrder: WorkOrder = {
    id: `wo_${Math.random().toString(16).slice(2, 10)}`,
    title,
    code,
    asset: asset || undefined,
    location: location || undefined,
    priority,
    status,
    assignedTo: assignedTo || undefined,
    dueDate: dueDate || undefined,
    createdAt: new Date().toISOString(),
  };

  store.workOrders = [workOrder, ...store.workOrders];
  return NextResponse.json({ workOrder }, { status: 201 });
}
