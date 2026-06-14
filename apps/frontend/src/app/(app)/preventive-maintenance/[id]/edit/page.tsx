import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { MaintenancePlanForm } from "@/features/preventive-maintenance/maintenance-plan-form";

export default async function EditPreventiveMaintenancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Maintenance Plan</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={`${APP_ROUTES.preventiveMaintenance}/${id}`}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <MaintenancePlanForm mode="edit" planId={id} />
    </main>
  );
}

