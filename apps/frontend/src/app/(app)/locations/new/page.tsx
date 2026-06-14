import { LocationForm } from "@/features/locations/location-form";

export default function NewLocationPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <LocationForm mode="create" />
    </main>
  );
}

