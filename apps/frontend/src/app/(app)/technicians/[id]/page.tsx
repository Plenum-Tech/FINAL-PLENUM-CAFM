import { TechnicianDetailsClient } from "./technician-details-client";

export default async function TechnicianDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <TechnicianDetailsClient technicianId={id} />
    </main>
  );
}

