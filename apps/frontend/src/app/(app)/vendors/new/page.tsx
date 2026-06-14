import Link from "next/link";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { VendorForm } from "@/features/vendor/vendor-form";

export default function NewVendorPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Vendor</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={APP_ROUTES.vendors}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <VendorForm mode="create" />
    </main>
  );
}

