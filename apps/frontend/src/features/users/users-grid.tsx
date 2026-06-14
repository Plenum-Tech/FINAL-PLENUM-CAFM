"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useQuery } from "@tanstack/react-query";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Badge, Button, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { listUsers, type PlenumPage, type PlenumUser } from "@/features/users/plenum-api";

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

function statusVariant(v: string | null | undefined): "success" | "secondary" | "destructive" {
  const s = (v ?? "").toLowerCase();
  if (s === "active") return "success";
  if (s === "inactive") return "secondary";
  return "destructive";
}

export function UsersGrid() {
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

  const query = useQuery<PlenumPage<PlenumUser>, unknown>({
    queryKey: ["plenum-users", organizationId, debouncedSearch, page, pageSize],
    enabled: Boolean(organizationId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      listUsers({
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
      title: "Failed to load users",
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

  const columns = useMemo<ColDef<PlenumUser>[]>(
    () => [
      {
        headerName: "Name",
        field: "full_name",
        minWidth: 220,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<PlenumUser, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Link className="font-medium text-primary hover:underline" href={`${APP_ROUTES.users}/${row.id}`} prefetch={false}>
              {row.full_name || "-"}
            </Link>
          );
        },
      },
      { headerName: "Email", field: "email", minWidth: 220, flex: 1, valueFormatter: (p) => String(p.value ?? "-") },
      { headerName: "Phone", field: "phone", minWidth: 140, valueFormatter: (p) => String(p.value ?? "-") },
      {
        headerName: "Status",
        field: "status",
        width: 120,
        cellRenderer: (p: ICellRendererParams<PlenumUser, unknown>) => (
          <Badge
            variant={statusVariant(typeof p.value === "string" ? p.value : null)}
            className="capitalize"
          >
            {String(p.value ?? "-")}
          </Badge>
        ),
      },
      {
        headerName: "Email Verified",
        field: "email_verified",
        width: 150,
        cellRenderer: (p: ICellRendererParams<PlenumUser, unknown>) => (
          <Badge variant={p.value ? "success" : "secondary"}>{p.value ? "Yes" : "No"}</Badge>
        ),
      },
      {
        headerName: "Created",
        field: "created_at",
        minWidth: 180,
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
          <div className="text-xl font-bold">Users</div>
          <div className="text-sm text-muted-foreground">Manage users.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={!organizationId} onClick={() => router.push(`${APP_ROUTES.users}/new`)}>
            Add
          </Button>
        </div>
      </div>

      {!organizationId ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Select organization from header to view users.
        </div>
      ) : (
        <>
          <AgDataGrid<PlenumUser>
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
            quickFilterPlaceholder="Search users..."
            quickFilterValue={search}
            onQuickFilterChange={setSearch}
            className="bg-card/50 backdrop-blur-sm"
            loading={query.isLoading || query.isFetching}
            emptyState={{
              title: "No users",
              description: "No users are available.",
            }}
            onRowClick={(r) => router.push(`${APP_ROUTES.users}/${r.id}`)}
          />
        </>
      )}
    </div>
  );
}
