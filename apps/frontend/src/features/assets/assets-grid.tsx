 "use client";
 
 import { useEffect, useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
 
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Badge, Button, toast } from "@/components/ui";
 import { AgDataGrid } from "@/components/data-grid/ag-data-grid";
 import { APP_ROUTES } from "@/constants";
 import { useRouter } from "next/navigation";
import { env } from "@/config";
import { useOrganizationStore } from "@/store/organizationStore";
import { apiFetch } from "@/services/api";
import { getApiErrorMessage } from "@/features/import/wizard/api";
 
 export type AssetStatus = "active" | "maintenance" | "warning" | "critical";
 export type AssetRow = {
   id: string;
   name: string;
   code: string;
   category: string;
   location: string;
   healthScore: number;
   status: AssetStatus;
   warrantyExpiry?: string;
  lastMaintenance?: string;
 };
 
 function StatusBadgeCell(props: { value?: AssetStatus }) {
   const v = props.value ?? "active";
   const variants: Record<AssetStatus, "success" | "warning" | "destructive" | "secondary"> = {
     active: "success",
     maintenance: "warning",
     warning: "warning",
     critical: "destructive",
   };
   return <Badge variant={variants[v]} className="capitalize">{v}</Badge>;
 }
 
 function HealthScoreCell(props: { value?: number }) {
   const score = Number(props.value ?? 0);
   let variant: "success" | "warning" | "destructive" = "success";
   if (score < 50) variant = "destructive";
   else if (score < 75) variant = "warning";
   return (
     <Badge variant={variant} className="w-9 h-9 rounded-full flex items-center justify-center p-0 font-bold text-xs">
       {score}
     </Badge>
   );
 }
 
type AssetCategory = { id?: string; name: string; description?: string | null };
type AssetCategoryPage = { total: number; limit: number; offset: number; data: AssetCategory[] };
type AssetsPage = { total: number; limit: number; offset: number; data: AssetRow[] };

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

  try {
    const payload = await apiFetch<unknown>(`/api/v1/plenum/asset-categories?${params.toString()}`, {
      signal: input.signal,
    });
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid response.");
    }
    const obj = payload as Record<string, unknown>;
    const total = typeof obj.total === "number" ? obj.total : 0;
    const limit = typeof obj.limit === "number" ? obj.limit : input.limit;
    const offset = typeof obj.offset === "number" ? obj.offset : input.offset;
    const raw = Array.isArray(obj.data) ? obj.data : [];
    const data = raw
      .map((x): AssetCategory | null => {
        if (typeof x === "string" && x.trim()) return { name: x };
        if (typeof x !== "object" || x === null) return null;
        const r = x as Record<string, unknown>;
        const name = typeof r.name === "string" ? r.name : typeof r.category === "string" ? r.category : "";
        if (!name.trim()) return null;
        return {
          id: typeof r.id === "string" ? r.id : undefined,
          name,
          description: typeof r.description === "string" ? r.description : null,
        };
      })
      .filter((v): v is AssetCategory => Boolean(v));

    return { total, limit, offset, data };
  } catch (e) {
    throw e;
  }
}

