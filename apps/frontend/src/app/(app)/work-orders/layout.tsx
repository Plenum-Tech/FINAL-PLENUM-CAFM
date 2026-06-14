import type { ReactNode } from "react";

import { WorkOrderNavigator } from "@/features/work-orders/work-order-navigator";

export default function WorkOrdersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <WorkOrderNavigator />
      {children}
    </div>
  );
}
