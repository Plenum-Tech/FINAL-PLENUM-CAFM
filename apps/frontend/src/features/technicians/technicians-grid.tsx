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
import {
  listTechnicians,
  technicianDisplayName,
  type PlenumPage,
  type PlenumTechnician,
} from "@/features/technicians/plenum-api";

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

function availabilityVariant(v: string | null | undefined): "success" | "warning" | "destructive" | "secondary" {
  const s = (v ?? "").toLowerCase();
  if (s === "available") return "success";
  if (s === "busy") return "warning";
  if (s === "on_leave") return "destructive";
  return "secondary";
}

export function TechniciansGrid() {
  const router = useRouter();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";

  const [availabilityStatus, setAvailabilityStatus] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [availabilityStatus, organizationId]);

  const query = useQuery<PlenumPage<PlenumTechnician>, unknown>({
    queryKey: ["plenum-technicians", organizationId, availabilityStatus, page, pageSize],
    enabled: Boolean(organizationId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      listTechnicians({
        organizationId,
        availabilityStatus: availabilityStatus || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        signal,
      }),
  });

  useEffect(() => {
    if (!query.isError) return;
    toast({
      title: "Failed to load technicians",
      description: getErrorMessage(query.error),
      variant: "destructive",
    });
  }, [query.error, query.isError]);

  const pageRows = query.data?.data ?? [];

  const rows = useMemo(() => {
    const s = localSearch.trim().toLowerCase();
    if (!s) return pageRows;
    return pageRows.filter((t) => {
      const a = technicianDisplayName(t).toLowerCase();
      const b = (t.user_id ?? "").toLowerCase();
      const c = (t.base_location ?? "").toLowerCase();
      return a.includes(s) || b.includes(s) || c.includes(s);
    });
  }, [localSearch, pageRows]);

  const total = query.data?.total ?? 0;

  useEffect(() => {
    if (!query.data) return;
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    if (page > totalPages) setPage(totalPages);
  }, [page, pageSize, query.data, total]);

  const columns = useMemo<ColDef<PlenumTechnician>[]>(
    () => [
      {
        headerName: "Technician",
        field: "id",
        minWidth: 260,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<PlenumTechnician, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Link className="font-medium text-primary hover:underline" href={`${APP_ROUTES.technicians}/${row.id}`} prefetch={false}>
              {technicianDisplayName(row)}
            </Link>
          );
        },
      },
      {
        headerName: "Base Location",
        field: "base_location",
        minWidth: 160,
        valueFormatter: (p) => String(p.value ?? "-"),
      },
      {
        headerName: "Availability",
        field: "availability_status",
        minWidth: 150,
        cellRenderer: (p: ICellRendererParams<PlenumTechnician, unknown>) => (
          <Badge variant={availabilityVariant(String(p.value ?? ""))} className="capitalize">
            {String(p.value ?? "-")}
          </Badge>
        ),
      },
      {
        headerName: "Score",
        field: "performance_score",
        width: 110,
        valueFormatter: (p) => (typeof p.value === "number" ? String(p.value) : "-"),
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
          <div className="text-xl font-bold">Technicians</div>
          <div className="text-sm text-muted-foreground">Manage technicians.</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={availabilityStatus}
            onChange={(e) => setAvailabilityStatus(e.target.value)}
            disabled={!organizationId}
          >
            <option value="">All</option>
            <option value="available">Available</option>
            <option value="busy">Busy</option>
            <option value="on_leave">On Leave</option>
          </select>
          <Button disabled={!organizationId} onClick={() => router.push(`${APP_ROUTES.technicians}/new`)}>
            Add
          </Button>
        </div>
      </div>

      {!organizationId ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Select organization from header to view technicians.
        </div>
      ) : (
        <>
          <AgDataGrid<PlenumTechnician>
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
            quickFilterPlaceholder="Search technicians..."
            quickFilterValue={localSearch}
            onQuickFilterChange={setLocalSearch}
            className="bg-card/50 backdrop-blur-sm"
            loading={query.isLoading || query.isFetching}
            emptyState={{
              title: "No technicians",
              description: "No technicians are available.",
            }}
            onRowClick={(r) => router.push(`${APP_ROUTES.technicians}/${r.id}`)}
          />
        </>
      )}
    </div>
  );
}
