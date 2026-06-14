import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";

export default function HomePage() {
  redirect(APP_ROUTES.ai);
}
