"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Button, Input, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { apiFetch, ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { getApiErrorMessage } from "@/features/import/wizard/api";
import { Pencil, Trash2 } from "lucide-react";

type AssetCategory = {
  id: string;
  name: string;
  description?: string | null;
};

type AssetCategoryPage = {
  total: number;
  limit: number;
  offset: number;
  data: AssetCategory[];
};

async function fetchAssetCategories(input: {
  limit: number;
  offset: number;
  organizationId?: string;
  signal?: AbortSignal;
}): Promise<AssetCategoryPage> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  if (input.organizationId) params.set("organization_id", input.organizationId);

  const payload = await apiFetch<unknown>(`/api/v1/plenum/asset-categories?${params.toString()}`, {
    signal: input.signal,
  });

  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;

  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset;
  const raw = Array.isArray(obj.data) ? obj.data : [];

  const data: AssetCategory[] = raw
    .map((x): AssetCategory | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      const name = typeof r.name === "string" ? r.name : typeof r.category === "string" ? r.category : "";
      if (!id.trim() || !name.trim()) return null;
      return {
        id,
        name,
        description: typeof r.description === "string" ? r.description : null,
      };
    })
    .filter((v): v is AssetCategory => Boolean(v));

  return { total, limit, offset, data };
}

function extractFastApiMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const p = err.payload as unknown;
    if (typeof p === "object" && p !== null) {
      const rec = p as Record<string, unknown>;
      if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message || "Something went wrong";
  return "Something went wrong";
}

function CategoryModal({
  open,
  mode,
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial?: { name: string; description: string };
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setError(null);
  }, [open, initial?.description, initial?.name]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
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
          <div className="text-base font-semibold">
            {mode === "create" ? "Add Category" : "Edit Category"}
          </div>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HVAC" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
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
              const n = name.trim();
              if (!n) {
                setError("Name is required.");
                return;
              }
              setError(null);
              onSubmit({ name: n, description: description.trim() });
            }}
          >
            {pending ? "Saving..." : mode === "create" ? "Create" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AssetCategoriesGrid() {
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const orgId = orgSelected?.id;

  const [pageSize, setPageSize] = useState(10);
  const [pageOffset, setPageOffset] = useState(0);
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<AssetCategory | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState<AssetCategory | null>(null);

  const listQuery = useQuery<AssetCategoryPage, unknown>({
    queryKey: ["asset-categories-page", orgId, pageSize, pageOffset],
    retry: 0,
    enabled: Boolean(orgId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      fetchAssetCategories({ limit: pageSize, offset: pageOffset, organizationId: orgId, signal }),
  });

  useEffect(() => {
    if (!listQuery.isError) return;
    toast({
      title: "Failed to load categories",
      description: getApiErrorMessage(listQuery.error),
      variant: "destructive",
    });
  }, [listQuery.error, listQuery.isError]);

  const createMutation = useMutation<void, unknown, { name: string; description: string }>({
    mutationFn: async (v) => {
      if (!orgId) throw new Error("Organization is required.");
      await apiFetch("/api/v1/plenum/asset-categories", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: { organization_id: orgId, name: v.name, description: v.description || undefined },
      });
    },
    onSuccess: async () => {
      toast({ title: "Category created", variant: "success" });
      setModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["asset-categories"] });
      await queryClient.invalidateQueries({ queryKey: ["asset-categories-page"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-assets"] });
    },
    onError: (e) => {
      toast({ title: "Failed to create category", description: extractFastApiMessage(e), variant: "destructive" });
    },
  });

  const updateMutation = useMutation<void, unknown, { id: string; name: string; description: string }>({
    mutationFn: async (v) => {
      await apiFetch(`/api/v1/plenum/asset-categories/${encodeURIComponent(v.id)}`, {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: { name: v.name, description: v.description || undefined },
      });
    },
    onSuccess: async () => {
      toast({ title: "Category updated", variant: "success" });
      setModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["asset-categories"] });
      await queryClient.invalidateQueries({ queryKey: ["asset-categories-page"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-assets"] });
    },
    onError: (e) => {
      toast({ title: "Failed to update category", description: extractFastApiMessage(e), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation<void, unknown, { id: string }>({
    mutationFn: async ({ id }) => {
      await apiFetch(`/api/v1/plenum/asset-categories/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
    },
    onSuccess: async () => {
      toast({ title: "Category deleted", variant: "success" });
      setConfirmOpen(false);
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ["asset-categories"] });
      await queryClient.invalidateQueries({ queryKey: ["asset-categories-page"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-assets"] });
      await listQuery.refetch();
    },
    onError: (e) => {
      toast({ title: "Failed to delete category", description: extractFastApiMessage(e), variant: "destructive" });
    },
  });

  const allRows = listQuery.data?.data ?? [];
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q));
  }, [allRows, search]);

  const total = listQuery.data?.total ?? 0;
  const currentPage = Math.floor(pageOffset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns = useMemo<ColDef<AssetCategory>[]>(
    () => [
      { headerName: "Name", field: "name", minWidth: 220, flex: 1 },
      {
        headerName: "Description",
        field: "description",
        minWidth: 320,
        flex: 2,
        valueFormatter: (p) => String(p.value ?? ""),
      },
      {
        headerName: "Actions",
        field: "id",
        width: 180,
        cellRenderer: (p: ICellRendererParams<AssetCategory, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                title="Edit"
                aria-label="Edit"
                className="shadow-none border-0"
                onClick={() => {
                  setModalMode("edit");
                  setEditing(row);
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
                 className="shadow-none border-0 bg-transparent text-red-500 hover:bg-red-500 hover:text-white"
                onClick={() => {
                  setDeleting(row);
                  setConfirmOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [],
  );

  const canPrev = pageOffset > 0;
  const canNext = pageOffset + pageSize < total;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xl font-bold">Asset Categories</div>
          <div className="text-sm text-muted-foreground">Manage asset category master data.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            disabled={!orgId}
            onClick={() => {
              setModalMode("create");
              setEditing(null);
              setModalOpen(true);
            }}
          >
            Add Category
          </Button>
        </div>
      </div>

      {!orgId ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Select organization from header to manage categories.
        </div>
      ) : (
        <>
          <AgDataGrid<AssetCategory>
            rowData={filteredRows}
            columnDefs={columns}
            pagination={false}
            enableQuickFilter={true}
            quickFilterValue={search}
            onQuickFilterChange={setSearch}
            className="bg-card/50 backdrop-blur-sm"
            loading={listQuery.isLoading || listQuery.isFetching}
            emptyState={{
              title: "No categories",
              description: "No category data is available.",
            }}
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages} • Total {total}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={pageSize}
                onChange={(e) => {
                  const next = Number(e.target.value || "10");
                  setPageSize(next);
                  setPageOffset(0);
                }}
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
              <Button
                variant="outline"
                disabled={!canPrev || listQuery.isFetching}
                onClick={() => setPageOffset((v) => Math.max(0, v - pageSize))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={!canNext || listQuery.isFetching}
                onClick={() => setPageOffset((v) => v + pageSize)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <CategoryModal
        open={modalOpen}
        mode={modalMode}
        pending={createMutation.isPending || updateMutation.isPending}
        initial={{
          name: editing?.name ?? "",
          description: editing?.description ?? "",
        }}
        onClose={() => setModalOpen(false)}
        onSubmit={(v) => {
          if (modalMode === "create") {
            createMutation.mutate(v);
          } else if (editing) {
            updateMutation.mutate({ id: editing.id, ...v });
          }
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete category?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteMutation.mutateAsync({ id: deleting.id });
        }}
      />
    </div>
  );
}
