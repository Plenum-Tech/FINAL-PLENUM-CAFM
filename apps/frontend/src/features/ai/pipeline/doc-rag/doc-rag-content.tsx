"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FileText, Search, Link2, Database, Upload, Trash2,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Circle,
  RefreshCw, Play, Layers, BookOpen, BarChart2,
  Server, RotateCcw, Copy, Check, X, WifiOff, FileSpreadsheet,
} from "lucide-react";

import {
  useDocUpload, useDocList, useDocDelete, useDocChunks,
  useDocMatchRows, useDocMatchRowsFromFile, useRagQuery, useRagDebugQuery, useRowIndexTables, useDbTables,
  useDbTableColumns, useImportDbTable, useUploadRowIndex, useDeleteRowIndexTable, useRowIndexTableRows, useConfirmMatches,
  type DocOut, type DocStatus, type ChunkPreview, type MatchedRow, type Citation, type RetrievedChunk, type RowIndexUploadResponse, type RowIndexTableRow, type ConfirmMatchRow,
} from "@/features/ai/doc-rag-api";
import { toast } from "@/components/ui";

// ── Shared helpers ─────────────────────────────────────────────────────────────

type Tab = "documents" | "extract" | "match" | "index";
export type DocRagSidebarChunkLog = {
  chunk_id: string;
  chunk_index: number;
  page_number: number | null;
  confidence: number;
  semantic_score: number;
  bm25_score: number;
  metadata_score: number;
  matched_fields: string[];
  source_table: string;
  row_pk: string;
  chunk_text_preview: string;
};

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "documents", label: "Documents",    icon: <FileText size={13} /> },
  { id: "match",     label: "Match Schema", icon: <Link2 size={13} /> },
  { id: "extract",   label: "RAG Query",    icon: <Search size={13} /> },
];

const STATUS_STYLES: Record<string, { dot: string; pill: string; label: string }> = {
  indexed:    { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Indexed" },
  processing: { dot: "bg-blue-500 animate-pulse", pill: "bg-blue-50 text-blue-700 border-blue-200", label: "Processing" },
  extracting: { dot: "bg-amber-500 animate-pulse", pill: "bg-amber-50 text-amber-700 border-amber-200", label: "Extracting" },
  error:      { dot: "bg-red-500", pill: "bg-red-50 text-red-700 border-red-200", label: "Error" },
};

const BLOCK_TYPE_COLOR: Record<string, string> = {
  text:       "bg-slate-100 text-slate-600",
  table_row:  "bg-blue-100 text-blue-700",
  image:      "bg-purple-100 text-purple-700",
  heading:    "bg-amber-100 text-amber-700",
  list_item:  "bg-teal-100 text-teal-700",
  caption:    "bg-indigo-100 text-indigo-600",
  metadata:   "bg-pink-100 text-pink-700",
};

const METHOD_COLOR: Record<string, string> = {
  exact_key:      "bg-indigo-100 text-indigo-700",
  normalized_key: "bg-blue-100 text-blue-700",
  semantic:       "bg-purple-100 text-purple-700",
  metadata_match: "bg-teal-100 text-teal-700",
  bm25:           "bg-orange-100 text-orange-700",
  hybrid:         "bg-slate-100 text-slate-600",
};

function confStyle(v: number) {
  if (v >= 0.6) return { bar: "bg-emerald-500", border: "border-emerald-200", bg: "bg-emerald-50/40", badge: "bg-emerald-100 text-emerald-700" };
  if (v >= 0.3) return { bar: "bg-amber-400",   border: "border-amber-200",   bg: "bg-amber-50/40",   badge: "bg-amber-100 text-amber-700" };
  return          { bar: "bg-slate-400",        border: "border-slate-200",   bg: "bg-white",          badge: "bg-slate-100 text-slate-600" };
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"
      style={{ width: size, height: size }}
    />
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Extraction progress ────────────────────────────────────────────────────────

const EXTRACTION_STAGES: { label: string; sub: string; doneWhen: DocStatus[] }[] = [
  {
    label: "Document received",
    sub: "Upload accepted, queued for processing",
    doneWhen: ["processing", "extracting", "indexed", "error"],
  },
  {
    label: "Processing pages",
    sub: "Parse PDF/Word, detect pages and layout",
    doneWhen: ["extracting", "indexed"],
  },
  {
    label: "Extracting & chunking",
    sub: "Pull text blocks, tables, headings; split into chunks",
    doneWhen: ["indexed"],
  },
  {
    label: "Indexed for RAG",
    sub: "Embeddings written; ready for semantic / BM25 search",
    doneWhen: ["indexed"],
  },
];

function ExtractionProgress({ doc }: { doc: DocOut }) {
  const isActive = doc.status === "processing" || doc.status === "extracting";
  const isError  = doc.status === "error";

  const stages = EXTRACTION_STAGES.map((stage, i) => {
    const done = (stage.doneWhen as string[]).includes(doc.status);
    const prevDone =
      i === 0 ? true : (EXTRACTION_STAGES[i - 1].doneWhen as string[]).includes(doc.status);
    const isCurrent = !done && prevDone && !isError;
    return { ...stage, done, isCurrent };
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
          isError ? "bg-red-100" : isActive ? "bg-amber-100" : "bg-emerald-100"
        }`}>
          {isActive
            ? <Spinner size={18} />
            : isError
              ? <AlertCircle size={18} className="text-red-500" />
              : <CheckCircle2 size={18} className="text-emerald-600" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800">
            {isActive ? "Processing document…" : isError ? "Extraction failed" : "Extraction complete"}
          </div>
          <div className="text-xs text-slate-500 truncate">{doc.file_name}</div>
        </div>
        {doc.status === "indexed" && (
          <div className="text-xs text-right shrink-0">
            <div className="font-semibold text-slate-700 tabular-nums">{doc.num_chunks} chunks</div>
            <div className="text-slate-400 tabular-nums">{doc.num_pages} pages</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {stages.map((stage, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
              stage.done
                ? "border-emerald-200 bg-emerald-50/40"
                : stage.isCurrent
                  ? "border-amber-200 bg-amber-50/50"
                  : "border-dashed border-slate-200 bg-slate-50/60"
            }`}
          >
            <span className="shrink-0 flex items-center justify-center">
              {stage.done ? (
                <CheckCircle2 size={16} className="text-emerald-500" />
              ) : stage.isCurrent ? (
                <Spinner size={14} />
              ) : (
                <Circle size={16} className="text-slate-300" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-sm font-medium ${
                stage.done
                  ? "text-emerald-700"
                  : stage.isCurrent
                    ? "text-amber-700"
                    : "text-slate-500"
              }`}>
                {stage.label}
              </div>
              <div className="truncate text-xs text-slate-400">{stage.sub}</div>
            </div>
            <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              stage.done
                ? "bg-emerald-100 text-emerald-700"
                : stage.isCurrent
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-500"
            }`}>
              {stage.done ? "Done" : stage.isCurrent ? "In progress" : "Pending"}
            </span>
          </div>
        ))}
      </div>

      {isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50/60 px-3 py-2 flex items-start gap-2 text-xs text-red-800">
          <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-500" />
          <span>Extraction stopped. Re-upload the document or check the source file.</span>
        </div>
      ) : null}
    </div>
  );
}

// ── Chunk viewer ───────────────────────────────────────────────────────────────

