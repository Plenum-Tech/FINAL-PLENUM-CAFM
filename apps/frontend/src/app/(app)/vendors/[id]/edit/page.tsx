import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { VendorForm } from "@/features/vendor/vendor-form";

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Vendor</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={`${APP_ROUTES.vendors}/${id}`}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <VendorForm mode="edit" vendorId={id} />
    </main>
  );
}

