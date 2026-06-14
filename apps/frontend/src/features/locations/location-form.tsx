"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, CardContent, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { apiFetch, ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type Mode = "create" | "edit";

type PlenumLocation = {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  parent_location_id: string | null;
  level: number | null;
  created_at?: string;
  updated_at?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

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

async function fetchLocationOptions(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  params.set("organization_id", input.organizationId);
  if (input.search.trim()) params.set("search", input.search.trim());

  const payload = await apiFetch<unknown>(`/api/v1/plenum/locations?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.locations) ? obj.locations : [];
  const data = raw
    .map((x): InfiniteSelectItem | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id =
        typeof r.id === "string" ? r.id : typeof r.location_id === "string" ? r.location_id : "";
      const name =
        typeof r.name === "string"
          ? r.name
          : typeof r.location_name === "string"
            ? r.location_name
            : "";
      if (!id.trim() || !name.trim()) return null;
      return { id, label: name };
    })
    .filter((v): v is InfiniteSelectItem => Boolean(v));

  return { total, data };
}

async function resolveLocationLabelById(input: {
  organizationId: string;
  locationId: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { data } = await fetchLocationOptions({
    organizationId: input.organizationId,
    limit: 30,
    offset: 0,
    search: "",
    signal: input.signal,
  });
  const found = data.find((d) => d.id === input.locationId);
  return found?.label ?? null;
}

export function LocationForm({ mode, locationId }: { mode: Mode; locationId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";
  const organizationName = orgSelected?.name ?? "";

  const [name, setName] = useState("");
  const [type, setType] = useState("area");
  const [level, setLevel] = useState<number>(0);
  
  const [parentOpen, setParentOpen] = useState(false);
  const [parent, setParent] = useState<InfiniteSelectItem | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const detailsQuery = useQuery<PlenumLocation, unknown>({
    queryKey: ["plenum-location", locationId],
    enabled: mode === "edit" && Boolean(locationId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      apiFetch<PlenumLocation>(`/api/v1/plenum/locations/${encodeURIComponent(locationId ?? "")}`, {
        signal,
      }),
  });

  useEffect(() => {
    if (mode !== "edit") return;
    if (!detailsQuery.data) return;
    const l = detailsQuery.data;
    setName(l.name ?? "");
    setType(l.type ?? "area");
    setLevel(typeof l.level === "number" ? l.level : 0);
    setParent(l.parent_location_id ? { id: l.parent_location_id, label: l.parent_location_id } : null);
    setSubmitError(null);
    setFieldErrors({});
  }, [detailsQuery.data, mode]);

  useEffect(() => {
    if (mode !== "edit") return;
    if (!organizationId) return;
    if (!parent?.id || parent.label !== parent.id) return;
    const ac = new AbortController();
    void resolveLocationLabelById({ organizationId, locationId: parent.id, signal: ac.signal })
      .then((label) => {
        if (label) setParent({ id: parent.id, label });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [mode, organizationId, parent?.id, parent?.label]);

  useEffect(() => {
    setParent(null);
  }, [organizationId]);

  const saveMutation = useMutation<void, unknown, void>({
    mutationFn: async () => {
      const next: Record<string, string> = {};
      if (!organizationId) next.organization_id = "Organization is required.";
      if (!name.trim()) next.name = "Name is required.";
      if (!type.trim()) next.type = "Type is required.";
      if (!Number.isFinite(level) || level < 0) next.level = "Level must be 0 or greater.";
      if (parent?.id && !isUuid(parent.id)) next.parent_location_id = "Invalid parent location id.";

      if (Object.keys(next).length) {
        setFieldErrors(next);
        throw new Error("VALIDATION");
      }

      setFieldErrors({});

      if (mode === "create") {
        await apiFetch("/api/v1/plenum/locations", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            organization_id: organizationId,
            name: name.trim(),
            type: type.trim(),
            parent_location_id: parent?.id || null,
            level,
          },
        });
      } else {
        await apiFetch(`/api/v1/plenum/locations/${encodeURIComponent(locationId ?? "")}`, {
          method: "PUT",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            name: name.trim(),
            type: type.trim(),
            parent_location_id: parent?.id || null,
            level,
          },
        });
      }
    },
    onSuccess: async () => {
      toast({
        title: mode === "create" ? "Location created" : "Location updated",
        variant: "success",
      });
      queryClient.removeQueries({ queryKey: ["plenum-locations"] });
      queryClient.removeQueries({ queryKey: ["plenum-location"] });
      router.push(APP_ROUTES.locations);
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "VALIDATION") return;
      setSubmitError(getErrorMessage(e));
    },
  });

  const disabled = saveMutation.isPending || !organizationId;

  if (mode === "edit" && detailsQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (mode === "edit" && detailsQuery.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{getErrorMessage(detailsQuery.error)}</p>
        <Button variant="outline" onClick={() => detailsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <form
      className="w-full"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitError(null);
        saveMutation.mutate();
      }}
    >
      <Card className="w-full py-6">
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <CardTitle>{mode === "create" ? "New Location" : "Edit Location"}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {organizationName || "Select organization from header"}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
                {fieldErrors.name ? <p className="text-xs text-destructive">{fieldErrors.name}</p> : null}
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium">Parent Location (Optional)</label>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between"
                      onClick={() => setParentOpen((v) => !v)}
                      disabled={!organizationId}
                    >
                      <span className="truncate">{parent?.label ?? "No parent"}</span>
                    </Button>
                    <InfiniteSelect
                      open={parentOpen}
                      onClose={() => setParentOpen(false)}
                      onSelect={(item) => setParent(item)}
                      valueLabel={parent?.label ?? ""}
                      placeholder="Search locations..."
                      pageSize={20}
                      cacheKey={organizationId ? `loc-parents:${organizationId}` : undefined}
                      cacheTTL={90_000}
                      fullWidth
                      fetchPage={({ limit, offset, search, signal }) =>
                        fetchLocationOptions({ organizationId, limit, offset, search, signal })
                      }
                    />
                  </div>
                  {fieldErrors.parent_location_id ? (
                    <p className="text-xs text-destructive">{fieldErrors.parent_location_id}</p>
                  ) : null}
                </div>

                <div className="w-full md:w-60 space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <div>
                    <select value={type} onChange={(e) => setType(e.target.value)} className={selectClassName}>
                      <option value="building">Building</option>
                      <option value="floor">Floor</option>
                      <option value="area">Area</option>
                      <option value="room">Room</option>
                      <option value="zone">Zone</option>
                    </select>
                  </div>
                  {fieldErrors.type ? <p className="text-xs text-destructive">{fieldErrors.type}</p> : null}
                </div>

                <div className="w-full md:w-52 space-y-2">
                  <label className="text-sm font-medium">Level</label>
                  <Input
                    type="number"
                    min={0}
                    value={String(level)}
                    onChange={(e) => setLevel(Number(e.target.value || "0"))}
                  />
                  {fieldErrors.level ? <p className="text-xs text-destructive">{fieldErrors.level}</p> : null}
                </div>
              </div>
            </div>

            

            
          </div>

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="secondary" disabled={saveMutation.isPending}>
              <Link href={APP_ROUTES.locations}>Cancel</Link>
            </Button>
            <Button disabled={disabled} type="submit">
              {saveMutation.isPending ? "Saving..." : mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
