export type DbCommandType = "add" | "delete" | "rename";

export type ParsedDbSlashCommand =
  | { kind: "help" }
  | { kind: "invalid" }
  | { kind: "ok"; op: "add"; table: string; col: string; type: string }
  | { kind: "ok"; op: "delete"; table: string; col: string }
  | { kind: "ok"; op: "rename"; table: string; col: string; nextCol: string };

export function parseDbSlashCommand(raw: string): ParsedDbSlashCommand {
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length === 2 && tokens[0] === "/db" && tokens[1] === "help") return { kind: "help" };
  if (tokens.length < 4) return { kind: "invalid" };
  if (tokens[0] !== "/db") return { kind: "invalid" };
  const op = tokens[1];
  if (op !== "add" && op !== "delete" && op !== "rename") return { kind: "invalid" };
  const table = tokens[2];
  const col = tokens[3];
  if (!table || !col) return { kind: "invalid" };
  if (op === "add") {
    const type = tokens[4] ?? "text";
    return { kind: "ok", op, table, col, type };
  }
  if (op === "delete") return { kind: "ok", op, table, col };
  const nextCol = tokens[4];
  if (!nextCol) return { kind: "invalid" };
  return { kind: "ok", op, table, col, nextCol };
}

export function buildDbCommandPreview(input: {
  type: DbCommandType;
  tableName: string;
  columnName: string;
  newColumnName: string;
  columnType: string;
}): string | null {
  const table = input.tableName.trim();
  const column = input.columnName.trim();
  const nextColumn = input.newColumnName.trim();
  if (!table) return null;
  if (input.type === "add") {
    if (!column) return null;
    return `ALTER TABLE ${table} ADD COLUMN ${column} ${input.columnType};`;
  }
  if (input.type === "delete") {
    if (!column) return null;
    return `ALTER TABLE ${table} DROP COLUMN ${column};`;
  }
  if (!column || !nextColumn) return null;
  return `ALTER TABLE ${table} RENAME COLUMN ${column} TO ${nextColumn};`;
}

