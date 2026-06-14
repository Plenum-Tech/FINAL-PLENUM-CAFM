export type WorkOrderPriority = "low" | "medium" | "high";
export type WorkOrderStatus = "open" | "in_progress" | "on_hold" | "completed";

export type WorkOrder = {
  id: string;
  title: string;
  code: string;
  asset?: string;
  location?: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assignedTo?: string;
  dueDate?: string;
  createdAt: string;
};
