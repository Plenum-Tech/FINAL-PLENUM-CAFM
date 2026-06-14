import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";

/** Legacy route — orchestrator lives at /ai */
export default function AiOrchestratorRedirectPage() {
  redirect(APP_ROUTES.ai);
}
