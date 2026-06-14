 "use client";
 
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
 import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
 import { FileText, Plus, Pencil, Trash2, Link as LinkIcon } from "lucide-react";
 
 import { Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from "@/components/ui";
 import { FileUpload } from "@/components/ui/file-upload";
 import { apiFetch, ApiError } from "@/services/api";
 import { ConfirmDialog } from "@/components/common";
 
 type AssetDocument = {
   id: string;
   asset_id: string;
   file_url: string;
   document_type: string;
   uploaded_by?: string | null;
   created_at?: string;
   updated_at?: string;
 };
 
 type DocsPage = { total: number; limit: number; offset: number; data: AssetDocument[] };
 
 const DEFAULT_PAGE_SIZE = 5;
 const DUMMY_UPLOADED_BY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
 
 function getErrorMessage(err: unknown): string {
   if (err instanceof ApiError) {
     const p = err.payload as unknown;
     if (typeof p === "object" && p !== null) {
       const r = p as Record<string, unknown>;
       if (typeof r.detail === "string" && r.detail.trim()) return r.detail;
     }
     return err.message;
   }
   if (err instanceof Error) return err.message || "Something went wrong";
   return "Something went wrong";
 }
 
 async function fetchDocuments(input: {
   assetId: string;
   limit: number;
   offset: number;
   signal?: AbortSignal;
 }): Promise<DocsPage> {
   const params = new URLSearchParams();
   params.set("limit", String(input.limit));
   params.set("offset", String(input.offset));
   params.set("asset_id", input.assetId);
   const payload = await apiFetch<unknown>(`/api/v1/plenum/asset-documents?${params.toString()}`, {
     signal: input.signal,
   });
   if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
   const obj = payload as Record<string, unknown>;
   const total = typeof obj.total === "number" ? obj.total : 0;
   const limit = typeof obj.limit === "number" ? obj.limit : input.limit;
   const offset = typeof obj.offset === "number" ? obj.offset : input.offset;
   const raw = Array.isArray(obj.data) ? obj.data : [];
   const data: AssetDocument[] = raw
     .map((x): AssetDocument | null => {
       if (typeof x !== "object" || x === null) return null;
       const r = x as Record<string, unknown>;
       const id = typeof r.id === "string" ? r.id : "";
       const asset_id = typeof r.asset_id === "string" ? r.asset_id : "";
       const file_url = typeof r.file_url === "string" ? r.file_url : "";
       const document_type =
         typeof r.document_type === "string" ? r.document_type : typeof r.type === "string" ? r.type : "";
       if (!id || !asset_id || !file_url) return null;
       return {
         id,
         asset_id,
         file_url,
         document_type,
         uploaded_by: typeof r.uploaded_by === "string" ? r.uploaded_by : null,
         created_at: typeof r.created_at === "string" ? r.created_at : undefined,
         updated_at: typeof r.updated_at === "string" ? r.updated_at : undefined,
       };
     })
     .filter((v): v is AssetDocument => Boolean(v));
   return { total, limit, offset, data };
 }
 
 function DocModal({
   open,
   mode,
   pending,
   initial,
   onClose,
   onSubmit,
 }: {
   open: boolean;
   mode: "create" | "edit";
   pending: boolean;
   initial?: { file_url: string; document_type: string };
   onClose: () => void;
  onSubmit: (v: { file_url: string; document_type: string; file: File | null }) => void;
 }) {
   const [file, setFile] = useState<File | null>(null);
   const [fileUrl, setFileUrl] = useState(initial?.file_url ?? "");
   const [docType, setDocType] = useState(initial?.document_type ?? "");
   const [error, setError] = useState<string | null>(null);
 
   useEffect(() => {
     if (!open) return;
     setFile(null);
     setFileUrl(initial?.file_url ?? "");
     setDocType(initial?.document_type ?? "");
     setError(null);
  }, [initial?.document_type, initial?.file_url, open]);
 
   if (!open) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div className="relative w-full max-w-lg rounded-xl border bg-card shadow-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 pt-5">
          <div className="text-base font-semibold">{mode === "create" ? "Add Document" : "Edit Document"}</div>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Upload File</label>
              <FileUpload
                value={file}
                onChange={(f) => {
                  setFile(f);
                  if (f) setFileUrl(f.name);
                }}
                accept="*"
                maxSize={20 * 1024 * 1024} // 20MB
                title="Click or drag a file to upload"
                description="Supports any file type up to 20MB"
              />
              {mode === "edit" && !file && fileUrl ? (
                <p className="text-xs text-muted-foreground mt-1 truncate">Current: {fileUrl}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Or File URL (Optional)</label>
              <Input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Document Type</label>
              <Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="e.g. Manual" />
            </div>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">
          <Button variant="secondary" type="button" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              const f = fileUrl.trim();
              const t = docType.trim();
              if (!f || !t) {
                setError("File (or File URL) and Document Type are required.");
                return;
              }
              setError(null);
              onSubmit({ file_url: f, document_type: t, file });
            }}
          >
            {pending ? "Saving..." : mode === "create" ? "Create" : "Save"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
 }
 
 export function AssetDocumentsPanel({ assetId }: { assetId: string }) {
   const queryClient = useQueryClient();
   const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
 
   const [modalOpen, setModalOpen] = useState(false);
   const [modalMode, setModalMode] = useState<"create" | "edit">("create");
   const [editing, setEditing] = useState<AssetDocument | null>(null);
 
   const [confirmOpen, setConfirmOpen] = useState(false);
   const [deleting, setDeleting] = useState<AssetDocument | null>(null);
 
  const docsQuery = useInfiniteQuery<DocsPage, Error, import("@tanstack/react-query").InfiniteData<DocsPage>, string[], number>({
    queryKey: ["asset-documents", assetId],
    initialPageParam: 0,
    retry: 0,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: ({ pageParam }) =>
      fetchDocuments({
        assetId,
        limit: DEFAULT_PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
  });
 
   useEffect(() => {
    if (!docsQuery.isError) return;
     toast({
       title: "Failed to load documents",
       description: getErrorMessage(docsQuery.error),
       variant: "destructive",
     });
   }, [docsQuery.error, docsQuery.isError]);
 
  const createMutation = useMutation<void, unknown, { file_url: string; document_type: string; file: File | null }>(
     {
       mutationFn: async (v) => {
         // Note: If you have an endpoint to upload the file and get a URL, you would call it here:
         // let finalUrl = v.file_url;
         // if (v.file) {
         //   const fd = new FormData();
         //   fd.append("file", v.file);
         //   const res = await fetch("/api/upload", { method: "POST", body: fd });
         //   const data = await res.json();
         //   finalUrl = data.url;
         // }
         
         await apiFetch("/api/v1/plenum/asset-documents", {
           method: "POST",
           headers: { Accept: "application/json", "Content-Type": "application/json" },
           body: {
             asset_id: assetId,
             file_url: v.file_url, // For now, we just pass the file name or URL string
             document_type: v.document_type,
             uploaded_by: DUMMY_UPLOADED_BY,
           },
         });
       },
       onSuccess: async () => {
         toast({ title: "Document added", variant: "success" });
         setModalOpen(false);
        await queryClient.invalidateQueries({ queryKey: ["asset-documents", assetId] });
       },
       onError: (e) => {
         toast({ title: "Failed to add document", description: getErrorMessage(e), variant: "destructive" });
       },
     },
   );
 
   const updateMutation = useMutation<void, unknown, { id: string; file_url: string; document_type: string; file: File | null }>(
     {
       mutationFn: async (v) => {
         // let finalUrl = v.file_url;
         // if (v.file) { ... upload and get url ... }

         await apiFetch(`/api/v1/plenum/asset-documents/${encodeURIComponent(v.id)}`, {
           method: "PUT",
           headers: { Accept: "application/json", "Content-Type": "application/json" },
           body: { file_url: v.file_url, document_type: v.document_type },
         });
       },
       onSuccess: async () => {
         toast({ title: "Document updated", variant: "success" });
         setModalOpen(false);
        await queryClient.invalidateQueries({ queryKey: ["asset-documents", assetId] });
       },
       onError: (e) => {
         toast({ title: "Failed to update document", description: getErrorMessage(e), variant: "destructive" });
       },
     },
   );
 
   const deleteMutation = useMutation<void, unknown, { id: string }>({
     mutationFn: async ({ id }) => {
       await apiFetch(`/api/v1/plenum/asset-documents/${encodeURIComponent(id)}`, {
         method: "DELETE",
         headers: { Accept: "application/json" },
       });
     },
     onSuccess: async () => {
       toast({ title: "Document deleted", variant: "success" });
       setConfirmOpen(false);
       setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ["asset-documents", assetId] });
     },
     onError: (e) => {
       toast({ title: "Failed to delete document", description: getErrorMessage(e), variant: "destructive" });
     },
   });
 
  const docs = docsQuery.data?.pages.flatMap((p) => p.data) ?? [];
   const filtered = useMemo(() => {
     const q = search.trim().toLowerCase();
     if (!q) return docs;
     return docs.filter(
       (d) => d.document_type.toLowerCase().includes(q) || d.file_url.toLowerCase().includes(q),
     );
   }, [docs, search]);
 
  const total = docsQuery.data?.pages[0]?.total ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      const node = scrollRef.current;
      if (!node) return;
      if (!docsQuery.hasNextPage || docsQuery.isFetchingNextPage) return;
      const nearBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 24;
      if (nearBottom) void docsQuery.fetchNextPage();
    }
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [docsQuery]);
 
   return (
    <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
         <div className="flex items-center gap-2 p-4">
           <FileText className="h-5 w-5 text-primary" />
           <CardTitle className="text-lg">Documents</CardTitle>
         </div>
      <CardHeader className="flex flex-row items-center justify-between pb-2 px-5">
         <div className="flex items-center gap-2">
          <div className="hidden sm:block w-[220px]">
             <Input placeholder="Search documents..." value={search} onChange={(e) => setSearch(e.target.value)} />
           </div>
           <Button
            type="button"
             className="gap-2"
             onClick={() => {
               setModalMode("create");
               setEditing(null);
               setModalOpen(true);
             }}
           >
             <Plus className="h-4 w-4" />
             <span className="hidden sm:inline">Add</span>
           </Button>
         </div>
       </CardHeader>
       <CardContent className="space-y-3">
        <div ref={scrollRef} className="divide-y rounded-lg border bg-background max-h-[360px] overflow-y-auto">
           {filtered.length === 0 ? (
             <div className="p-4 text-sm text-muted-foreground">No documents found.</div>
           ) : (
             filtered.map((d) => (
               <div key={d.id} className="flex items-center justify-between p-3 hover:bg-muted/40">
                 <div className="flex items-center gap-3 min-w-0">
                   <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                     <FileText className="h-4 w-4" />
                   </div>
                   <div className="min-w-0">
                     <div className="text-sm font-bold truncate">{d.document_type || "Document"}</div>
                     <a
                       href={d.file_url}
                       target="_blank"
                       rel="noreferrer"
                       className="text-xs text-primary flex items-center gap-1 truncate"
                       title={d.file_url}
                     >
                       <LinkIcon className="h-3 w-3" />
                       {d.file_url}
                     </a>
                   </div>
                 </div>
                 <div className="flex items-center gap-2 shrink-0">
                   <Button
                     size="icon"
                     variant="outline"
                     title="Edit"
                     aria-label="Edit"
                     onClick={() => {
                       setModalMode("edit");
                       setEditing(d);
                       setModalOpen(true);
                     }}
                   >
                     <Pencil className="h-4 w-4" />
                   </Button>
                   <Button
                     size="icon"
                     variant="destructive"
                     title="Delete"
                     aria-label="Delete"
                     onClick={() => {
                       setDeleting(d);
                       setConfirmOpen(true);
                     }}
                   >
                     <Trash2 className="h-4 w-4" />
                   </Button>
                 </div>
               </div>
             ))
           )}
          {docsQuery.isFetchingNextPage ? (
            <div className="p-3 text-xs text-muted-foreground">Loading more…</div>
          ) : null}
         </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">Showing {docs.length} of {total}</div>
          {docsQuery.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={docsQuery.isFetchingNextPage}
              onClick={() => docsQuery.fetchNextPage()}
            >
              {docsQuery.isFetchingNextPage ? "Loading..." : "Load more"}
            </Button>
          ) : null}
        </div>
       </CardContent>

       <DocModal
         open={modalOpen}
         mode={modalMode}
         pending={createMutation.isPending || updateMutation.isPending}
         initial={
           editing
            ? { file_url: editing.file_url, document_type: editing.document_type }
             : undefined
         }
         onClose={() => setModalOpen(false)}
         onSubmit={(v) => {
           if (modalMode === "create") {
             createMutation.mutate(v);
           } else if (editing) {
             updateMutation.mutate({ id: editing.id, file_url: v.file_url, document_type: v.document_type, file: v.file });
           }
         }}
       />

       <ConfirmDialog
         open={confirmOpen}
         onOpenChange={setConfirmOpen}
         title="Delete document?"
         description="This action cannot be undone."
         confirmText="Yes, delete"
         cancelText="No"
         pending={deleteMutation.isPending}
         onConfirm={async () => {
           if (!deleting) return;
           await deleteMutation.mutateAsync({ id: deleting.id });
         }}
       />
     </Card>
   );
 }
 
