import { LocationDetailsClient } from "./location-details-client";

export default async function LocationDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <LocationDetailsClient locationId={id} />
    </main>
  );
}

