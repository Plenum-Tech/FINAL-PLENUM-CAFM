import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, Card, CardContent, CardTitle } from "@/components";
import { CreateTemplateForm, deleteTemplateAction, type Template } from "@/features";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { apiFetchInternal } from "@/services/api/internal.server";

export default async function TemplatesPage() {
  let data: { templates: Template[] };
  try {
    data = await apiFetchInternal<{ templates: Template[] }>("/api/templates");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(APP_ROUTES.login);
    throw e;
  }

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <CardTitle>Templates</CardTitle>
              <p className="text-sm text-muted-foreground">Basic template registry (demo).</p>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.templates.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{t.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.description ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`${APP_ROUTES.templates}/${t.id}`}>Edit</Link>
                          </Button>
                          <form action={deleteTemplateAction}>
                            <input type="hidden" name="id" value={t.id} />
                            <Button size="sm" variant="destructive" type="submit">
                              Delete
                            </Button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.templates.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={4}>
                        No templates yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <CreateTemplateForm />
      </div>
    </main>
  );
}
