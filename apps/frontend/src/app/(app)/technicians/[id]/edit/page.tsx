import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { TechnicianForm } from "@/features/technicians/technician-form";

export default async function EditTechnicianPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Technician</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={`${APP_ROUTES.technicians}/${id}`}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <TechnicianForm mode="edit" technicianId={id} />
    </main>
  );
}

