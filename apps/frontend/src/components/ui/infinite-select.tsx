 "use client";
 
 import { useCallback, useEffect, useMemo, useRef, useState } from "react";
 import { Search } from "lucide-react";
 
 import { cn } from "@/utils";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 
export type InfiniteSelectItem = {
  id: string;
  label: string;
  tag?: string;
  tagVariant?: "success" | "warning" | "destructive" | "secondary";
};
 
 // Simple in-memory cache with TTL per key+search
 type CacheValue = { total: number; items: InfiniteSelectItem[]; timestamp: number };
 const CACHE = new Map<string, CacheValue>();
 
 export function InfiniteSelect({
   open,
   onClose,
   onSelect,
   fetchPage,
   valueLabel,
   placeholder,
   className,
   pageSize = 10,
   cacheKey,
   cacheTTL = 60_000,
  fullWidth = false,
 }: {
   open: boolean;
   onClose: () => void;
   onSelect: (item: InfiniteSelectItem) => void;
   fetchPage: (args: {
     limit: number;
     offset: number;
     search: string;
     signal?: AbortSignal;
   }) => Promise<{ total: number; data: InfiniteSelectItem[] }>;
   valueLabel?: string;
   placeholder?: string;
   className?: string;
   pageSize?: number;
   cacheKey?: string;
   cacheTTL?: number;
  fullWidth?: boolean;
 }) {
   const [search, setSearch] = useState("");
   const [items, setItems] = useState<InfiniteSelectItem[]>([]);
   const [total, setTotal] = useState(0);
   const [offset, setOffset] = useState(0);
   const [loading, setLoading] = useState(false);
   const loadingRef = useRef(false);
   const [error, setError] = useState<string | null>(null);
   const rootRef = useRef<HTMLDivElement | null>(null);
   const scrollRef = useRef<HTMLDivElement | null>(null);
   const abortRef = useRef<AbortController | null>(null);
 
   const canLoadMore = useMemo(() => items.length < total, [items.length, total]);
   const effectiveCacheKey = useMemo(() => {
     if (!cacheKey) return null;
     const s = search.trim().toLowerCase();
     return `${cacheKey}|${s}`;
   }, [cacheKey, search]);
 
   const loadPage = useCallback(async (nextOffset: number, replace: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    
    try {
      if (effectiveCacheKey && CACHE.has(effectiveCacheKey)) {
        const entry = CACHE.get(effectiveCacheKey)!;
        const fresh = Date.now() - entry.timestamp < cacheTTL;
        if (fresh && entry.items.length >= nextOffset + pageSize) {
          const windowSlice = entry.items.slice(0, nextOffset + pageSize);
          setTotal(entry.total);
          setItems((prev) => (replace ? windowSlice : [...prev, ...windowSlice.slice(prev.length)]));
          setOffset(nextOffset + pageSize);
          loadingRef.current = false;
          setLoading(false);
          return;
        }
      }
      
      const res = await fetchPage({
        limit: pageSize,
        offset: nextOffset,
        search,
        signal: ac.signal,
      });
      
      setTotal(typeof res.total === "number" ? res.total : 0);
      setItems((prev) => {
         const newItems = res.data;
         const merged = replace ? newItems : [...prev, ...newItems];
         
         // Deduplicate items by ID to prevent React key warnings
         const uniqueItemsMap = new Map<string, InfiniteSelectItem>();
         for (const item of merged) {
           if (!uniqueItemsMap.has(item.id)) {
             uniqueItemsMap.set(item.id, item);
           }
         }
         const finalMerged = Array.from(uniqueItemsMap.values());

         if (effectiveCacheKey) {
           CACHE.set(effectiveCacheKey, {
             total: typeof res.total === "number" ? res.total : 0,
             items: finalMerged,
             timestamp: Date.now(),
           });
         }
         return finalMerged;
       });
      setOffset(nextOffset + pageSize);
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg = e instanceof Error ? e.message || "Something went wrong" : "Something went wrong";
      setError(msg);
    } finally {
      if (!ac.signal.aborted) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [cacheTTL, effectiveCacheKey, fetchPage, pageSize, search]);

   const resetAndLoad = useCallback(() => {
      setItems([]);
      setTotal(0);
      setOffset(0);
      if (effectiveCacheKey && CACHE.has(effectiveCacheKey)) {
        const entry = CACHE.get(effectiveCacheKey)!;
        const fresh = Date.now() - entry.timestamp < cacheTTL;
        if (fresh) {
          setItems(entry.items);
          setTotal(entry.total);
          setOffset(entry.items.length);
          return;
        } else {
          CACHE.delete(effectiveCacheKey);
        }
      }
      loadPage(0, true).catch(() => {});
    }, [cacheTTL, effectiveCacheKey, loadPage]);
 
   useEffect(() => {
     if (!open) return;
     resetAndLoad();
   }, [open, resetAndLoad]);
 
   useEffect(() => {
     if (!open) return;
     const t = setTimeout(() => {
       resetAndLoad();
    }, 600);
     return () => clearTimeout(t);
   }, [open, resetAndLoad, search]);
 
   // Close on outside click
   useEffect(() => {
     if (!open) return;
     function onMouseDown(e: MouseEvent) {
       const el = rootRef.current;
       if (el && e.target instanceof Node && !el.contains(e.target)) {
         onClose();
       }
     }
     document.addEventListener("mousedown", onMouseDown);
     return () => document.removeEventListener("mousedown", onMouseDown);
   }, [open, onClose]);
 
   useEffect(() => {
     function onKey(e: KeyboardEvent) {
       if (e.key === "Escape") onClose();
     }
     if (open) window.addEventListener("keydown", onKey);
     return () => window.removeEventListener("keydown", onKey);
   }, [open, onClose]);
 
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      const node = scrollRef.current;
      if (!node) return;
      if (!canLoadMore || loadingRef.current) return;
      const nearBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 24;
      if (nearBottom) {
        loadPage(offset, false).catch(() => {});
      }
    }
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [canLoadMore, offset, loadPage]);
 
   if (!open) return null;
 
   const filtered = items.filter((i) =>
     search.trim() ? i.label.toLowerCase().includes(search.trim().toLowerCase()) : true,
   );
 
   return (
    <div
      ref={rootRef}
      className={cn(
        "absolute top-full mt-2 rounded-xl border bg-card shadow-lg ring-1 ring-black/5 p-1 z-[100]",
        fullWidth ? "left-0 right-0 w-full" : "right-0 w-72",
        "animate-in fade-in zoom-in-95 duration-200",
        className,
      )}
    >
       <div className="px-3 py-2">
         <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
           Organization
         </p>
         <p className="text-sm font-semibold truncate">{valueLabel ?? ""}</p>
       </div>
       <div className="h-px bg-border my-1" />
       <div className="px-2 pb-2">
         <div className="relative">
           <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
           <Input
             value={search}
             onChange={(e) => setSearch(e.target.value)}
             placeholder={placeholder ?? "Search organizations..."}
             className="pl-8 h-9"
           />
         </div>
       </div>
       <div ref={scrollRef} className="max-h-72 overflow-y-auto px-1 pb-1">
        {filtered.map((item) => (
           <button
             key={item.id}
             type="button"
            className="w-full h-9 px-3 rounded-lg text-sm font-medium text-left hover:bg-muted"
             onClick={() => {
               onSelect(item);
               onClose();
             }}
           >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{item.label}</span>
              {item.tag ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                    item.tagVariant === "success" && "border-emerald-600/30 bg-emerald-600/15 text-emerald-600",
                    item.tagVariant === "warning" && "border-amber-500/30 bg-amber-500/15 text-amber-600",
                    item.tagVariant === "destructive" && "border-red-600/30 bg-red-600/15 text-red-600",
                    item.tagVariant === "secondary" && "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {item.tag}
                </span>
              ) : null}
            </div>
           </button>
         ))}
         {loading ? (
           <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
         ) : null}
         {error ? <div className="px-3 py-2 text-xs text-destructive">{error}</div> : null}
         {!loading && filtered.length === 0 ? (
           <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
         ) : null}
         {!loading && canLoadMore ? (
           <div className="px-3 py-2">
             <Button
               variant="outline"
               size="sm"
               className="w-full"
               onClick={() => {
                 loadPage(offset, false).catch(() => {});
               }}
             >
               Load more
             </Button>
           </div>
         ) : null}
       </div>
     </div>
   );
 }
