"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useQuery } from "@tanstack/react-query";

import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
import { Button, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError, apiFetch } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import {
  listMaintenancePlans,
  type PlenumMaintenancePlan,
  type PlenumPage,
} from "@/features/preventive-maintenance/plenum-api";

type AssetLite = { id: string; asset_name?: string | null; name?: string | null };

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

function isoToDateOnly(v: string): string {
  if (!v.trim()) return "";
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : v;
}

export function MaintenancePlansGrid() {
  const router = useRouter();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [organizationId]);

  const query = useQuery<PlenumPage<PlenumMaintenancePlan>, unknown>({
    queryKey: ["plenum-maintenance-plans", organizationId, page, pageSize],
    enabled: Boolean(organizationId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      listMaintenancePlans({
        organizationId,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        signal,
      }),
  });

  useEffect(() => {
    if (!query.isError) return;
    toast({
      title: "Failed to load maintenance plans",
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

  const assetsQuery = useQuery<{ data: AssetLite[] }, unknown>({
    queryKey: ["plenum-assets-lite", organizationId],
    enabled: Boolean(organizationId),
    retry: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("organization_id", organizationId);
      params.set("limit", "500");
      params.set("offset", "0");
      const payload = await apiFetch<unknown>(`/api/v1/plenum/assets?${params.toString()}`, { signal });
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const raw = Array.isArray(obj.data) ? obj.data : [];
      const data = raw
        .map((x): AssetLite | null => {
          if (typeof x !== "object" || x === null) return null;
          const r = x as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : typeof r.asset_id === "string" ? r.asset_id : "";
          if (!id.trim()) return null;
          return {
            id,
            asset_name: typeof r.asset_name === "string" ? r.asset_name : null,
            name: typeof r.name === "string" ? r.name : null,
          };
        })
        .filter((v): v is AssetLite => Boolean(v));
      return { data };
    },
  });

  const assetNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assetsQuery.data?.data ?? []) {
      const label = (a.asset_name ?? a.name ?? "").trim();
      if (label) map.set(a.id, label);
    }
    return map;
  }, [assetsQuery.data?.data]);

  const columns = useMemo<ColDef<PlenumMaintenancePlan>[]>(
    () => [
      {
        headerName: "Maintenance Type",
        field: "maintenance_type",
        minWidth: 220,
        flex: 1,
        cellRenderer: (p: ICellRendererParams<PlenumMaintenancePlan, unknown>) => {
          const row = p.data;
          if (!row) return null;
          return (
            <Link
              className="font-medium text-primary hover:underline"
              href={`${APP_ROUTES.preventiveMaintenance}/${row.id}`}
              prefetch={false}
            >
              {String(row.maintenance_type ?? "-")}
            </Link>
          );
        },
      },
      {
        headerName: "Asset",
        field: "asset_id",
        minWidth: 220,
        flex: 1,
        valueFormatter: (p) => {
          const id = typeof p.value === "string" ? p.value : "";
          if (!id) return "-";
          return assetNameById.get(id) ?? id;
        },
      },
      { headerName: "Frequency Type", field: "frequency_type", width: 150, valueFormatter: (p) => String(p.value ?? "-") },
      {
        headerName: "Frequency",
        field: "frequency_value",
        width: 120,
        valueFormatter: (p) => (typeof p.value === "number" ? String(p.value) : p.value ? String(p.value) : "-"),
      },
      {
        headerName: "Next Due",
        field: "next_due_date",
        width: 150,
        valueFormatter: (p) => (typeof p.value === "string" ? isoToDateOnly(p.value) : "-"),
      },
    ],
    [assetNameById],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xl font-bold">Maintenance Plans</div>
          <div className="text-sm text-muted-foreground">Preventive maintenance schedule and history.</div>
        </div>
        <div>
          <Button disabled={!organizationId} onClick={() => router.push(`${APP_ROUTES.preventiveMaintenance}/new`)}>
            Add
          </Button>
        </div>
      </div>

      {!organizationId ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Select organization from header to view maintenance plans.
        </div>
      ) : (
        <AgDataGrid<PlenumMaintenancePlan>
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
          enableQuickFilter={false}
          className="bg-card/50 backdrop-blur-sm"
          loading={query.isLoading || query.isFetching}
          emptyState={{
            title: "No maintenance plans",
            description: "No maintenance plan data is available.",
          }}
          onRowClick={(r) => router.push(`${APP_ROUTES.preventiveMaintenance}/${r.id}`)}
        />
      )}
    </div>
  );
}
