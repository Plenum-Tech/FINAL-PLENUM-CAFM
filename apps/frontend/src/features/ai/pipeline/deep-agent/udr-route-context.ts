/** Matches svc-deepagents session_workspace route intent constants
 *  (see _VALID_FORCED_ROUTES in session_workspace.py). */
export type UdrForcedRoute =
  | "udr_ingest_documents"
  | "udr_run_mapping_hierarchy"
  | "bulk_ingest"
  | "fiix_sync"
  | "wo_intake_or_create"
  | "general_query";

export const UDR_FORCED_ROUTE_KEY = "plenum_forced_route";

/** Append a forced route line the orchestrator parses before keyword routing. */
export function buildOrchestratorContext(opts: {
  orgId?: string | null;
  forcedRoute?: UdrForcedRoute | null;
  migrationId?: string | null;
}): string | undefined {
  const parts: string[] = [];
  if (opts.orgId?.trim()) parts.push(`Organization ID: ${opts.orgId.trim()}`);
  if (opts.forcedRoute && opts.forcedRoute !== "general_query") {
    parts.push(`${UDR_FORCED_ROUTE_KEY}=${opts.forcedRoute}`);
  }
  if (opts.migrationId?.trim()) parts.push(`migration_id=${opts.migrationId.trim()}`);
  return parts.length ? parts.join("\n") : undefined;
}
