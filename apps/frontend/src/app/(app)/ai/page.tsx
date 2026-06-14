import { AiOrchestratorPageClient } from "./ai-orchestrator-page-client";

/** Single-door orchestrator — migration, live CMMS, doc RAG, UDR, and work orders in one chat. */
export default function AiPage() {
  return (
    <main className="h-full overflow-hidden">
      <AiOrchestratorPageClient />
    </main>
  );
}
