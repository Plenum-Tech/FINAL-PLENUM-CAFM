"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useQuery } from "@tanstack/react-query";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Button, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { listVendors, type PlenumPage, type PlenumVendor } from "@/features/vendor/plenum-api";

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

export function VendorsGrid() {
  const router = useRouter();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 700);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, organizationId]);

  const query = useQuery<PlenumPage<PlenumVendor>, unknown>({
    queryKey: ["plenum-vendors", organizationId, debouncedSearch, page, pageSize],
    enabled: Boolean(organizationId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      listVendors({
        organizationId,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search: debouncedSearch || undefined,
        signal,
      }),
  });

  useEffect(() => {
    if (!query.isError) return;
    toast({
      title: "Failed to load vendors",
      description: getErrorMessage(query.error),
      variant: "destructive",
    });
  }, [query.error, query.isError]);

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;

  useEffect(() => {
    if (!query.data) return;
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    if (page > totalPages) setPage(totalPages);
  }, [page, pageSize, query.data, total]);

  const columns = useMemo<ColDef<PlenumVendor>[]>(
    () => [
      {
        headerName: "Vendor ID",
        field: "id",
        width: 140,
        valueFormatter: (p) => String(p.value ?? "-"),
      },
      {
        headerName: "Vendor",
        field: "name",
        minWidth: 260,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<PlenumVendor, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Link className="font-medium text-primary hover:underline" href={`${APP_ROUTES.vendors}/${row.id}`} prefetch={false}>
              {row.name}
            </Link>
          );
        },
      },
      {
        headerName: "Specialty",
        field: "specialty",
        minWidth: 160,
        valueFormatter: (p) => String(p.value ?? "-"),
      },
      {
        headerName: "Rate (AED/hr)",
        field: "rate_card_hourly_aed",
        width: 150,
        valueFormatter: (p) => {
          const v = typeof p.value === "number" ? p.value : Number(p.value);
          return Number.isFinite(v) ? String(v) : "-";
        },
      },
      {
        headerName: "SLA (mins)",
        field: "sla_response_mins",
        width: 120,
        valueFormatter: (p) => {
          const v = typeof p.value === "number" ? p.value : Number(p.value);
          return Number.isFinite(v) ? String(v) : "-";
        },
      },
      {
        headerName: "Address",
        field: "address",
        minWidth: 280,
        flex: 1,
        valueFormatter: (p) => String(p.value ?? "-"),
      },
      {
        headerName: "Created",
        field: "created_at",
        width: 190,
        valueFormatter: (p) => {
          const v = typeof p.value === "string" ? p.value : "";
          if (!v) return "-";
          const d = new Date(v);
          return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
        },
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xl font-bold">Vendors</div>
          <div className="text-sm text-muted-foreground">Manage vendor directory.</div>
        </div>
        <div>
          <Button disabled={!organizationId} onClick={() => router.push(`${APP_ROUTES.vendors}/new`)}>
            Add
          </Button>
        </div>
      </div>

      {!organizationId ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Select organization from header to view vendors.
        </div>
      ) : (
        <AgDataGrid<PlenumVendor>
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
          enableQuickFilter
          quickFilterPlaceholder="Search vendors..."
          quickFilterValue={search}
          onQuickFilterChange={setSearch}
          className="bg-card/50 backdrop-blur-sm"
          loading={query.isLoading || query.isFetching}
          emptyState={{
            title: "No vendors",
            description: "No vendor data is available.",
          }}
          onRowClick={(r) => router.push(`${APP_ROUTES.vendors}/${r.id}`)}
        />
      )}
    </div>
  );
}
