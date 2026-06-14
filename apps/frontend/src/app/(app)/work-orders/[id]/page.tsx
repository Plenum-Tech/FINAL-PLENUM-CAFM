import { WorkOrderDetailsClient } from "./work-order-details-client";

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full space-y-4 ">
      <WorkOrderDetailsClient workOrderId={id} />
    </main>
  );
}
