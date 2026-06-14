import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { TechnicianForm } from "@/features/technicians/technician-form";

export default function NewTechnicianPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card className="p-2 px-3">
        <CardContent className="flex items-center align-center justify-between">
          <CardTitle>Technician</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={APP_ROUTES.technicians}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <TechnicianForm mode="create" />
    </main>
  );
}

