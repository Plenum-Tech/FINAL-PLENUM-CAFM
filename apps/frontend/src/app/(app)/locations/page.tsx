import { LocationsGrid } from "@/features/locations/locations-grid";

export default async function LocationsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <LocationsGrid />
    </main>
  );
}
