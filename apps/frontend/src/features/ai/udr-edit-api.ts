"use client";

import { aiRequest } from "./chat-api";

/**
 * Client for the Saved UDR script edit / rerun / reset-to-phase endpoints
 * (Feature 4 B.2–B.6). Mirrors svc-ai-schema-mapper/src/api/udr_rerun.py.
 */

export type UdrRerunPhase =
  | "deterministic"
  | "semantic"
  | "field_mapping"
  | "hierarchy"
  | "validation";

export type UdrResetPhase =
  | "ingest"
  | "deterministic"
  | "pre_semantic"
  | "semantic"
  | "field_mapping"
  | "hierarchy"
  | "validation"
  | "final";

export type SourceFileEdit =
  | { action: "add" | "replace"; filename: string; data_url: string; replaces?: string }
  | { action: "remove"; filename: string };

export type EditSourcesRequest = {
  edits: SourceFileEdit[];
  note?: string;
};

export type ColumnEdit = {
  table_name: string;
  column_name: string;
  action: "rename" | "map" | "create" | "remove" | "set_type";
  new_name?: string;
  target_field?: string;
  data_type?: string;
  nullable?: boolean;
};

export type EditColumnsRequest = {
  edits: ColumnEdit[];
  note?: string;
};

export type HierarchyEdit = {
  action: "add" | "remove" | "update";
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  relationship_type?: string;
};

export type EditHierarchyRequest = {
  edits: HierarchyEdit[];
  note?: string;
};

export type ResetToPhaseRequest = {
  target_phase: UdrResetPhase;
  note?: string;
};

export type UdrEditResponse = {
  migration_id: string;
  accepted_at: string;
  edit_kind: "sources" | "columns" | "hierarchy" | "rerun" | "reset";
  pending_phase?: string | null;
  edits_recorded: number;
  queued: boolean;
  detail: string;
};

function migrationPath(migrationId: string, suffix: string): string {
  return `/${encodeURIComponent(migrationId)}${suffix}`;
}

export function editMigrationSources(
  migrationId: string,
  body: EditSourcesRequest,
): Promise<UdrEditResponse> {
  return aiRequest<UdrEditResponse, EditSourcesRequest>({
    method: "POST",
    basePath: "/api/migration",
    path: migrationPath(migrationId, "/edit/sources"),
    body,
  });
}

export function editMigrationColumns(
  migrationId: string,
  body: EditColumnsRequest,
): Promise<UdrEditResponse> {
  return aiRequest<UdrEditResponse, EditColumnsRequest>({
    method: "POST",
    basePath: "/api/migration",
    path: migrationPath(migrationId, "/edit/columns"),
    body,
  });
}

export function editMigrationHierarchy(
  migrationId: string,
  body: EditHierarchyRequest,
): Promise<UdrEditResponse> {
  return aiRequest<UdrEditResponse, EditHierarchyRequest>({
    method: "POST",
    basePath: "/api/migration",
    path: migrationPath(migrationId, "/edit/hierarchy"),
    body,
  });
}

export function rerunMigrationPhase(
  migrationId: string,
  phase: UdrRerunPhase,
): Promise<UdrEditResponse> {
  return aiRequest<UdrEditResponse>({
    method: "POST",
    basePath: "/api/migration",
    path: migrationPath(migrationId, `/rerun/${encodeURIComponent(phase)}`),
  });
}

export function resetMigrationToPhase(
  migrationId: string,
  body: ResetToPhaseRequest,
): Promise<UdrEditResponse> {
  return aiRequest<UdrEditResponse, ResetToPhaseRequest>({
    method: "POST",
    basePath: "/api/migration",
    path: migrationPath(migrationId, "/reset-to-phase"),
    body,
  });
}
