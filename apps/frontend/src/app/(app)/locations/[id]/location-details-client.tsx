"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ConfirmDialog } from "@/components/common";
import { ApiError, apiFetch } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";

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

export function LocationDetailsClient({ locationId }: { locationId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery<PlenumLocation, unknown>({
    queryKey: ["plenum-location", locationId],
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      apiFetch<PlenumLocation>(`/api/v1/plenum/locations/${encodeURIComponent(locationId)}`, {
        signal,
      }),
  });

  const parentQuery = useQuery<PlenumLocation, unknown>({
    queryKey: ["plenum-location", query.data?.parent_location_id],
    enabled: Boolean(query.data?.parent_location_id),
    retry: 0,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch<PlenumLocation>(
        `/api/v1/plenum/locations/${encodeURIComponent(query.data?.parent_location_id ?? "")}`,
        { signal },
      ),
  });

  const deleteMutation = useMutation<void, unknown, { id: string }>({
    mutationFn: async ({ id }) => {
      await apiFetch(`/api/v1/plenum/locations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["plenum-locations"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-location", locationId] });
      toast({ title: "Location deleted", variant: "success" });
      router.push(APP_ROUTES.locations);
    },
    onError: (e) => {
      toast({
        title: "Failed to delete location",
        description: getErrorMessage(e),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!query.isError) return;
    const e = query.error;
    if (e instanceof ApiError && e.status === 401) {
      router.replace(APP_ROUTES.login);
    }
  }, [query.error, query.isError, router]);

  const parentLabel = useMemo(() => {
    if (parentQuery.data?.name) return parentQuery.data.name;
    return query.data?.parent_location_id ?? "-";
  }, [parentQuery.data?.name, query.data?.parent_location_id]);

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (query.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{getErrorMessage(query.error)}</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const location = query.data;
  if (!location) return null;
  const orgName = orgSelected?.id === location.organization_id ? orgSelected.name : location.organization_id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild className="gap-2">
          <Link href={APP_ROUTES.locations}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild className="gap-2">
            <Link href={`${APP_ROUTES.locations}/${location.id}/edit`}>
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          </Button>
          <Button
            variant="destructive"
            className="gap-2"
            disabled={deleteMutation.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>

      <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {location.name}
            <Badge variant="secondary">{location.type}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Organization</div>
            <div className="text-sm font-medium break-all">{orgName}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Level</div>
            <div className="text-sm font-medium">{typeof location.level === "number" ? location.level : "-"}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Parent</div>
            <div className="text-sm font-medium break-all">{parentLabel}</div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete location?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          await deleteMutation.mutateAsync({ id: location.id });
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}
