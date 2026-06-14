 "use client";
 
import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import type { ColDef, GridApi, GridReadyEvent } from "ag-grid-community";
 import "ag-grid-community/styles/ag-grid.css";
 import "ag-grid-community/styles/ag-theme-quartz.css";
import { Download, Inbox, Search, Upload } from "lucide-react";
 
 import { Input, Button, Spinner } from "@/components/ui";
 import { useUiStore } from "@/store";
import { cn } from "@/utils";
import { ImportWizard } from "@/features/import/wizard/Wizard";
 
const agGridGlobal = globalThis as unknown as { __cafmAgGridModulesRegistered?: boolean };
if (!agGridGlobal.__cafmAgGridModulesRegistered) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  agGridGlobal.__cafmAgGridModulesRegistered = true;
}

type EmptyState = {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
};

type NoRowsOverlayProps = {
  title: string;
  description: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
};

function NoRowsOverlay(props: NoRowsOverlayProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
      {props.icon}
      <div className="text-center space-y-1">
        <p className="text-base font-semibold text-foreground">{props.title}</p>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
      {props.action ? <div className="mt-1">{props.action}</div> : null}
    </div>
  );
}

 type Props<T extends object> = {
   rowData: T[];
   columnDefs: ColDef<T>[];
   className?: string;
   height?: number | string;
   pagination?: boolean;
   pageSize?: number;
  serverPagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
   enableQuickFilter?: boolean;
  quickFilterPlaceholder?: string;
  quickFilterValue?: string;
  onQuickFilterChange?: (value: string) => void;
  filters?: React.ReactNode;
   onRowClick?: (row: T) => void;
  emptyState?: EmptyState;
  loading?: boolean;
 };
 
 export function AgDataGrid<T extends object>({
   rowData,
   columnDefs,
   className,
  height = 520,
   pagination = true,
   pageSize = 25,
  serverPagination,
   enableQuickFilter = true,
  quickFilterPlaceholder = "Search...",
  quickFilterValue,
  onQuickFilterChange,
  filters,
   onRowClick,
  emptyState,
  loading,
 }: Props<T>) {
   const theme = useUiStore((s) => s.theme);
   const themeClass = theme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz";
 
  const gridApiRef = useRef<GridApi<T> | null>(null);
   const [quick, setQuick] = useState("");
   const [size, setSize] = useState(pageSize);
  const [clientPage, setClientPage] = useState(1);
  const [clientTotalPages, setClientTotalPages] = useState(1);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
 
   const defaultColDef = useMemo<ColDef<T>>(
     () => ({
       sortable: true,
       filter: true,
       resizable: true,
      floatingFilter: false,
       suppressHeaderContextMenu: false,
     }),
     [],
   );
 
   const onGridReady = (e: GridReadyEvent<T>) => {
    gridApiRef.current = e.api;
    if (!serverPagination && pagination) {
      const p = e.api.paginationGetCurrentPage?.() ?? 0;
      const t = e.api.paginationGetTotalPages?.() ?? 1;
      setClientPage(p + 1);
      setClientTotalPages(Math.max(1, t));
    }
   };
 
  // Column state persistence removed for now due to API surface differences in v35
 
  const effectiveQuick = quickFilterValue ?? quick;

  const overlayProps = useMemo<NoRowsOverlayProps>(() => {
    const title = emptyState?.title ?? "No data available";
    const description =
      effectiveQuick.trim().length > 0
        ? "No matching results. Try a different search."
        : (emptyState?.description ?? "There is nothing to display here right now.");
    const icon = emptyState?.icon ?? <Inbox className="h-10 w-10 opacity-40" />;
    return { title, description, icon, action: emptyState?.action };
  }, [emptyState?.action, emptyState?.description, emptyState?.icon, emptyState?.title, effectiveQuick]);

  const effectivePageSize = serverPagination?.pageSize ?? size;
  const totalRows = serverPagination?.total ?? rowData.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / Math.max(1, effectivePageSize)));
  const currentPage = serverPagination?.page ?? clientPage;
  const currentTotalPages = serverPagination ? totalPages : clientTotalPages;

  const fromRow = totalRows === 0 ? 0 : (currentPage - 1) * effectivePageSize + 1;
  const toRow = totalRows === 0 ? 0 : Math.min(totalRows, currentPage * effectivePageSize);

  const pageItems = useMemo((): Array<number | "ellipsis"> => {
    const t = Math.max(1, Math.floor(currentTotalPages));
    const c = Math.min(Math.max(1, Math.floor(currentPage)), t);

    if (t <= 9) return Array.from({ length: t }, (_, i) => i + 1);

    let start = Math.max(2, c - 1);
    let end = Math.min(t - 1, c + 1);

    if (c <= 4) {
      start = 2;
      end = 5;
    } else if (c >= t - 3) {
      start = t - 4;
      end = t - 1;
    }

    const out: Array<number | "ellipsis"> = [1];
    if (start > 2) out.push("ellipsis");
    for (let i = start; i <= end; i += 1) out.push(i);
    if (end < t - 1) out.push("ellipsis");
    out.push(t);
    return out;
  }, [currentPage, currentTotalPages]);

  const goToPage = (page: number) => {
    const next = Math.max(1, Math.min(currentTotalPages, page));
    if (serverPagination) {
      serverPagination.onPageChange(next);
    } else {
      gridApiRef.current?.paginationGoToPage?.(next - 1);
    }
  };

   return (
    <div
      className={cn(
        "rounded-xl border border-border/40 overflow-hidden bg-background shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-3 p-4 bg-background border-b">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:flex-nowrap">
           {enableQuickFilter ? (
            <div className="relative w-full lg:w-[380px] shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
               <Input
                 value={effectiveQuick}
                 onChange={(e) => {
                   const v = e.target.value;
                   onQuickFilterChange?.(v);
                   if (!onQuickFilterChange) setQuick(v);
                 }}
                placeholder={quickFilterPlaceholder}
                className="pl-9 h-10 bg-background"
               />
             </div>
           ) : null}
 
          <div className="flex-1 min-w-0" />

          <div className="flex w-full lg:w-auto items-center gap-2 lg:gap-3 flex-wrap lg:flex-nowrap hide-scrollbar">
            {filters}
             {/* <label className="text-xs text-muted-foreground">Rows/Page</label> */}
             <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
               value={effectivePageSize}
               onChange={(e) => {
                 const next = Number(e.target.value);
                 if (serverPagination) {
                   serverPagination.onPageSizeChange(next);
                 } else {
                   setSize(next);
                  gridApiRef.current?.setGridOption?.("paginationPageSize", next);
                  gridApiRef.current?.paginationGoToFirstPage?.();
                  setClientPage(1);
                 }
               }}
             >
               {[10, 25, 50, 100, 200].map((n) => (
                 <option key={n} value={n}>
                   {n}
                 </option>
               ))}
             </select>
 
             {/* <Button
               variant="outline"
               size="sm"
               className="gap-2"
               onClick={() => setDense(dense === "compact" ? "normal" : "compact")}
               title="Toggle density"
             >
               <SlidersHorizontal className="h-4 w-4" />
               {dense === "compact" ? "Comfortable" : "Compact"}
             </Button> */}
 
             <Button
               variant="outline"
               size="sm"
               className="gap-2"
               onClick={() => setIsImportModalOpen(true)}
               title="Import Data"
             >
               <Upload className="h-4 w-4" />
               Import
             </Button>

             <Button
               variant="outline"
               size="sm"
               className="gap-2"
               onClick={() => gridApiRef.current?.exportDataAsCsv()}
               title="Export CSV"
             >
               <Download className="h-4 w-4" />
               Export
             </Button>
           </div>
         </div>
 
        {/* Column visibility panel omitted for streamlined API */}
       </div>
 
      <ImportWizard
        open={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />

      <div
        className={`${themeClass} w-full relative`}
        style={{
          height,
          ["--ag-border-color" as unknown as string]: "hsl(var(--border) / 0.30)",
          ["--ag-row-border-color" as unknown as string]: "hsl(var(--border) / 0.18)",
          ["--ag-header-background-color" as unknown as string]: "hsl(var(--muted) / 0.35)",
          ["--ag-header-foreground-color" as unknown as string]: "hsl(var(--muted-foreground))",
          ["--ag-foreground-color" as unknown as string]: "hsl(var(--foreground))",
          ["--ag-background-color" as unknown as string]: "hsl(var(--background))",
          ["--ag-odd-row-background-color" as unknown as string]: "hsl(var(--background))",
          ["--ag-font-size" as unknown as string]: "14px",
          ["--ag-header-font-size" as unknown as string]: "12px",
        }}
      >
         <AgGridReact<T>
          theme="legacy"
           rowData={rowData}
           columnDefs={columnDefs}
           defaultColDef={defaultColDef}
          noRowsOverlayComponent={NoRowsOverlay}
          noRowsOverlayComponentParams={overlayProps}
           animateRows
           suppressMenuHide
          alwaysShowHorizontalScroll={false}
          alwaysShowVerticalScroll={false}
           pagination={Boolean(pagination) && !serverPagination}
          paginationPageSize={effectivePageSize}
          quickFilterText={effectiveQuick}
          headerHeight={44}
          rowHeight={56}
          onPaginationChanged={() => {
            if (serverPagination) return;
            if (!pagination) return;
            const api = gridApiRef.current;
            if (!api) return;
            const p = api.paginationGetCurrentPage?.() ?? 0;
            const t = api.paginationGetTotalPages?.() ?? 1;
            setClientPage(p + 1);
            setClientTotalPages(Math.max(1, t));
          }}
          onRowClicked={(e) => {
            if (e.data) onRowClick?.(e.data);
          }}
           onGridReady={onGridReady}
         />

        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
            <Spinner size="lg" />
          </div>
        ) : null}
       </div>

      {pagination || serverPagination ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border-t bg-background">
          <div className="text-xs text-muted-foreground">
            Showing {fromRow}-{toRow} of {totalRows} • Page {currentPage} of {currentTotalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => {
                goToPage(currentPage - 1);
              }}
            >
              Prev
            </Button>
            <div className="hidden sm:flex items-center gap-1">
              {pageItems.map((it, idx) => {
                if (it === "ellipsis") {
                  return (
                    <span key={`e-${idx}`} className="px-2 text-xs text-muted-foreground">
                      …
                    </span>
                  );
                }
                const active = it === currentPage;
                return (
                  <Button
                    key={it}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    className="px-2"
                    onClick={() => goToPage(it)}
                  >
                    {it}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= currentTotalPages}
              onClick={() => {
                goToPage(currentPage + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
     </div>
   );
 }
 
