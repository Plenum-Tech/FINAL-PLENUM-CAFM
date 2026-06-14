import Link from "next/link";

import { Button } from "@/components";
import { APP_ROUTES } from "@/constants";
import { LoginForm } from "@/features";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const params = await Promise.resolve(searchParams ?? {});
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const redirectTo = from && from.startsWith("/") ? from : APP_ROUTES.ai;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-md justify-end pb-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={APP_ROUTES.home}>Back</Link>
        </Button>
      </div>
      <LoginForm redirectTo={redirectTo} />
    </main>
  );
}