function ChunkViewer({ documentId }: { documentId: string }) {
  const { data: chunks, isLoading, error } = useDocChunks(documentId);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch]           = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [copied, setCopied]           = useState<number | null>(null);

  const byType = useMemo(() => {
    if (!chunks) return {} as Record<string, number>;
    return chunks.reduce<Record<string, number>>((acc, c) => {
      acc[c.block_type] = (acc[c.block_type] ?? 0) + 1;
      return acc;
    }, {});
  }, [chunks]);

  const filtered = useMemo<ChunkPreview[]>(() => {
    if (!chunks) return [];
    let result = chunks;
    if (activeTypes.size > 0) result = result.filter((c) => activeTypes.has(c.block_type));
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) => c.text_content.toLowerCase().includes(q) || (c.section_label ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [chunks, activeTypes, search]);

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function copyChunk(c: ChunkPreview) {
    void navigator.clipboard.writeText(c.text_content);
    setCopied(c.chunk_index);
    setTimeout(() => setCopied(null), 1500);
  }

  if (isLoading) return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-400">
      <Spinner size={12} /> Loading chunks…
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-red-500">
      <AlertCircle size={12} /> Failed to load chunks
    </div>
  );
  if (!chunks?.length) return <div className="px-4 py-3 text-xs text-slate-400">No chunks found.</div>;

  return (
    <div className="border-t border-slate-100">
      {/* Toolbar: stats, type filter, search */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 space-y-2.5">
        {/* Stats row */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{chunks.length}</span> chunks total
          {filtered.length !== chunks.length && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-indigo-600 font-medium">{filtered.length} shown</span>
            </>
          )}
        </div>

        {/* Type filter pills */}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(byType).map(([type, count]) => {
            const isActive = activeTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border ${
                  isActive
                    ? (BLOCK_TYPE_COLOR[type] ?? "bg-slate-100 text-slate-600") + " border-current/30 shadow-sm"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {type.replace(/_/g, " ")}
                <span className="opacity-60">{count}</span>
              </button>
            );
          })}
          {activeTypes.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveTypes(new Set())}
              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors"
            >
              <X size={10} /> clear
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search extracted content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-7 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-slate-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Chunk list */}
      <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">
            No chunks match — try a different filter or search term.
          </div>
        ) : (
          filtered.map((c) => {
            const isOpen   = expanded.has(c.chunk_index);
            const preview  = c.text_content.length > 150 ? c.text_content.slice(0, 150) + "…" : c.text_content;
            const isCopied = copied === c.chunk_index;
            return (
              <div key={c.chunk_index} className="group hover:bg-slate-50 transition-colors">
                <div
                  className="flex items-start gap-3 px-4 py-2.5 cursor-pointer"
                  onClick={() => setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.chunk_index)) next.delete(c.chunk_index);
                    else next.add(c.chunk_index);
                    return next;
                  })}
                >
                  <span className="shrink-0 w-7 text-right text-[11px] font-mono text-slate-400 pt-0.5">
                    #{c.chunk_index}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400 pt-0.5 w-12">
                    {c.page_start != null
                      ? (c.page_start === c.page_end ? `p.${c.page_start}` : `p.${c.page_start}–${c.page_end}`)
                      : "—"}
                  </span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ${BLOCK_TYPE_COLOR[c.block_type] ?? "bg-slate-100 text-slate-600"}`}>
                    {c.block_type.replace(/_/g, " ")}
                  </span>
                  <div className="flex-1 min-w-0">
                    {c.section_label && (
                      <div className="text-[11px] text-indigo-600 font-medium mb-0.5 truncate">{c.section_label}</div>
                    )}
                    <p className="text-xs text-slate-600 leading-relaxed">{isOpen ? c.text_content : preview}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); copyChunk(c); }}
                      title="Copy text"
                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {isCopied
                        ? <Check size={11} className="text-emerald-500" />
                        : <Copy size={11} />}
                    </button>
                    {c.text_content.length > 150 && (
                      isOpen
                        ? <ChevronUp size={11} className="text-slate-400" />
                        : <ChevronDown size={11} className="text-slate-400" />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Document card ──────────────────────────────────────────────────────────────

function DocCard({
  doc,
  onDelete,
  selectedId,
  onSelect,
  autoExpand = false,
  onGoToMatch,
}: {
  doc: DocOut;
  onDelete: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  autoExpand?: boolean;
  onGoToMatch?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [showChunks, setShowChunks] = useState(autoExpand);
  const { mutate: del } = useDocDelete();
  const style = STATUS_STYLES[doc.status] ?? STATUS_STYLES.error;

  function handleDelete() {
    setDeleting(true);
    del(doc.id, {
      onSuccess: () => onDelete(doc.id),
      onError:   () => { setDeleting(false); setConfirming(false); },
    });
  }

  const isSelected = doc.id === selectedId;

  return (
    <div className={`rounded-xl border transition-all ${isSelected ? "border-indigo-300 bg-indigo-50/30" : "border-slate-200 bg-white"}`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => onSelect(doc.id)}
      >
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? "bg-indigo-100" : "bg-slate-100"}`}>
          <FileText size={16} className={isSelected ? "text-indigo-600" : "text-slate-500"} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 truncate max-w-[200px]">{doc.file_name}</span>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${style.pill}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              {style.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-slate-400">{doc.num_pages} pages</span>
            <span className="text-slate-300 text-xs">·</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowChunks((v) => !v); }}
              className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              <Layers size={11} />
              {doc.num_chunks} chunks
              {showChunks ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
            <span className="text-slate-300 text-xs">·</span>
            <span className="text-xs text-slate-400">{formatDate(doc.created_at)}</span>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {doc.status === "indexed" && onGoToMatch && (
            <button
              type="button"
              onClick={onGoToMatch}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <Link2 size={11} />
              Match Schema
            </button>
          )}
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Delete?</span>
              <button onClick={handleDelete} disabled={deleting} className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {deleting ? "…" : "Yes"}
              </button>
              <button onClick={() => setConfirming(false)} className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">No</button>
            </div>
          )}
        </div>
      </div>

      {showChunks && <ChunkViewer documentId={doc.id} />}
    </div>
  );
}

// ── Upload zone ────────────────────────────────────────────────────────────────

