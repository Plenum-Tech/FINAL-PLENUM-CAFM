import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { OrganizationForm } from "@/features/organizations/organization-form";

export default function NewOrganizationPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Organization</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={APP_ROUTES.organizations}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <OrganizationForm mode="create" />
    </main>
  );
}

