import { AppShell, AuthHydrator } from "@/components";
import { getCurrentUser } from "@/services/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <>
      <AuthHydrator user={user} />
      <AppShell>{children}</AppShell>
    </>
  );
}
