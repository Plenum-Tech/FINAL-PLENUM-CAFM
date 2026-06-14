"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Pencil } from "lucide-react";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Button, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { APP_ROUTES } from "@/constants";
import { apiFetch, ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";

type PlenumLocation = {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  parent_location_id: string | null;
  level: number | null;
  created_at?: string;
};

type LocationsPage = {
  total: number;
  limit: number;
  offset: number;
  data: PlenumLocation[];
};

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

async function fetchLocations(input: {
  organizationId: string;
  parentLocationId?: string;
  search?: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<LocationsPage> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  params.set("organization_id", input.organizationId);
  if (input.parentLocationId) params.set("parent_location_id", input.parentLocationId);
  if (input.search && input.search.trim()) params.set("search", input.search.trim());
  const payload = await apiFetch<unknown>(`/api/v1/plenum/locations?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.locations) ? obj.locations : [];
  const data: PlenumLocation[] = raw
    .map((x): PlenumLocation | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      const organization_id = typeof r.organization_id === "string" ? r.organization_id : input.organizationId;
      const name = typeof r.name === "string" ? r.name : "";
      const type = typeof r.type === "string" ? r.type : "";
      if (!id || !name) return null;
      return {
        id,
        organization_id,
        name,
        type,
        parent_location_id: typeof r.parent_location_id === "string" ? r.parent_location_id : null,
        level: typeof r.level === "number" ? r.level : null,
        created_at: typeof r.created_at === "string" ? r.created_at : undefined,
      };
    })
    .filter((v): v is PlenumLocation => Boolean(v));
  return { total, limit, offset, data };
}

export function LocationsGrid() {
  const router = useRouter();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 1000);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, organizationId]);

  const query = useQuery<LocationsPage, unknown>({
    queryKey: ["plenum-locations", organizationId, debouncedSearch, page, pageSize],
    enabled: Boolean(organizationId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      fetchLocations({
        organizationId,
        search: debouncedSearch || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        signal,
      }),
  });

  useEffect(() => {
    if (!query.isError) return;
    toast({
      title: "Failed to load locations",
      description: getErrorMessage(query.error),
      variant: "destructive",
    });
  }, [query.error, query.isError]);

  const rows = query.data?.data ?? [];

  const idToName = useMemo(() => {
    return new Map(rows.map((r) => [r.id, r.name]));
  }, [rows]);

  const total = query.data?.total ?? 0;

  useEffect(() => {
    if (!query.data) return;
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    if (page > totalPages) setPage(totalPages);
  }, [page, pageSize, query.data, total]);

  const columns = useMemo<ColDef<PlenumLocation>[]>(
    () => [
      {
        headerName: "Name",
        field: "name",
        minWidth: 220,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<PlenumLocation, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Link
              className="font-medium text-primary hover:underline"
              href={`${APP_ROUTES.locations}/${row.id}`}
              prefetch={false}
            >
              {row.name}
            </Link>
          );
        },
      },
      { headerName: "Type", field: "type", width: 140 },
      {
        headerName: "Level",
        field: "level",
        width: 100,
        valueFormatter: (p) => (typeof p.value === "number" ? String(p.value) : "-"),
      },
      {
        headerName: "Parent",
        field: "parent_location_id",
        minWidth: 220,
        flex: 1,
        valueFormatter: (p) => {
          const id = typeof p.value === "string" ? p.value : "";
          if (!id) return "-";
          return idToName.get(id) ?? id;
        },
      },
      {
        headerName: "Actions",
        field: "id",
        width: 120,
        cellRenderer: (p: ICellRendererParams<PlenumLocation, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                aria-label="Edit"
                title="Edit"
                onClick={() => router.push(`${APP_ROUTES.locations}/${row.id}/edit`)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="destructive"
                aria-label="Delete"
                title="Delete"
                onClick={() => {
                  setDeleteId(row.id);
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
    [idToName, router],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xl font-bold">Locations</div>
          <div className="text-sm text-muted-foreground">Organization location hierarchy.</div>
        </div>
        <div>
          <Button asChild disabled={!organizationId}>
            <Link href={`${APP_ROUTES.locations}/new`} prefetch={false}>
              Add
            </Link>
          </Button>
        </div>
      </div>

      {!organizationId ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Select organization from header to view locations.
        </div>
      ) : (
        <>
          <AgDataGrid<PlenumLocation>
            rowData={rows}
            columnDefs={columns}
            pagination={false}
            serverPagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: (next) => {
                setPageSize(next);
                setPage(1);
              },
            }}
            enableQuickFilter={true}
            quickFilterPlaceholder="Search locations..."
            quickFilterValue={search}
            onQuickFilterChange={setSearch}
            className="bg-card/50 backdrop-blur-sm"
            loading={query.isLoading || query.isFetching}
            emptyState={{
              title: "No locations",
              description: "No location data is available.",
            }}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete location?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={false}
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await apiFetch(`/api/v1/plenum/locations/${encodeURIComponent(deleteId)}`, {
              method: "DELETE",
              headers: { Accept: "application/json" },
            });
            toast({ title: "Location deleted", variant: "success" });
            setConfirmOpen(false);
            setDeleteId(null);
            await query.refetch();
          } catch (e) {
            toast({ title: "Failed to delete location", description: getErrorMessage(e), variant: "destructive" });
          }
        }}
      />
    </div>
  );
}
