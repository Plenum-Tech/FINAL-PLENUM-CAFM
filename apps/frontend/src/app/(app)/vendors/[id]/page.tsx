import { VendorDetailsClient } from "./vendor-details-client";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <VendorDetailsClient vendorId={id} />
    </main>
  );
}
