import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { OrganizationForm } from "@/features/organizations/organization-form";

export default async function EditOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Organization</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={`${APP_ROUTES.organizations}/${id}`}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <OrganizationForm mode="edit" organizationId={id} />
    </main>
  );
}

