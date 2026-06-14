import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { MaintenancePlanForm } from "@/features/preventive-maintenance/maintenance-plan-form";

export default function NewPreventiveMaintenancePage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Maintenance Plan</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={APP_ROUTES.preventiveMaintenance}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <MaintenancePlanForm mode="create" />
    </main>
  );
}

