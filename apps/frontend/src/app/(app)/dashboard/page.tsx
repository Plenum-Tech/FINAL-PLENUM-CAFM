import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";

export default function DashboardPage() {
  redirect(APP_ROUTES.ai);
}