async function fetchAssets(input: {
  limit: number;
  offset: number;
  organizationId?: string;
  status?: string;
  categoryId?: string;
  locationId?: string;
  signal?: AbortSignal;
}): Promise<AssetsPage> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  if (input.organizationId) params.set("organization_id", input.organizationId);
  if (input.status) params.set("status", input.status);
  if (input.categoryId) params.set("category_id", input.categoryId);
  if (input.locationId) params.set("location_id", input.locationId);

  const payload = await apiFetch<unknown>(`/api/v1/plenum/assets?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid response.");

  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const limit = typeof obj.limit === "number" ? obj.limit : input.limit;
  const offset = typeof obj.offset === "number" ? obj.offset : input.offset;
  const raw = Array.isArray(obj.data) ? obj.data : [];

  const data: AssetRow[] = raw
    .map((x): AssetRow | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;

      const id =
        typeof r.id === "string"
          ? r.id
          : typeof r.asset_id === "string"
            ? r.asset_id
            : "";
      const name =
        typeof r.asset_name === "string"
          ? r.asset_name
          : typeof r.name === "string"
            ? r.name
            : "";
      const code =
        typeof r.asset_code === "string"
          ? r.asset_code
          : typeof r.code === "string"
            ? r.code
            : "";

      if (!id || !name) return null;

      const category =
        typeof r.category === "string"
          ? r.category
          : typeof r.category_name === "string"
            ? r.category_name
            : typeof r.category_id === "string"
              ? r.category_id
              : "";
      const location =
        typeof r.location === "string"
          ? r.location
          : typeof r.location_name === "string"
            ? r.location_name
            : typeof r.location_id === "string"
              ? r.location_id
              : "";

      const statusRaw = typeof r.status === "string" ? r.status : "active";
      const status: AssetStatus =
        statusRaw === "active" || statusRaw === "maintenance" || statusRaw === "warning" || statusRaw === "critical"
          ? statusRaw
          : "active";

      const healthScore =
        typeof r.health_score === "number"
          ? r.health_score
          : typeof r.healthScore === "number"
            ? r.healthScore
            : 0;

      const warrantyExpiry =
        typeof r.warranty_expiry === "string"
          ? r.warranty_expiry
          : typeof r.warrantyExpiry === "string"
            ? r.warrantyExpiry
            : undefined;
      const lastMaintenance =
        typeof r.last_maintenance === "string"
          ? r.last_maintenance
          : typeof r.lastMaintenance === "string"
            ? r.lastMaintenance
            : undefined;

      return {
        id,
        name,
        code,
        category,
        location,
        healthScore: Math.round(Number(healthScore) || 0),
        status,
        warrantyExpiry,
        lastMaintenance,
      };
    })
    .filter((v): v is AssetRow => Boolean(v));

  return { total, limit, offset, data };
}

 export function AssetsGrid({ rows: initialRows = [] }: { rows?: AssetRow[] }) {
   const router = useRouter();
  const [status, setStatus] = useState<"" | AssetStatus>("");
  const [category, setCategory] = useState("");
  const [locationId, setLocationId] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const orgSelected = useOrganizationStore((s) => s.selected);
  const orgId = orgSelected?.id || env.organizationId || undefined;
  const categoriesQuery = useInfiniteQuery<AssetCategoryPage, unknown>({
    queryKey: ["asset-categories", orgId],
    initialPageParam: 0,
    retry: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchAssetCategories({ limit: 20, offset: Number(pageParam), organizationId: orgId, signal }),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
  });

  const categoriesData = useMemo(
    () => categoriesQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [categoriesQuery.data],
  );
  const selectedCategoryId = useMemo(() => {
    const found = categoriesData.find((c) => c.id === category || c.name === category) ?? null;
    return found?.id ?? "";
  }, [categoriesData, category]);

  useEffect(() => {
    setPage(1);
  }, [locationId, orgId, selectedCategoryId, status]);

  const assetsQuery = useQuery<AssetsPage, unknown>({
    queryKey: ["plenum-assets", orgId, status, selectedCategoryId, locationId, page, pageSize],
    retry: 0,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) =>
      fetchAssets({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        organizationId: orgId,
        status: status || undefined,
        categoryId: selectedCategoryId || undefined,
        locationId: locationId || undefined,
        signal,
      }),
  });

  useEffect(() => {
    if (!categoriesQuery.isError) return;
    toast({
      title: "Failed to load categories",
      description: getApiErrorMessage(categoriesQuery.error),
      variant: "destructive",
    });
  }, [categoriesQuery.error, categoriesQuery.isError]);

  useEffect(() => {
    if (!assetsQuery.isError) return;
    toast({
      title: "Failed to load assets",
      description: getApiErrorMessage(assetsQuery.error),
      variant: "destructive",
    });
  }, [assetsQuery.error, assetsQuery.isError]);

  const categories = useMemo<string[]>(() => {
    const names = categoriesData
      .map((c) => c.name)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    const unique = Array.from(new Set(names));
    if (unique.length) return unique.sort((a, b) => a.localeCompare(b));

    const fallback = (assetsQuery.data?.data ?? initialRows)
      .map((r) => r.category)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return Array.from(new Set(fallback)).sort((a, b) => a.localeCompare(b));
  }, [assetsQuery.data, categoriesData, initialRows]);

  const rowData = useMemo(() => {
    const apiRows = assetsQuery.data?.data ?? [];
    return apiRows.length ? apiRows : initialRows;
  }, [assetsQuery.data, initialRows]);

  const total = assetsQuery.data?.total ?? rowData.length;

  useEffect(() => {
    if (!assetsQuery.data) return;
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    if (page > totalPages) setPage(totalPages);
  }, [assetsQuery.data, page, pageSize, total]);
 
   const columns = useMemo<ColDef<AssetRow>[]>(
     () => [
       {
         headerName: "Asset Name",
         field: "name",
         minWidth: 220,
         cellRenderer: (p: ICellRendererParams<AssetRow, unknown>) => (
           <span className="font-semibold">{String(p.value ?? "")}</span>
         ),
       },
       { headerName: "Asset Code", field: "code", minWidth: 140 },
       {
         headerName: "Category",
         field: "category",
         minWidth: 120,
         cellRenderer: (p: ICellRendererParams<AssetRow, unknown>) =>
           Badge({
             variant: "outline",
             className: "font-medium bg-muted/50",
             children: String(p.value ?? ""),
           }),
       },
       { headerName: "Location", field: "location", minWidth: 160 },
       {
         headerName: "Health",
         field: "healthScore",
         width: 110,
         cellStyle: { display: "flex", alignItems: "center", justifyContent: "center" },
         cellRenderer: (p: ICellRendererParams<AssetRow, unknown>) => HealthScoreCell({ value: p.value as number | undefined }),
       },
       {
         headerName: "Status",
         field: "status",
         width: 130,
         cellRenderer: (p: ICellRendererParams<AssetRow, unknown>) => StatusBadgeCell({ value: p.value as AssetStatus | undefined }),
       },
       {
        headerName: "Warranty Expiry",
         field: "warrantyExpiry",
        minWidth: 160,
         valueFormatter: (p) => p.value || "N/A",
       },
      {
        headerName: "Last Maintenance",
        field: "lastMaintenance",
        minWidth: 170,
        valueFormatter: (p) => p.value || "N/A",
      },
     ],
     [],
   );
 
   return (
     <AgDataGrid<AssetRow>
      rowData={rowData}
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
      quickFilterPlaceholder="Search assets..."
      filters={
        <>
          {/* status filter */}
          <select
            className="h-10 min-w-[160px] rounded-md border border-input bg-transparent px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | AssetStatus)}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>

          {/* category filter */}
          <div className="flex items-center gap-2">
            <select
              className="h-10 min-w-[200px] rounded-md border border-input bg-transparent px-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {categoriesQuery.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={categoriesQuery.isFetchingNextPage}
                onClick={() => categoriesQuery.fetchNextPage()}
              >
                {categoriesQuery.isFetchingNextPage ? "Loading..." : "More"}
              </Button>
            ) : null}
          </div>
        </>
      }
      emptyState={{
        title: "No assets found",
        description: "No data is available for the selected filters.",
        action: (
          <Button
            variant="outline"
            onClick={() => {
              setStatus("");
              setCategory("");
              setLocationId("");
            }}
          >
            Clear filters
          </Button>
        ),
      }}
      loading={assetsQuery.isLoading || assetsQuery.isFetching}
       onRowClick={(r) => router.push(`${APP_ROUTES.assets}/${r.id}`)}
      className="bg-card/50 backdrop-blur-sm"
     />
   );
 }
 
