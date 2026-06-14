import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { WorkOrderForm } from "@/features/work-orders/work-order-form";

export default async function EditWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Work Order</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={`${APP_ROUTES.workOrders}/${id}`}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <WorkOrderForm mode="edit" workOrderId={id} />
    </main>
  );
}

