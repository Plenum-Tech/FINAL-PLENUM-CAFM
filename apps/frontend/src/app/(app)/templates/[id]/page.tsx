import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { EditTemplateForm, type Template } from "@/features";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { apiFetchInternal } from "@/services/api/internal.server";

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let template: Template;
  try {
    const data = await apiFetchInternal<{ template: Template }>(
      `/api/templates/${encodeURIComponent(id)}`,
    );
    template = data.template;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 401) redirect(APP_ROUTES.login);
    throw e;
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between">
          <CardTitle>Template</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={APP_ROUTES.templates}>Back</Link>
          </Button>
        </CardContent>
      </Card>

      <EditTemplateForm template={template} />
    </main>
  );
}