function UploadZone({ onUploaded }: { onUploaded: (doc: DocOut) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { mutate: upload, isPending, error, data, reset } = useDocUpload({
    onSuccess: (res) => {
      onUploaded({
        id: res.document_id,
        file_name: res.file_name,
        status: res.status as DocOut["status"],
        num_pages: res.num_pages,
        num_chunks: res.num_chunks,
        created_at: new Date().toISOString(),
        document_type: res.document_type,
      });
    },
  });

  function handleFile(file: File) {
    reset();
    upload(file);
  }

  const errMsg = error instanceof Error ? error.message : error ? "Upload failed" : null;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          dragging ? "border-rose-400 bg-rose-50" : "border-slate-200 hover:border-rose-300 hover:bg-rose-50/30"
        }`}
      >
        <input ref={inputRef} type="file" className="hidden" accept=".pdf,.doc,.docx"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {isPending ? (
          <div className="flex flex-col items-center gap-2">
            <Spinner size={24} />
            <p className="text-sm text-slate-500">Uploading — extraction may take a few minutes…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 flex items-center justify-center">
              <Upload size={22} className="text-rose-600" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Drop a document or click to browse</p>
            <p className="text-xs text-slate-400">PDF, DOC, DOCX — max 32 MB</p>
          </div>
        )}
      </div>

      {errMsg && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
          <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
          <span className="text-xs text-red-700">{errMsg}</span>
        </div>
      )}

      {data && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={15} className="text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-800">Indexed successfully</span>
            <span className="text-xs text-emerald-600 ml-auto">{data.processing_time_ms} ms</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs text-emerald-700">
            <span>File: <span className="font-medium">{data.file_name}</span></span>
            <span>Type: <span className="font-medium">{data.document_type ?? "unknown"}</span></span>
            <span>Pages: <span className="font-medium">{data.num_pages}</span></span>
            <span>Chunks: <span className="font-medium">{data.num_chunks}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Documents tab ──────────────────────────────────────────────────────────────

function DocumentsTab({
  selectedId,
  onSelect,
  initialDocId,
  onGoToMatch,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  initialDocId?: string;
  onGoToMatch?: () => void;
}) {
  const qc = useQueryClient();
  const { data: docs = [], isLoading, refetch, error } = useDocList();
  const [showAll, setShowAll] = useState(false);
  const fetchErrMsg = error instanceof Error ? error.message : error ? "Could not reach Doc RAG service" : null;

  function handleUploaded(doc: DocOut) {
    qc.setQueryData<DocOut[]>(["doc-rag", "documents"], (prev = []) => [doc, ...prev]);
    onSelect(doc.id);
  }

  function handleDeleted(id: string) {
    qc.setQueryData<DocOut[]>(["doc-rag", "documents"], (prev = []) => prev.filter((d) => d.id !== id));
    if (selectedId === id) onSelect("");
  }

  return (
    <div className="space-y-5">
      {fetchErrMsg && (
        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <WifiOff size={15} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800">Doc RAG service unreachable</p>
            <p className="text-xs text-amber-700 mt-0.5 break-words">{fetchErrMsg}</p>
          </div>
        </div>
      )}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Upload document</h3>
        <UploadZone onUploaded={handleUploaded} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Indexed documents</h3>
          <button
            type="button"
            onClick={() => { void refetch(); }}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} />
            {isLoading ? "Loading…" : `${docs.length} doc${docs.length !== 1 ? "s" : ""}`}
          </button>
        </div>

        {!isLoading && docs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
            <FileText size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No documents yet — upload one above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(showAll ? docs : docs.slice(-5).reverse()).map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                selectedId={selectedId}
                onSelect={onSelect}
                onDelete={handleDeleted}
                autoExpand={!!initialDocId && doc.id === initialDocId && doc.status === "indexed"}
                onGoToMatch={onGoToMatch}
              />
            ))}
            {docs.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 py-1 transition-colors"
              >
                {showAll ? "Show fewer" : `Show all ${docs.length} documents`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Citation card ──────────────────────────────────────────────────────────────

function CitationCard({ c }: { c: Citation }) {
  return (
    <div className="rounded-xl border border-indigo-100 bg-white px-4 py-3">
      <div className="flex items-start gap-2.5">
        <div className="h-6 w-6 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
          <BookOpen size={12} className="text-indigo-500" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-700 truncate">{c.file_name}</span>
            {c.page_start != null && <span className="text-[11px] text-slate-400">p.{c.page_start}</span>}
            {c.section && (
              <span className="text-[11px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{c.section}</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 italic leading-relaxed">"{c.quote}"</p>
        </div>
      </div>
    </div>
  );
}

// ── RAG Query tab ──────────────────────────────────────────────────────────────

function QueryTab() {
  const [query, setQuery] = useState("");
  const [topK, setTopK]   = useState(8);
  const [debug, setDebug] = useState(false);
  const { mutate: runQuery, isPending: pendingQuery, error: queryError, data: queryResult } = useRagQuery();
  const { mutate: runDebug, isPending: pendingDebug, error: debugError, data: debugResult } = useRagDebugQuery();
  const isPending = pendingQuery || pendingDebug;
  const error = debug ? debugError : queryError;
  const result = debug ? debugResult : queryResult;

  const errMsg = error instanceof Error ? error.message : error ? "Query failed" : null;
  const confColor = result
    ? result.confidence >= 0.7 ? "text-emerald-600" : result.confidence >= 0.4 ? "text-amber-600" : "text-red-500"
    : "";

  function run() {
    if (!query.trim()) return;
    const body = { query: query.trim(), top_k: topK };
    if (debug) runDebug(body);
    else runQuery(body);
  }

  const retrievedChunks: RetrievedChunk[] = result?.retrieved_chunks ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-widest mb-2">Question</label>
          <textarea
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            rows={3}
            placeholder="e.g. What maintenance tasks are listed in this contract? Which assets are covered?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }}
          />
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Top-K</span>
          <input type="range" min={1} max={20} step={1} value={topK}
            onChange={(e) => setTopK(Number(e.target.value))} className="flex-1 accent-indigo-600" />
          <span className="text-xs font-bold text-slate-700 w-5 tabular-nums">{topK}</span>
          <button
            type="button"
            onClick={() => setDebug((v) => !v)}
            className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              debug ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <BarChart2 size={12} />
            Debug
          </button>
        </div>

        {errMsg && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{errMsg}</span>
          </div>
        )}

        <button
          type="button"
          onClick={run}
          disabled={isPending || !query.trim()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? <Spinner size={14} /> : <Search size={15} />}
          {isPending ? "Searching…" : "Search"}
        </button>
      </div>

      {result && (
        <div className="space-y-4">
          {/* Metrics */}
          <div className="flex items-center gap-4 flex-wrap px-1">
            <div className="flex items-center gap-1.5">
              <BarChart2 size={12} className="text-slate-400" />
              <span className="text-xs text-slate-500">Type:</span>
              <span className="text-xs font-semibold text-slate-700">{result.query_type}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Confidence:</span>
              <span className={`text-xs font-bold ${confColor}`}>{(result.confidence * 100).toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">{result.latency_ms} ms</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Model:</span>
              <span className="text-xs font-semibold text-slate-700">{result.model_name}</span>
            </div>
            {debug && result.stages && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="text-slate-300">·</span>
                <span>vector {result.stages.vector_hits}</span>
                <span className="text-slate-300">·</span>
                <span>bm25 {result.stages.bm25_hits}</span>
                <span className="text-slate-300">·</span>
                <span>rerank {result.stages.fused_reranked}</span>
              </div>
            )}
          </div>

          {/* Answer */}
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-6 w-6 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Search size={12} className="text-indigo-600" />
              </div>
              <span className="text-sm font-semibold text-slate-800">Answer</span>
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{result.answer}</p>
          </div>

          {/* Citations */}
          {result.citations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Citations <span className="font-normal text-slate-400">({result.citations.length})</span>
              </h4>
              <div className="space-y-2">
                {result.citations.map((c, i) => <CitationCard key={i} c={c} />)}
              </div>
            </div>
          )}

          {/* Matched rows */}
          {result.matched_rows.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
                Matched rows <span className="font-normal text-slate-400">({result.matched_rows.length})</span>
              </h4>
              <div className="space-y-2">
                {result.matched_rows.map((row, i) => (
                  <RowCard key={i} row={row} />
                ))}
              </div>
            </div>
          )}

          {debug && retrievedChunks.length > 0 && (
            <details className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 flex items-center justify-between">
                Retrieved chunks <span className="text-xs text-slate-400 font-normal">{retrievedChunks.length}</span>
              </summary>
              <div className="border-t border-slate-100 divide-y divide-slate-100">
                {retrievedChunks.map((c) => {
                  const blockClass = BLOCK_TYPE_COLOR[c.block_type] ?? "bg-slate-100 text-slate-600";
                  return (
                    <div key={c.chunk_id} className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-700">{c.file_name ?? "document"}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${blockClass}`}>
                          {c.block_type.replace(/_/g, " ")}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          score {c.score.toFixed(3)} · vec {c.vector_score.toFixed(3)} · bm25 {c.bm25_score.toFixed(3)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed whitespace-pre-wrap">
                        {c.text_content}
                      </p>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Score bar ──────────────────────────────────────────────────────────────────

function ContribBar({ semantic, bm25, metadata }: { semantic: number; bm25: number; metadata: number }) {
  const total = (0.4 * semantic + 0.3 * bm25 + 0.3 * metadata) || 1;
  const semPct  = (0.4 * semantic / total) * 100;
  const bm25Pct = (0.3 * bm25 / total) * 100;
  const metaPct = (0.3 * metadata / total) * 100;
  const driver  = semPct >= bm25Pct && semPct >= metaPct ? "semantic" : bm25Pct >= metaPct ? "keyword" : "metadata";
  const driverColor = driver === "semantic" ? "text-purple-600" : driver === "keyword" ? "text-orange-600" : "text-teal-600";
  const driverPct = Math.max(semPct, bm25Pct, metaPct);

  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex h-1.5 rounded-full overflow-hidden w-20 shrink-0" title={`Semantic ${semPct.toFixed(0)}% · BM25 ${bm25Pct.toFixed(0)}% · Meta ${metaPct.toFixed(0)}%`}>
        <div className="bg-purple-400" style={{ width: `${semPct}%` }} />
        <div className="bg-orange-400" style={{ width: `${bm25Pct}%` }} />
        <div className="bg-teal-400"   style={{ width: `${metaPct}%` }} />
      </div>
      <span className="text-[11px] text-slate-400 whitespace-nowrap">
        driven by <span className={`font-semibold ${driverColor}`}>{driver} ({driverPct.toFixed(0)}%)</span>
      </span>
    </div>
  );
}

// ── Row card ───────────────────────────────────────────────────────────────────

