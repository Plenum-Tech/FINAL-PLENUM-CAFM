/**
 * Center-chat intent clarification menu (WP-2).
 *
 * When a user's message looks like an ambiguous "migration / data" request, the
 * orchestrator shell shows a small set of quick-reply chips BEFORE routing, so the
 * user can pick the right pipeline (CSV/Excel vs Word/PDF vs live CMMS vs
 * direct DB). Chips do NOT call the orchestrator directly — they set a pending intent
 * and/or send the held message with a forced route hint.
 *
 * Pure definitions + helpers. State lives in use-intent-clarification.ts.
 */
import type { UdrForcedRoute } from "./udr-route-context";
import type { SavedSpaceId } from "./deep-agent-spaces";
import { classifyUploadFiles } from "./single-door-ingest-progress";

export type IntentKind =
  | "csv_excel"
  | "word_pdf"
  | "fiix_live"
  | "direct_db";

export type IntentChip = {
  kind: IntentKind;
  label: string;
  detail: string;
  /** Forced route appended as plenum_forced_route=… (a valid backend route). */
  forcedRoute: UdrForcedRoute;
  /** User-facing saved space this chip belongs to. Drives auto-tagging — independent of
   *  the backend route (e.g. word_pdf uses udr_ingest_documents but lands in documents). */
  intentSpace: SavedSpaceId;
  /** After picking, does this track expect file attachments next? */
  needsFiles: boolean;
  /** Next-step message shown after a pick that still needs input. */
  nextStep: string;
};

export const INTENT_CHIPS: IntentChip[] = [
  {
    kind: "csv_excel",
    label: "Migrate CSV/Excel data to DB",
    detail:
      "Upload spreadsheets (.csv, .xlsx). All files/sheets merge into one migration job → field mapping → hierarchy → plenum_cafm.",
    forcedRoute: "bulk_ingest",
    intentSpace: "migration",
    needsFiles: true,
    nextStep: "Attach one or more CSV/Excel files, or drag them into the composer.",
  },
  {
    kind: "word_pdf",
    label: "Migrate Word/PDF document to DB",
    detail:
      "Upload documents (.pdf, .doc, .docx). Doc RAG index → match rows to CMMS tables → grounded search. Not the spreadsheet migration pipeline.",
    forcedRoute: "udr_ingest_documents",
    intentSpace: "documents",
    needsFiles: true,
    nextStep: "Attach your PDF/Word/TXT documents, or drag them into the composer.",
  },
  {
    kind: "fiix_live",
    label: "Live CMMS data migration to DB",
    detail:
      "Connect Fiix (subdomain + API keys) → fetch live schema → schema mapping gates → optional Fiix → plenum_cafm sync.",
    forcedRoute: "fiix_sync",
    intentSpace: "schema",
    needsFiles: false,
    nextStep: "Reply with your Fiix subdomain to start (and API keys if prompted).",
  },
  {
    kind: "direct_db",
    label: "Want to access CMMS data",
    detail:
      "Query or update plenum_cafm tables (UDR): list tables, search records, run approved reads/writes.",
    forcedRoute: "general_query",
    intentSpace: "general",
    needsFiles: false,
    nextStep: "Which table or question? (e.g. 'list all assets' or 'show sites')",
  },
];

export const INTENT_BY_KIND: Record<IntentKind, IntentChip> = INTENT_CHIPS.reduce(
  (acc, chip) => {
    acc[chip.kind] = chip;
    return acc;
  },
  {} as Record<IntentKind, IntentChip>,
);

export const MENU_TITLE = "What would you like to do?";
export const MENU_SUBTITLE =
  "Pick one of these four — migrate data into the CMMS database, or read what's already there.";
export const MIXED_TITLE = "You attached both spreadsheets and documents.";

