import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { UserForm } from "@/features/users/user-form";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>User</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={`${APP_ROUTES.users}/${id}`}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <UserForm mode="edit" userId={id} />
    </main>
  );
}

