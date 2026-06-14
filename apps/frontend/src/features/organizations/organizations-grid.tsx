"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useQuery } from "@tanstack/react-query";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Button, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";

import { listOrganizations, type PlenumOrganization, type PlenumPage } from "./plenum-api";

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

export function OrganizationsGrid() {
  const router = useRouter();
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
  }, [debouncedSearch]);

  const query = useQuery<PlenumPage<PlenumOrganization>, unknown>({
    queryKey: ["plenum-organizations", debouncedSearch, page, pageSize],
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      listOrganizations({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search: debouncedSearch || undefined,
        signal,
      }),
  });

  useEffect(() => {
    if (!query.isError) return;
    toast({
      title: "Failed to load organizations",
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

  const columns = useMemo<ColDef<PlenumOrganization>[]>(
    () => [
      {
        headerName: "Organization",
        field: "name",
        minWidth: 260,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<PlenumOrganization, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Link
              className="font-medium text-primary hover:underline"
              href={`${APP_ROUTES.organizations}/${row.id}`}
              prefetch={false}
            >
              {row.name}
            </Link>
          );
        },
      },
      { headerName: "Industry", field: "industry", minWidth: 180, flex: 1, valueFormatter: (p) => String(p.value ?? "-") },
      { headerName: "Country", field: "country", width: 140, valueFormatter: (p) => String(p.value ?? "-") },
      { headerName: "Timezone", field: "timezone", width: 190, valueFormatter: (p) => String(p.value ?? "-") },
      { headerName: "Status", field: "status", width: 140, valueFormatter: (p) => String(p.value ?? "-") },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xl font-bold">Organizations</div>
          <div className="text-sm text-muted-foreground">Manage tenants and settings.</div>
        </div>
        <div>
          <Button onClick={() => router.push(`${APP_ROUTES.organizations}/new`)}>Add</Button>
        </div>
      </div>

      <AgDataGrid<PlenumOrganization>
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
        quickFilterPlaceholder="Search organizations..."
        quickFilterValue={search}
        onQuickFilterChange={setSearch}
        className="bg-card/50 backdrop-blur-sm"
        loading={query.isLoading || query.isFetching}
        emptyState={{
          title: "No organizations",
          description: "No organizations are available.",
        }}
        onRowClick={(r) => router.push(`${APP_ROUTES.organizations}/${r.id}`)}
      />
    </div>
  );
}

