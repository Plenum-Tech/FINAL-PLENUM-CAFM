"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Mail, Phone, ShieldCheck, Trash2, User, XCircle } from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import { deleteUser, getUser, type PlenumUser } from "@/features/users/plenum-api";

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

export function UserDetailsClient({ userId }: { userId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery<PlenumUser, unknown>({
    queryKey: ["plenum-user", userId],
    retry: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    queryFn: ({ signal }) => getUser({ id: userId, signal }),
  });

  useEffect(() => {
    if (!query.isError) return;
    const e = query.error;
    if (e instanceof ApiError && e.status === 401) router.replace(APP_ROUTES.login);
  }, [query.error, query.isError, router]);

  const del = useMutation<void, unknown>({
    mutationFn: async () => deleteUser({ id: userId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["plenum-users"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-user", userId] });
      toast({ title: "User deleted", variant: "success" });
      router.push(APP_ROUTES.users);
    },
    onError: (e) => {
      toast({ title: "Failed to delete user", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const title = useMemo(() => query.data?.full_name ?? "User", [query.data?.full_name]);

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

  const u = query.data;
  if (!u) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Back">
            <Link href={APP_ROUTES.users}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="space-y-1">
            <div className="text-2xl font-bold leading-tight">{title}</div>
            <div className="text-sm text-muted-foreground">
              User ID: <span className="font-mono">{u.id}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild className="gap-2">
            <Link href={`${APP_ROUTES.users}/${u.id}/edit`}>
              <User className="h-4 w-4" />
              Edit
            </Link>
          </Button>
          <Button variant="destructive" className="gap-2" disabled={del.isPending} onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>{u.email || "-"}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4" />
              <span>{u.phone || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Status
              </div>
              <Badge variant={statusVariant(u.status)} className="capitalize">
                {u.status || "-"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground">Email Verified</div>
              <div className="flex items-center gap-2">
                {u.email_verified ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">{u.email_verified ? "Yes" : "No"}</span>
              </div>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="text-muted-foreground">Created</div>
              <div className="font-medium text-right">
                {u.created_at ? new Date(u.created_at).toLocaleString() : "-"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete user?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={del.isPending}
        onConfirm={async () => {
          await del.mutateAsync();
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}

