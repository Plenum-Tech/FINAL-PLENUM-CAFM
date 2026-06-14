import Link from "next/link";
import { Plus, Download } from "lucide-react";

import { Button } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { AssetsGrid } from "@/features/assets/assets-grid";

export default async function AssetsPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assets</h1>
          <p className="text-muted-foreground mt-1">
            Manage and monitor all facility assets in real-time.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            <span>Export</span>
          </Button>
          <Button asChild className="gap-2">
            <Link href={`${APP_ROUTES.assets}/new`}>
              <Plus className="h-4 w-4" />
              <span>Add Asset</span>
            </Link>
          </Button>
        </div>
      </div>

      <AssetsGrid />
    </div>
  );
}
