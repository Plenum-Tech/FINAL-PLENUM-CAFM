import { UserDetailsClient } from "./user-details-client";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <UserDetailsClient userId={id} />
    </main>
  );
}

