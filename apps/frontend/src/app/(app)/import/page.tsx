import { redirect } from "next/navigation";

import { orchestratorHref } from "@/features/ai/pipeline/deep-agent/orchestrator-space-params";

/** UDR ingest lives in the single-door orchestrator — legacy import wizard retired. */
export default function ImportRedirectPage() {
  redirect(orchestratorHref("udr"));
}
