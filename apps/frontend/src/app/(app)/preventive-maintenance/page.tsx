import { MaintenancePlansGrid } from "@/features/preventive-maintenance/maintenance-plans-grid";

export default async function PreventiveMaintenancePage() {
  return (
    <main className="mx-auto w-full max-w-6xl">
      <MaintenancePlansGrid />
    </main>
  );
}
