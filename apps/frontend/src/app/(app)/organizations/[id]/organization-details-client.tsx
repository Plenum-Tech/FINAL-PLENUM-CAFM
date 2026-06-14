"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";

import { Button, Card, CardContent, CardHeader, CardTitle, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import { deleteOrganization, getOrganization, type PlenumOrganization } from "@/features/organizations/plenum-api";

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

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function OrganizationDetailsClient({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setOrgSelected = useOrganizationStore((s) => s.setSelected);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery<PlenumOrganization, unknown>({
    queryKey: ["plenum-organization", organizationId],
    retry: 0,
    staleTime: 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getOrganization({ id: organizationId, signal }),
  });

  useEffect(() => {
    if (!query.isError) return;
    toast({
      title: "Failed to load organization",
      description: getErrorMessage(query.error),
      variant: "destructive",
    });
  }, [query.error, query.isError]);

  const delMutation = useMutation<void, unknown>({
    mutationFn: async () => {
      await deleteOrganization({ id: organizationId });
    },
    onSuccess: async () => {
      toast({ title: "Organization deleted", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["plenum-organizations"] });
      router.push(APP_ROUTES.organizations);
    },
    onError: (e) => {
      toast({ title: "Failed to delete organization", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const org = query.data;

  const rows = useMemo(() => {
    if (!org) return [];
    return [
      { label: "Organization ID", value: org.id },
      { label: "Name", value: org.name },
      { label: "Industry", value: org.industry || "-" },
      { label: "Country", value: org.country || "-" },
      { label: "Timezone", value: org.timezone || "-" },
      { label: "Status", value: org.status || "-" },
      { label: "Created At", value: formatDateTime(org.created_at) },
      { label: "Updated At", value: formatDateTime(org.updated_at) },
    ];
  }, [org]);

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (!org) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">Organization not found.</div>
        <Button asChild variant="outline">
          <Link href={APP_ROUTES.organizations}>Back</Link>
        </Button>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <Card className="bg-card/50 backdrop-blur-sm">
        <CardContent className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="icon">
              <Link href={APP_ROUTES.organizations} aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="min-w-0">
              <CardTitle className="truncate">{org.name}</CardTitle>
              <div className="text-xs text-muted-foreground truncate">{org.id}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setOrgSelected({ id: org.id, name: org.name });
                toast({ title: "Organization selected", variant: "success" });
              }}
            >
              Select
            </Button>
            <Button asChild variant="outline">
              <Link href={`${APP_ROUTES.organizations}/${org.id}/edit`} prefetch={false}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button variant="destructive" type="button" onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Organization Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="rounded-lg border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">{r.label}</div>
              <div className="mt-1 text-sm font-medium break-words">{r.value}</div>
            </div>
          ))}
          <div className="sm:col-span-2 rounded-lg border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Address</div>
            <div className="mt-1 text-sm font-medium whitespace-pre-wrap">{org.address || "-"}</div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete organization?"
        description="This will permanently delete the organization."
        confirmText={delMutation.isPending ? "Deleting..." : "Delete"}
        confirmVariant="destructive"
        pending={delMutation.isPending}
        onConfirm={() => delMutation.mutate()}
      />
    </main>
  );
}