function RowCard({
  row,
  selectable,
  selected,
  onToggle,
}: {
  row: MatchedRow;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (row: MatchedRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cls = confStyle(row.confidence);

  return (
    <div className={`rounded-xl border ${cls.border} ${cls.bg} overflow-hidden`}>
      <div
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-black/[0.03] transition-colors cursor-pointer"
      >
        {selectable && (
          <div
            role="checkbox"
            aria-checked={!!selected}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (onToggle) onToggle(row);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                if (onToggle) onToggle(row);
              }
            }}
            className={`mt-0.5 mr-1 shrink-0 rounded-full border w-4 h-4 flex items-center justify-center outline-none focus:ring-2 focus:ring-indigo-400 ${
              selected ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white"
            }`}
          >
            {selected && <Check size={10} className="text-white" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-slate-800">{row.row_pk}</span>
            <span className="text-xs text-slate-400">{row.source_table}</span>
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${METHOD_COLOR[row.match_method] ?? "bg-slate-100 text-slate-600"}`}>
              {row.match_method.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden max-w-[80px]">
              <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${Math.round(row.confidence * 100)}%` }} />
            </div>
            <span className="text-xs font-bold text-slate-600 tabular-nums">{(row.confidence * 100).toFixed(0)}%</span>
            {row.match_details && (
              <ContribBar
                semantic={row.match_details.semantic_score}
                bm25={row.match_details.bm25_overlap}
                metadata={row.match_details.metadata_overlap}
              />
            )}
          </div>
        </div>
        {expanded ? <ChevronUp size={14} className="text-slate-400 shrink-0 mt-1" /> : <ChevronDown size={14} className="text-slate-400 shrink-0 mt-1" />}
      </div>

      {expanded && (
        <div className="border-t border-slate-200 px-4 pb-4 pt-3 space-y-3">
          <div>
            <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Row data</h5>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {Object.entries(row.row_data).map(([k, v]) => (
                <div key={k} className="text-xs">
                  <span className="text-slate-400">{k}</span>
                  <span className="mx-1 text-slate-300">·</span>
                  <span className="text-slate-700 font-medium">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
          </div>

          {row.matched_metadata_fields && row.matched_metadata_fields.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Matched fields</h5>
              <div className="flex flex-wrap gap-1.5">
                {row.matched_metadata_fields.map((f, i) => (
                  <span key={i} className="text-[11px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">{f}</span>
                ))}
              </div>
            </div>
          )}

          {row.evidence && (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Evidence</h5>
              <p className="text-xs text-slate-500 italic">"{row.evidence}"</p>
            </div>
          )}

          {row.match_details && (row.match_details.exact_key_match || row.match_details.normalized_key_match) && (
            <div className="flex gap-2">
              {row.match_details.exact_key_match && (
                <span className="text-[11px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">✓ exact key</span>
              )}
              {row.match_details.normalized_key_match && (
                <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">✓ normalized key</span>
              )}
            </div>
          )}

          {row.chunk_matches && row.chunk_matches.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Matched chunks <span className="font-normal">({row.chunk_matches.length})</span>
              </h5>
              <div className="space-y-2">
                {row.chunk_matches.map((cm) => (
                  <div key={cm.chunk_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-slate-600">#{cm.chunk_index}</span>
                      <span className="text-[11px] text-slate-400">
                        {cm.page_number != null ? `p.${cm.page_number}` : "—"}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-700">
                        {(cm.confidence * 100).toFixed(0)}%
                      </span>
                      <span className="text-[11px] text-slate-400">
                        sem {cm.semantic_score.toFixed(3)} · bm25 {cm.bm25_score.toFixed(3)} · meta {cm.metadata_score.toFixed(3)}
                      </span>
                    </div>
                    {cm.matched_fields && cm.matched_fields.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {cm.matched_fields.map((f) => (
                          <span key={f} className="text-[11px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                      {cm.chunk_text_preview}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Match Schema tab ───────────────────────────────────────────────────────────

function MatchTab({
  docs,
  onSidebarChunkLogsChange,
}: {
  docs: DocOut[];
  onSidebarChunkLogsChange?: (logs: DocRagSidebarChunkLog[]) => void;
}) {
  const PK_STORAGE_KEY = "docrag.pkByTable.v1";
  function loadPkByTable(): Record<string, string> {
    try {
      const raw = localStorage.getItem(PK_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof k === "string" && typeof v === "string" && k && v) out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  const [mode, setMode] = useState<"index" | "file">("index");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [threshold, setThreshold]         = useState(0.25);
  const [activeTable, setActiveTable]     = useState<string | null>(null);
  const { data: indexedTables = [] } = useRowIndexTables();
  const { data: dbTablesData, isLoading: loadingDbTables } = useDbTables();
  const dbTables = dbTablesData?.tables ?? [];
  const [selectedDbTable, setSelectedDbTable] = useState("");
  const [pkByTable, setPkByTable] = useState<Record<string, string>>(() => loadPkByTable());
  const [indexStateByTable, setIndexStateByTable] = useState<Record<string, { state: "idle" | "indexing" | "indexed" | "error"; message?: string }>>({});

  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());

  function rowKey(row: MatchedRow) {
    return `${row.source_table}::${row.row_pk}`;
  }

  const { mutate: runMatchIndex, isPending: pendingIndex, error: errorIndex, data: resultIndex } = useDocMatchRows({
    onSuccess: (r) => {
      const tables = Object.keys(r.by_table);
      if (tables.length > 0) setActiveTable(tables[0]);
      setSelectedRowKeys(new Set());
    },
  });

  const {
    mutate: importDbTable,
    isPending: importing,
    error: importError,
  } = useImportDbTable();

  const [fileRows, setFileRows] = useState<File | null>(null);
  const [filePkColumn, setFilePkColumn] = useState("");
  const [fileSourceTable, setFileSourceTable] = useState("");
  const { mutate: runMatchFile, isPending: pendingFile, error: errorFile, data: resultFile } = useDocMatchRowsFromFile({
    onSuccess: (r) => {
      const tables = Object.keys(r.by_table);
      if (tables.length > 0) setActiveTable(tables[0]);
      setSelectedRowKeys(new Set());
    },
  });

  const indexedDocs = docs.filter((d) => d.status === "indexed");
  const isPending = mode === "file" ? pendingFile : (pendingIndex || importing);
  const error = mode === "file" ? errorFile : (importError ?? errorIndex);
  const result = mode === "file" ? resultFile : resultIndex;
  const errMsg = error instanceof Error ? error.message : error ? "Match failed" : null;

  const displayRows: MatchedRow[] = result
    ? (activeTable && result.matched_rows_by_table?.[activeTable]) || result.matched_rows
    : [];

  const allRows: MatchedRow[] = result ? result.matched_rows : [];
  const selectedRows: MatchedRow[] = allRows.filter((r) => selectedRowKeys.has(rowKey(r)));

  const [previewTableName, setPreviewTableName] = useState<string | null>(null);
  const [lastConfirmedRows, setLastConfirmedRows] = useState<ConfirmMatchRow[]>([]);
  const {
    mutate: fetchIndexRows,
    isPending: fetchingIndexRows,
    error: indexRowsError,
    data: indexRowsData,
  } = useRowIndexTableRows();

  function toggleRowKey(sourceTable: string, rowPk: string) {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      const key = `${sourceTable}::${rowPk}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRowSelection(row: MatchedRow) {
    toggleRowKey(row.source_table, row.row_pk);
  }

  const hasSelection = selectedRows.length > 0;

  const {
    mutate: confirmMatches,
    isPending: confirming,
    error: confirmError,
    data: confirmResult,
  } = useConfirmMatches({
    onSuccess: (res, vars) => {
      toast({
        title: "Matches confirmed",
        description: `Updated ${res.rows_updated} row${res.rows_updated === 1 ? "" : "s"}`,
        variant: "success",
      });
      setLastConfirmedRows(vars.rows);
      const tableFromSelection = selectedDbTable || null;
      const tableFromPayload = vars.rows[0]?.source_table ?? null;
      const tn = tableFromSelection ?? tableFromPayload;
      setPreviewTableName(tn);
      if (tn) fetchIndexRows({ tableName: tn, limit: 50, offset: 0 });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Confirm failed";
      toast({ title: "Failed to confirm matches", description: msg, variant: "destructive" });
    },
  });

  const confirmErrMsg =
    confirmError instanceof Error ? confirmError.message : confirmError ? "Confirm failed" : null;

  const selectedByTable = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of selectedRows) out[r.source_table] = (out[r.source_table] ?? 0) + 1;
    return out;
  }, [selectedRows]);

  const normalizedIndexRows: RowIndexTableRow[] = useMemo(() => {
    function normalizeSingleRow(input: unknown): RowIndexTableRow | null {
      if (!input || typeof input !== "object" || Array.isArray(input)) return null;
      const rec = input as Record<string, unknown>;
      const rowPk =
        (typeof rec.row_pk === "string" && rec.row_pk) ||
        (typeof rec.id === "string" && rec.id) ||
        "";
      const explicitRowData =
        rec.row_data && typeof rec.row_data === "object" && !Array.isArray(rec.row_data)
          ? (rec.row_data as Record<string, unknown>)
          : null;
      const metaRowData =
        rec.meta && typeof rec.meta === "object" && !Array.isArray(rec.meta)
          ? (rec.meta as Record<string, unknown>)
          : null;
      const createdAt = typeof rec.created_at === "string" ? rec.created_at : null;

      const rowDataBase = explicitRowData ?? metaRowData ?? null;
      if (!rowDataBase && !rowPk) return null;

      const rowData: Record<string, unknown> = { ...(rowDataBase ?? {}) };
      if (createdAt && rowData.created_at == null) rowData.created_at = createdAt;

      return {
        row_pk: rowPk || String(rowData.id ?? ""),
        row_data: rowData,
      };
    }

    function normalizeRowsArray(rows: unknown[]): RowIndexTableRow[] {
      const out: RowIndexTableRow[] = [];
      for (const r of rows) {
        const n = normalizeSingleRow(r);
        if (n) out.push(n);
      }
      return out;
    }

    if (!indexRowsData) return [];
    if (Array.isArray(indexRowsData)) return normalizeRowsArray(indexRowsData);
    const rows = (indexRowsData as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? normalizeRowsArray(rows) : [];
  }, [indexRowsData]);

  const confirmedPkSet = useMemo(() => {
    const tn = previewTableName;
    if (!tn) return new Set<string>();
    return new Set(lastConfirmedRows.filter((r) => r.source_table === tn).map((r) => r.row_pk));
  }, [lastConfirmedRows, previewTableName]);

  const previewRows = useMemo(() => {
    if (!normalizedIndexRows.length) return [];
    // Always show full fetched rows in table preview (up to API limit),
    // and only use highlight to indicate confirmed rows.
    return normalizedIndexRows;
  }, [normalizedIndexRows]);

  const previewColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const r of normalizedIndexRows) {
      for (const k of Object.keys(r.row_data ?? {})) keys.add(k);
    }
    const preferredOrder = [
      "id",
      "organization_id",
      "name",
      "description",
      "parent_id",
      "document_ids",
      "created_at",
    ];
    const ordered = preferredOrder.filter((k) => keys.has(k));
    const rest = Array.from(keys).filter((k) => !preferredOrder.includes(k)).sort();
    return [...ordered, ...rest];
  }, [normalizedIndexRows]);

  const [resultView, setResultView] = useState<"rows" | "chunks">("rows");

  const chunksView = useMemo(() => {
    const m = new Map<string, {
      chunk_id: string;
      chunk_index: number;
      page_number: number | null;
      preview: string;
      matches: Array<{
        source_table: string;
        row_pk: string;
        confidence: number;
        match_method: string;
        matched_fields: string[];
      }>;
      max_conf: number;
    }>();

    for (const row of allRows) {
      const cms = row.chunk_matches ?? [];
      for (const cm of cms) {
        const key = cm.chunk_id || String(cm.chunk_index);
        const existing = m.get(key);
        const entry = existing ?? {
          chunk_id: cm.chunk_id,
          chunk_index: cm.chunk_index,
          page_number: cm.page_number ?? null,
          preview: cm.chunk_text_preview,
          matches: [],
          max_conf: 0,
        };
        entry.matches.push({
          source_table: row.source_table,
          row_pk: row.row_pk,
          confidence: cm.confidence,
          match_method: row.match_method,
          matched_fields: cm.matched_fields ?? [],
        });
        entry.max_conf = Math.max(entry.max_conf, cm.confidence);
        m.set(key, entry);
      }
    }

    return Array.from(m.values()).sort((a, b) => b.max_conf - a.max_conf || a.chunk_index - b.chunk_index);
  }, [allRows]);

  const sidebarChunkLogs = useMemo<DocRagSidebarChunkLog[]>(() => {
    const bestByChunk = new Map<string, DocRagSidebarChunkLog>();
    for (const row of allRows) {
      for (const cm of row.chunk_matches ?? []) {
        const key = cm.chunk_id || String(cm.chunk_index);
        const candidate: DocRagSidebarChunkLog = {
          chunk_id: cm.chunk_id,
          chunk_index: cm.chunk_index,
          page_number: cm.page_number ?? null,
          confidence: cm.confidence,
          semantic_score: cm.semantic_score,
          bm25_score: cm.bm25_score,
          metadata_score: cm.metadata_score,
          matched_fields: cm.matched_fields ?? [],
          source_table: row.source_table,
          row_pk: row.row_pk,
          chunk_text_preview: cm.chunk_text_preview,
        };
        const prev = bestByChunk.get(key);
        if (!prev || candidate.confidence > prev.confidence) {
          bestByChunk.set(key, candidate);
        }
      }
    }
    return Array.from(bestByChunk.values())
      .sort((a, b) => b.confidence - a.confidence || a.chunk_index - b.chunk_index)
      .slice(0, 40);
  }, [allRows]);

  useEffect(() => {
    onSidebarChunkLogsChange?.(sidebarChunkLogs);
  }, [onSidebarChunkLogsChange, sidebarChunkLogs]);

  const [pkModalOpen, setPkModalOpen] = useState(false);
  const [pkModalTable, setPkModalTable] = useState<string>("");
  const [pkModalValue, setPkModalValue] = useState<string>("");
  const { data: pkColumns = [], isLoading: loadingPkCols } = useDbTableColumns(pkModalTable, {
    enabled: pkModalOpen && !!pkModalTable,
  });

  function isTableIndexed(tableName: string) {
    return indexedTables.some((t) => t.source_table === tableName);
  }

  function runMatchForTable(tableName: string) {
    if (!selectedDocId) return;
    runMatchIndex({
      documentId: selectedDocId,
      confidence_threshold: threshold,
      source_table: tableName,
    });
  }

  function startIndexAndMatch(tableName: string, pkColumn: string) {
    if (!selectedDocId) return;
    setIndexStateByTable((prev) => ({ ...prev, [tableName]: { state: "indexing" } }));
    importDbTable(
      { tableName, pkColumn, rowLimit: undefined },
      {
        onSuccess: () => {
          setIndexStateByTable((prev) => ({ ...prev, [tableName]: { state: "indexed" } }));
          runMatchForTable(tableName);
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : e ? "Index failed" : "Index failed";
          setIndexStateByTable((prev) => ({ ...prev, [tableName]: { state: "error", message: msg } }));
        },
      },
    );
  }

  function selectDbTable(tableName: string) {
    setSelectedDbTable(tableName);
    setActiveTable(tableName || null);
    if (!tableName) return;
    const pk = pkByTable[tableName];
    if (pk) return;
    setPkModalTable(tableName);
    setPkModalValue("");
    setPkModalOpen(true);
  }

  useEffect(() => {
    try {
      localStorage.setItem(PK_STORAGE_KEY, JSON.stringify(pkByTable));
    } catch {
      return;
    }
  }, [pkByTable]);

  useEffect(() => {
    if (!selectedDbTable) return;
    if (!isTableIndexed(selectedDbTable)) return;
    setIndexStateByTable((prev) => ({ ...prev, [selectedDbTable]: { state: "indexed" } }));
  }, [indexedTables, selectedDbTable]);

  function selectShown() {
    if (!displayRows.length) return;
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      for (const r of displayRows) next.add(rowKey(r));
      return next;
    });
  }

  function clearSelection() {
    setSelectedRowKeys(new Set());
  }

  return (
    <div className="space-y-5">
      {pkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-800">Select primary key</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Choose the unique identifier column for <span className="font-mono text-slate-700">{pkModalTable}</span>.
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block text-xs font-medium text-slate-600">PK column</label>
              <select
                value={pkModalValue}
                onChange={(e) => setPkModalValue(e.target.value)}
                disabled={loadingPkCols}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
              >
                <option value="">{loadingPkCols ? "Loading columns…" : "— Select PK column —"}</option>
                {pkColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPkModalOpen(false);
                  setPkModalTable("");
                  setPkModalValue("");
                }}
                className="px-3 py-2 rounded-xl text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!pkModalTable || !pkModalValue}
                onClick={() => {
                  const tableName = pkModalTable;
                  const pk = pkModalValue;
                  setPkByTable((prev) => ({ ...prev, [tableName]: pk }));
                  setPkModalOpen(false);
                  setPkModalTable("");
                  setPkModalValue("");
                  if (selectedDocId) startIndexAndMatch(tableName, pk);
                }}
                className="px-3 py-2 rounded-xl text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Match document to schema rows</h3>

        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          <button
            type="button"
            onClick={() => setMode("index")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === "index" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Database size={12} />
            Indexed tables
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === "file" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <FileSpreadsheet size={12} />
            Upload file
          </button>
        </div>

        {/* Document selector */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Document</label>
          {indexedDocs.length === 0 ? (
            <p className="text-xs text-slate-400">No indexed documents — upload one in the Documents tab.</p>
          ) : (
            <select
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={selectedDocId}
              onChange={(e) => setSelectedDocId(e.target.value)}
            >
              <option value="">— Select a document —</option>
              {indexedDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name} ({d.num_chunks} chunks)
                </option>
              ))}
            </select>
          )}
        </div>

        {mode === "index" ? (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Database table (auto-indexed)</label>
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
                value={selectedDbTable}
                onChange={(e) => selectDbTable(e.target.value)}
                disabled={loadingDbTables}
              >
                <option value="">{loadingDbTables ? "Loading tables…" : "— Select a table —"}</option>
                {dbTables.map((t) => (
                  <option key={t.table_name} value={t.table_name}>
                    {t.table_name}{t.row_count != null ? ` (${t.row_count.toLocaleString()} rows)` : ""}
                    {isTableIndexed(t.table_name) ? " · indexed" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!selectedDbTable) return;
                  setPkModalTable(selectedDbTable);
                  setPkModalValue(pkByTable[selectedDbTable] ?? "");
                  setPkModalOpen(true);
                }}
                disabled={!selectedDbTable}
                className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 disabled:opacity-50 transition-colors"
                title="Change primary key"
              >
                PK
              </button>
              <button
                type="button"
                onClick={() => selectDbTable(selectedDbTable)}
                disabled={!selectedDbTable || !pkByTable[selectedDbTable] || !selectedDocId}
                className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 disabled:opacity-50 transition-colors"
                title="Re-run match"
              >
                <Play size={14} />
              </button>
            </div>
            {selectedDbTable && pkByTable[selectedDbTable] && (
              <div className="mt-1 text-[11px] text-slate-500">
                PK: <span className="font-mono text-slate-700">{pkByTable[selectedDbTable]}</span>
              </div>
            )}
            {selectedDbTable && (
              <div className="mt-1 text-[11px] flex items-center gap-2">
                {(() => {
                  const s = indexStateByTable[selectedDbTable]?.state ?? (isTableIndexed(selectedDbTable) ? "indexed" : "idle");
                  if (s === "indexing") {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-amber-700">
                        <Spinner size={11} /> Indexing in background…
                      </span>
                    );
                  }
                  if (s === "error") {
                    return (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-red-600">
                          <AlertCircle size={12} /> Index failed
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const pk = pkByTable[selectedDbTable];
                            if (!pk) {
                              setPkModalTable(selectedDbTable);
                              setPkModalValue(pkByTable[selectedDbTable] ?? "");
                              setPkModalOpen(true);
                              return;
                            }
                            startIndexAndMatch(selectedDbTable, pk);
                          }}
                          className="text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          Retry
                        </button>
                        {indexStateByTable[selectedDbTable]?.message ? (
                          <span className="text-slate-400 truncate">
                            {indexStateByTable[selectedDbTable]?.message}
                          </span>
                        ) : null}
                      </>
                    );
                  }
                  if (pendingIndex) {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-indigo-700">
                        <Spinner size={11} /> Matching…
                      </span>
                    );
                  }
                  if (isTableIndexed(selectedDbTable)) {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700">
                        <CheckCircle2 size={12} className="text-emerald-600" /> Indexed
                      </span>
                    );
                  }
                  return (
                    <span className="text-slate-400">
                      Select PK to start background indexing.
                    </span>
                  );
                })()}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-500">
              When you select a table, indexing happens in the background and matching runs automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Row file (CSV / Excel)</label>
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors">
                  <input
                    type="file"
                    className="hidden"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => setFileRows(e.target.files?.[0] ?? null)}
                  />
                  {fileRows ? fileRows.name : "Click to choose a file"}
                </label>
                {fileRows && (
                  <button
                    type="button"
                    onClick={() => setFileRows(null)}
                    className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-400 transition-colors"
                    title="Remove file"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">PK column (optional)</label>
                <input
                  value={filePkColumn}
                  onChange={(e) => setFilePkColumn(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. asset_code"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Source table (optional)</label>
                <input
                  value={fileSourceTable}
                  onChange={(e) => setFileSourceTable(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. assets"
                />
              </div>
            </div>
          </div>
        )}

        {/* Confidence threshold */}
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Confidence threshold</span>
          <input type="range" min={0} max={1} step={0.05} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))} className="flex-1 accent-indigo-600" />
          <span className="text-xs font-bold text-slate-700 tabular-nums w-10 text-right">{(threshold * 100).toFixed(0)}%</span>
        </div>

        {errMsg && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{errMsg}</span>
          </div>
        )}

        {confirmErrMsg && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{confirmErrMsg}</span>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (!selectedDocId) return;
              if (mode === "index") {
                if (!selectedDbTable) return;
                const pk = pkByTable[selectedDbTable];
                if (!pk) {
                  selectDbTable(selectedDbTable);
                  return;
                }
                startIndexAndMatch(selectedDbTable, pk);
                return;
              }
              if (!fileRows) return;
              runMatchFile({
                documentId: selectedDocId,
                file: fileRows,
                pk_column: filePkColumn.trim() ? filePkColumn.trim() : null,
                source_table: fileSourceTable.trim() ? fileSourceTable.trim() : null,
                confidence_threshold: threshold,
                group_by_table: true,
              });
            }}
            disabled={isPending || !selectedDocId || (mode === "file" && !fileRows) || (mode === "index" && !selectedDbTable)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? <Spinner size={14} /> : <Play size={14} />}
            {isPending ? "Working…" : "Run match"}
          </button>

          <button
            type="button"
            onClick={() => {
              if (!selectedDocId || !hasSelection) return;
              confirmMatches({
                documentId: selectedDocId,
                rows: selectedRows.map((r) => ({ source_table: r.source_table, row_pk: r.row_pk })),
              });
            }}
            disabled={confirming || !selectedDocId || !hasSelection}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {confirming ? <Spinner size={13} /> : <CheckCircle2 size={13} />}
            {confirming ? "Confirming…" : `Confirm matches (${selectedRows.length})`}
          </button>

          {confirmResult && (
            <span className="text-[11px] text-emerald-700">
              Updated {confirmResult.rows_updated} row{confirmResult.rows_updated === 1 ? "" : "s"}
              {confirmResult.rows_not_found > 0 ? ` · not found: ${confirmResult.rows_not_found}` : ""}
            </span>
          )}
        </div>

        {confirmResult && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-emerald-800 font-semibold">
              <CheckCircle2 size={14} className="text-emerald-600" />
              Confirmed matches saved
              <span className="ml-auto text-[11px] text-emerald-700 font-mono">{confirmResult.document_id}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(confirmResult.by_table).map(([t, c]) => (
                <span key={t} className="text-[11px] bg-white/60 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                  {t} <span className="opacity-70">{c}</span>
                </span>
              ))}
              {confirmResult.columns_created && confirmResult.columns_created.length > 0 && (
                <span className="text-[11px] bg-white/60 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                  columns created: {confirmResult.columns_created.join(", ")}
                </span>
              )}
            </div>
          </div>
        )}

      </div>

      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-4 flex-wrap px-1">
            <div className="flex items-center gap-1.5">
              <Link2 size={13} className="text-slate-400" />
              <span className="text-sm font-bold text-slate-800">{result.unique_rows_matched}</span>
              <span className="text-sm text-slate-500">rows matched</span>
            </div>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">{result.total_chunks_analyzed} chunks analyzed</span>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">{result.latency_ms} ms</span>
          </div>

          {/* Table filter pills */}
          {Object.keys(result.by_table).length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setActiveTable(null)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeTable === null ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTable === null ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"}`}>{result.unique_rows_matched}</span>
              </button>
              {Object.entries(result.by_table).map(([tbl, cnt]) => (
                <button
                  key={tbl}
                  type="button"
                  onClick={() => setActiveTable(tbl)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    activeTable === tbl ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tbl} <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTable === tbl ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"}`}>{cnt}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">
              Selected <span className="font-semibold text-slate-700">{selectedRows.length}</span>
            </span>
            {Object.entries(selectedByTable).map(([t, c]) => (
              <span key={t} className="text-[11px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
                {t} <span className="opacity-70">{c}</span>
              </span>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <div className="flex gap-1 bg-slate-100 rounded-full p-1">
                <button
                  type="button"
                  onClick={() => setResultView("rows")}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    resultView === "rows" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  Rows
                </button>
                <button
                  type="button"
                  onClick={() => setResultView("chunks")}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    resultView === "chunks" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  Chunks
                </button>
              </div>
              <button
                type="button"
                onClick={selectShown}
                disabled={!result || displayRows.length === 0}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-colors"
              >
                Select shown ({displayRows.length})
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedRows.length === 0}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Clear selection
              </button>
            </div>
          </div>

          {resultView === "rows" ? (
            <>
              {/* Row cards */}
              {displayRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
                  <Link2 size={24} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-sm text-slate-400">No rows matched above the threshold</p>
                  <p className="text-xs text-slate-400 mt-1">Try lowering the confidence threshold</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {displayRows.map((row, i) => (
                    <RowCard
                      key={`${row.source_table}-${row.row_pk}-${i}`}
                      row={row}
                      selectable
                      selected={selectedRowKeys.has(rowKey(row))}
                      onToggle={toggleRowSelection}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {chunksView.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
                  <Layers size={24} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-sm text-slate-400">No chunk matches available</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {chunksView.map((c) => (
                    <div key={c.chunk_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800">
                            Chunk #{c.chunk_index}{c.page_number != null ? ` · p.${c.page_number}` : ""}
                          </span>
                          <span className="text-xs text-slate-400">
                            top {(c.max_conf * 100).toFixed(0)}%
                          </span>
                          <span className="ml-auto text-xs text-slate-500">
                            {c.matches.length} row{c.matches.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                          {c.preview}
                        </p>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {c.matches.map((m) => (
                          <div key={`${m.source_table}-${m.row_pk}`} className="px-4 py-3 flex items-start gap-3">
                            <div
                              role="checkbox"
                              aria-checked={selectedRowKeys.has(`${m.source_table}::${m.row_pk}`)}
                              tabIndex={0}
                              onClick={() => toggleRowKey(m.source_table, m.row_pk)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleRowKey(m.source_table, m.row_pk);
                                }
                              }}
                              className={`mt-0.5 shrink-0 rounded-full border w-4 h-4 flex items-center justify-center outline-none focus:ring-2 focus:ring-indigo-400 ${
                                selectedRowKeys.has(`${m.source_table}::${m.row_pk}`) ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white"
                              }`}
                            >
                              {selectedRowKeys.has(`${m.source_table}::${m.row_pk}`) && <Check size={10} className="text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm font-bold text-slate-800">{m.row_pk}</span>
                                <span className="text-xs text-slate-400">{m.source_table}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${METHOD_COLOR[m.match_method] ?? "bg-slate-100 text-slate-600"}`}>
                                  {m.match_method.replace(/_/g, " ")}
                                </span>
                                <span className="text-xs font-bold text-slate-600 tabular-nums">{(m.confidence * 100).toFixed(0)}%</span>
                              </div>
                              {m.matched_fields.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {m.matched_fields.map((f) => (
                                    <span key={f} className="text-[11px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
                                      {f}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {previewTableName && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <Database size={14} className="text-slate-500" />
            <div className="text-sm font-semibold text-slate-800">Table preview</div>
            <div className="text-xs text-slate-500 font-mono">{previewTableName}</div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchIndexRows({ tableName: previewTableName, limit: 50, offset: 0 })}
                disabled={fetchingIndexRows}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {fetchingIndexRows ? <Spinner size={12} /> : <RefreshCw size={12} />}
                Refresh
              </button>
            </div>
          </div>

          <div className="px-4 py-3">
            {fetchingIndexRows && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Spinner size={12} />
                Loading rows…
              </div>
            )}

            {!fetchingIndexRows && !!indexRowsError && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <span className="text-xs text-red-700">
                  {indexRowsError instanceof Error ? indexRowsError.message : "Failed to load rows"}
                </span>
              </div>
            )}

            {!fetchingIndexRows && !indexRowsError && previewRows.length > 0 && (
              <div className="overflow-auto">
                <div className="mb-2 text-[11px] text-slate-500">
                  Showing {previewRows.length} row{previewRows.length === 1 ? "" : "s"}
                  {confirmedPkSet.size > 0 ? ` · highlighted: ${confirmedPkSet.size}` : ""}
                </div>
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3 font-semibold">row_pk</th>
                      {previewColumns.map((c) => (
                        <th key={c} className="py-2 pr-3 font-semibold whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {previewRows.map((r) => (
                      <tr key={r.row_pk} className={confirmedPkSet.has(r.row_pk) ? "bg-emerald-50" : ""}>
                        <td className="py-2 pr-3 font-mono text-slate-800 whitespace-nowrap">{r.row_pk}</td>
                        {previewColumns.map((c) => (
                          <td key={c} className="py-2 pr-3 text-slate-700 whitespace-nowrap">
                            {String((r.row_data ?? {})[c] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {confirmedPkSet.size > 0 && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Highlighted rows are the ones you confirmed.
                  </div>
                )}
              </div>
            )}

            {!fetchingIndexRows && !indexRowsError && previewRows.length === 0 && (
              <div className="text-xs text-slate-400">No rows found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Data Index tab ─────────────────────────────────────────────────────────────

function _IndexTab() {
  const { data: tables = [], isLoading, refetch } = useRowIndexTables();
  const { data: dbTablesData, isLoading: loadingDbTables } = useDbTables();
  const dbTables = dbTablesData?.tables ?? [];
  const [selectedTable, setSelectedTable] = useState("");
  const { data: columns = [] } = useDbTableColumns(selectedTable, { enabled: !!selectedTable });
  const [pkColumn, setPkColumn] = useState("");
  const [rowLimit, setRowLimit] = useState<string>("");
  const [showImport, setShowImport] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  const { mutate: importTable, isPending: importing, error: importErr, data: importResult } = useImportDbTable({
    onSuccess: () => { void refetch(); },
  });

  const { mutate: uploadIndex, isPending: uploading, error: uploadErr, data: uploadResult } = useUploadRowIndex({
    onSuccess: () => { void refetch(); },
  });

  const { mutate: deleteTable, isPending: deleting, error: deleteErr } = useDeleteRowIndexTable({
    onSuccess: () => { void refetch(); },
  });

  const importErrMsg = importErr instanceof Error ? importErr.message : importErr ? "Import failed" : null;
  const uploadErrMsg = uploadErr instanceof Error ? uploadErr.message : uploadErr ? "Upload failed" : null;
  const deleteErrMsg = deleteErr instanceof Error ? deleteErr.message : deleteErr ? "Delete failed" : null;

  function handleTableSelect(tbl: string) {
    setSelectedTable(tbl);
    setPkColumn("");
  }

  function handleImport() {
    if (!selectedTable || !pkColumn) return;
    const parsed = rowLimit.trim() ? Number(rowLimit) : undefined;
    importTable({ tableName: selectedTable, pkColumn, rowLimit: parsed != null && Number.isFinite(parsed) ? parsed : undefined });
  }

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTableName, setUploadTableName] = useState("");
  const [uploadPkColumn, setUploadPkColumn] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function handleUpload() {
    if (!uploadFile || !uploadTableName.trim() || !uploadPkColumn.trim()) return;
    uploadIndex({ file: uploadFile, tableName: uploadTableName.trim(), pkColumn: uploadPkColumn.trim() });
  }

  return (
    <div className="space-y-5">
      {/* Import from DB */}
      <div className="rounded-2xl border border-indigo-200 bg-white p-5">
        <button
          type="button"
          onClick={() => setShowImport((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Server size={14} className="text-indigo-600" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Import from database</span>
            <span className="text-[11px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">recommended</span>
          </div>
          {showImport ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </button>

        {showImport && (
          <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs text-slate-500">
              Import a table from the connected CAFM database directly into the row index. Rows are upserted so you can re-import to refresh.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Database table</label>
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={selectedTable}
                  onChange={(e) => handleTableSelect(e.target.value)}
                  disabled={loadingDbTables}
                >
                  <option value="">{loadingDbTables ? "Loading tables…" : "— Select a table —"}</option>
                  {dbTables.map((t) => (
                    <option key={t.table_name} value={t.table_name}>
                      {t.table_name}{t.row_count != null ? ` (${t.row_count.toLocaleString()} rows)` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => { void refetch(); }} className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-400 transition-colors">
                  <RefreshCw size={13} className={loadingDbTables ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            {selectedTable && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Primary key column</label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={pkColumn}
                  onChange={(e) => setPkColumn(e.target.value)}
                >
                  <option value="">— Select PK column —</option>
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Row limit (optional)</label>
                <input
                  value={rowLimit}
                  onChange={(e) => setRowLimit(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. 10000"
                  inputMode="numeric"
                />
              </div>
            </div>

            {importErrMsg && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <span className="text-xs text-red-700">{importErrMsg}</span>
              </div>
            )}

            {importResult && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-800">Import complete</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-emerald-700">
                  <span>Table: <span className="font-medium">{importResult.table_name}</span></span>
                  <span>PK: <span className="font-medium">{importResult.pk_column}</span></span>
                  <span>Inserted: <span className="font-medium">{importResult.rows_inserted}</span></span>
                  <span>Updated: <span className="font-medium">{importResult.rows_updated}</span></span>
                  <span className="col-span-2">Total rows: <span className="font-medium">{importResult.total_rows_in_index}</span></span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleImport}
              disabled={!selectedTable || !pkColumn || importing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {importing ? <Spinner size={14} /> : <Server size={14} />}
              {importing ? "Importing…" : "Import & index"}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <button
          type="button"
          onClick={() => setShowUpload((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <Upload size={14} className="text-slate-600" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Upload CSV / Excel to index</span>
          </div>
          {showUpload ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </button>

        {showUpload && (
          <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">File</label>
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors">
                  <input
                    type="file"
                    className="hidden"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                  {uploadFile ? uploadFile.name : "Click to choose a file"}
                </label>
                {uploadFile && (
                  <button
                    type="button"
                    onClick={() => setUploadFile(null)}
                    className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-400 transition-colors"
                    title="Remove file"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Table name</label>
                <input
                  value={uploadTableName}
                  onChange={(e) => setUploadTableName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. assets"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">PK column</label>
                <input
                  value={uploadPkColumn}
                  onChange={(e) => setUploadPkColumn(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. asset_code"
                />
              </div>
            </div>

            {uploadErrMsg && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <span className="text-xs text-red-700">{uploadErrMsg}</span>
              </div>
            )}

            {uploadResult && (
              <IndexUploadResultCard title="Upload complete" result={uploadResult} />
            )}

            <button
              type="button"
              onClick={handleUpload}
              disabled={!uploadFile || !uploadTableName.trim() || !uploadPkColumn.trim() || uploading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-black disabled:opacity-50 transition-colors"
            >
              {uploading ? <Spinner size={14} /> : <Upload size={14} />}
              {uploading ? "Uploading…" : "Upload & index"}
            </button>
          </div>
        )}
      </div>

      {/* Indexed tables */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Indexed tables</h3>
          <button type="button" onClick={() => { void refetch(); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>

        {deleteErrMsg && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 mb-3">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{deleteErrMsg}</span>
          </div>
        )}

        {tables.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
            <Database size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No tables indexed yet</p>
            <p className="text-xs text-slate-400 mt-1">Import a database table above to get started</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {tables.map((t) => (
              <div key={t.source_table} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <Database size={13} className="text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-slate-800 font-mono">{t.source_table}</span>
                  <span className="ml-2 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                    {t.row_count.toLocaleString()} rows
                  </span>
                </div>
                {confirmDelete !== t.source_table ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(t.source_table)}
                    className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                    title="Delete indexed table"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Delete?</span>
                    <button
                      type="button"
                      onClick={() => deleteTable({ tableName: t.source_table })}
                      disabled={deleting}
                      className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? "…" : "Yes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IndexUploadResultCard({ title, result }: { title: string; result: RowIndexUploadResponse }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <CheckCircle2 size={14} className="text-emerald-600" />
        <span className="text-sm font-semibold text-emerald-800">{title}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs text-emerald-700">
        <span>Table: <span className="font-medium">{result.table_name}</span></span>
        <span>PK: <span className="font-medium">{result.pk_column}</span></span>
        <span>Inserted: <span className="font-medium">{result.rows_inserted}</span></span>
        <span>Updated: <span className="font-medium">{result.rows_updated}</span></span>
        <span className="col-span-2">Total rows: <span className="font-medium">{result.total_rows_in_index}</span></span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DocRagContent({
  initialDocumentId,
  onReset,
  onSidebarChunkLogsChange,
}: {
  initialDocumentId?: string | null;
  onReset: () => void;
  onSidebarChunkLogsChange?: (logs: DocRagSidebarChunkLog[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("documents");
  const [selectedDocId, setSelectedDocId] = useState<string>(initialDocumentId ?? "");
  const [shouldPoll, setShouldPoll] = useState(!!initialDocumentId);
  const [expandedView, setExpandedView] = useState(!initialDocumentId);

  const { data: docs = [] } = useDocList({ refetchInterval: shouldPoll ? 2000 : false });

  const initialDoc = docs.find((d) => d.id === initialDocumentId) ?? null;
  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null;

  useEffect(() => {
    if (!initialDocumentId) return;
    setSelectedDocId(initialDocumentId);
    setShouldPoll(true);
    setExpandedView(false);
  }, [initialDocumentId]);

  useEffect(() => {
    if (!initialDocumentId || !initialDoc) return;
    if (initialDoc.status === "indexed" || initialDoc.status === "error") {
      setShouldPoll(false);
    }
  }, [initialDoc?.status, initialDocumentId]);

  const focusedMode = !!initialDocumentId && !expandedView;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-rose-100 flex items-center justify-center">
              <FileText size={14} className="text-rose-600" />
            </div>
            <span className="text-sm font-semibold text-slate-800">PDF / Word Extraction</span>
          </div>
          {selectedDoc && (
            <div className="mt-1 text-xs text-slate-500 flex items-center gap-2">
              <span className="font-medium text-slate-700">{selectedDoc.file_name}</span>
              <span className="text-slate-300">·</span>
              <span>{selectedDoc.num_pages} pages · {selectedDoc.num_chunks} chunks</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
        >
          <RotateCcw size={11} />
          New
        </button>
      </div>

      {/* Extraction progress — visible while initial doc is processing or as a success summary */}
      {initialDoc && <ExtractionProgress doc={initialDoc} />}

      {focusedMode ? (
        /* Focused view — the chat just uploaded this doc, keep it visually alone. */
        <div className="flex items-center justify-between gap-3 px-1 pt-1">
          <span className="text-[11px] text-slate-400">
            Continue in chat to ask about this document, or
          </span>
          <button
            type="button"
            onClick={() => setExpandedView(true)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <Layers size={11} />
            Browse library
          </button>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex gap-0.5 bg-slate-100 rounded-xl p-1 w-fit">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === t.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className={tab === "documents" ? "" : "hidden"}>
            <DocumentsTab
              selectedId={selectedDocId}
              onSelect={setSelectedDocId}
              initialDocId={initialDocumentId ?? undefined}
              onGoToMatch={() => setTab("match")}
            />
          </div>
          <div className={tab === "match" ? "" : "hidden"}>
            <MatchTab docs={docs} onSidebarChunkLogsChange={onSidebarChunkLogsChange} />
          </div>
          <div className={tab === "extract" ? "" : "hidden"}>
            <QueryTab />
          </div>
        </>
      )}
    </div>
  );
}
