import Link from "next/link";
import { Button, Card, CardContent, CardTitle } from "@/components";
import { APP_ROUTES } from "@/constants";
import { AssetForm } from "@/features/assets/asset-form";

export default function NewAssetPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Asset</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={APP_ROUTES.assets}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <AssetForm mode="create" />
    </main>
  );
}
