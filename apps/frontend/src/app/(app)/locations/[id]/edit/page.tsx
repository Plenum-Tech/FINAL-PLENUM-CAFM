import { LocationForm } from "@/features/locations/location-form";

export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <LocationForm mode="edit" locationId={id} />
    </main>
  );
}

