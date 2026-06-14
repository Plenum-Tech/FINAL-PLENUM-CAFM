/** Case-insensitive alphabetical order for schema mapper table names. */
export function sortTableNames(names: Iterable<string>): string[] {
  return [...new Set(names)]
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}