/** Trigger phrases for an ambiguous migration / data-work request.
 *  Includes "make/create/set up a new database" — the trailing word-char and
 *  optional "s" cover tense + plural ("creating", "databases") so the menu opens.
 *  Possessive determiners ("my", "our") are tolerated for phrases like
 *  "build my property data model" and "set up our data model".
 *  "Import these spreadsheets" and "import this workbook" also match — the
 *  qualifier set after "import" was widened to include CSV / Excel / sheet
 *  language so file-bearing intents don't fall through to general routing. */
const MIGRATION_TRIGGER =
  /\b(migrat\w*|import(ing)?\s+(data|cmms|to\s+plenum|these\s+|this\s+|all\s+|the\s+)?(spreadsheets?|workbooks?|sheets?|files?|csv|excel|xlsx)?|move\s+(cmms\s+)?data|db\s+migration|database\s+migration|(creat\w*|mak\w*|build\w*|spin\s*up|set\s*up|new)\s+(a\s+|an\s+|new\s+|the\s+|my\s+|our\s+|your\s+)?(unified\s+)?((property|data|cmms)\s+)?(database|db|data\s+model|data\s+register)s?|ingest\s+cmms|onboard\w*\s+data|bring\s+(in\s+)?data|unified\s+(data\s+)?(register|database))\b/i;

export function isMigrationIntent(text: string): boolean {
  return MIGRATION_TRIGGER.test(text || "");
}

export const STRUCTURED_FILE_RE = /\.(csv|xlsx|xls|xlsm)$/i;
export const DOCUMENT_FILE_RE = /\.(pdf|docx?|txt|png|jpe?g|webp|tiff?|gif)$/i;

export type FileMix = {
  hasStructured: boolean;
  hasDocs: boolean;
  hasSchema: boolean;
  mixed: boolean;
};

export function detectUploadMix(files: File[]): FileMix {
  const { migration, docRag, schema } = classifyUploadFiles(files || []);
  return {
    hasStructured: migration,
    hasDocs: docRag,
    hasSchema: schema,
    mixed: migration && docRag,
  };
}

export function splitFilesByTrack(files: File[]): { structured: File[]; docs: File[] } {
  return {
    structured: (files || []).filter((f) => STRUCTURED_FILE_RE.test(f.name)),
    docs: (files || []).filter((f) => DOCUMENT_FILE_RE.test(f.name)),
  };
}

export function routeForIntent(kind: IntentKind): UdrForcedRoute {
  return INTENT_BY_KIND[kind].forcedRoute;
}

export function spaceForIntent(kind: IntentKind): SavedSpaceId {
  return INTENT_BY_KIND[kind].intentSpace;
}

/** Keywords used to rank the intent list against what the user typed. */
const INTENT_KEYWORDS: Record<IntentKind, string[]> = {
  csv_excel: [
    "csv", "excel", "xlsx", "xls", "xlsm", "spreadsheet", "workbook", "sheet",
    "structured", "tabular", "migrat", "import", "move data",
  ],
  word_pdf: [
    "pdf", "word", "doc", "docx", "txt", "document", "certificate", "warranty",
    "reading", "scan", "image", "index", "rag", "unstructured",
  ],
  fiix_live: [
    "fiix", "live", "cmms", "connect", "sync", "subdomain", "credential",
    "api key", "fetch schema", "schema mapping",
  ],
  direct_db: [
    "database", "db", "table", "query", "sql", "record", "plenum_cafm",
    "direct", "read", "write", "search", "list tables", "access", "cmms data",
  ],
};

export type RankedIntent = { chip: IntentChip; score: number };

/** Order the 4 intents by relevance to the user's query (keyword match count). */
export function rankIntentsByQuery(query: string): RankedIntent[] {
  const q = (query || "").toLowerCase();
  return INTENT_CHIPS.map((chip) => {
    const kws = INTENT_KEYWORDS[chip.kind] ?? [];
    const score = kws.reduce((s, kw) => (q.includes(kw) ? s + 1 : s), 0);
    return { chip, score };
  }).sort((a, b) => b.score - a.score);
}
