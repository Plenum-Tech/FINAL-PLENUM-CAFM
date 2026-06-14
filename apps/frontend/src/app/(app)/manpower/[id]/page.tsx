import { redirect } from "next/navigation";
import { APP_ROUTES } from "@/constants";

export default async function ManpowerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await params;
  redirect(APP_ROUTES.technicians);
}
