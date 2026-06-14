import { redirect } from "next/navigation";

import { orchestratorHref } from "@/features/ai/pipeline/deep-agent/orchestrator-space-params";

/** WO creation is handled in the single-door orchestrator chat. */
export default function NewWorkOrderRedirectPage() {
  redirect(orchestratorHref("work_orders"));
}
