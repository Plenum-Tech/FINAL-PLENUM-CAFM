export type SchemaReviewFocus = {
  scope: "deterministic" | "semantic" | "field_mapping";
  sourceTable?: string;
  sourceField?: string;
  targetField?: string | null;
  nodeHint?: number | null;
};

