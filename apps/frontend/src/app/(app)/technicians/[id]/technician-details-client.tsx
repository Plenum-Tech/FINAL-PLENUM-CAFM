"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Mail, MapPin, Phone, Trash2, User, Wrench } from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { APP_ROUTES } from "@/constants";
import { ApiError } from "@/services/api";
import {
  deleteTechnician,
  getTechnician,
  technicianDisplayName,
  type PlenumTechnician,
} from "@/features/technicians/plenum-api";
import { TechnicianSkillsPanel } from "@/features/technicians/technician-skills-panel";

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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function TechnicianDetailsClient({ technicianId }: { technicianId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery<PlenumTechnician, unknown>({
    queryKey: ["plenum-technician", technicianId],
    retry: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    queryFn: ({ signal }) => getTechnician({ id: technicianId, signal }),
  });

  useEffect(() => {
    if (!query.isError) return;
    const e = query.error;
    if (e instanceof ApiError && e.status === 401) router.replace(APP_ROUTES.login);
  }, [query.error, query.isError, router]);

  const del = useMutation<void, unknown>({
    mutationFn: async () => deleteTechnician({ id: technicianId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["plenum-technicians"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-technician", technicianId] });
      toast({ title: "Technician deleted", variant: "success" });
      router.push(APP_ROUTES.technicians);
    },
    onError: (e) => {
      toast({ title: "Failed to delete technician", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const name = useMemo(() => (query.data ? technicianDisplayName(query.data) : ""), [query.data]);
  const availability = query.data?.availability_status ?? "-";
  const baseLocation = query.data?.base_location ?? "-";
  const score = typeof query.data?.performance_score === "number" ? query.data.performance_score : 0;

  const chartBars = useMemo(() => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const base = clamp01(score / 100);
    return months.map((m, i) => {
      const wave = (i % 2 === 0 ? 0.08 : -0.05) + (i === 3 ? 0.12 : 0);
      const v = clamp01(base + wave);
      return { month: m, value: v };
    });
  }, [score]);

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

  const t = query.data;
  if (!t) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Back">
            <Link href={APP_ROUTES.technicians}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="space-y-1">
            <div className="text-2xl font-bold leading-tight">{name || "-"}</div>
            <div className="text-sm text-muted-foreground">{t.user_id ? `User: ${t.user_id}` : "Technician"}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild className="gap-2">
            <Link href={`${APP_ROUTES.technicians}/${t.id}/edit`}>
              <User className="h-4 w-4" />
              Edit Profile
            </Link>
          </Button>
          <Button variant="destructive" className="gap-2" disabled={del.isPending} onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.6fr]">
        <div className="space-y-4">
          <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-4 w-4" />
                <span>-</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span>-</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{baseLocation}</span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <div className="text-muted-foreground">Availability</div>
                <Badge variant={availabilityVariant(t.availability_status)} className="capitalize">
                  {availability}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <TechnicianSkillsPanel technicianId={t.id} />
        </div>

        <div className="space-y-4">
          <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Performance Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <div className="text-muted-foreground">Score</div>
                <div className="font-semibold">{score}</div>
              </div>
              <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${clamp01(score / 100) * 100}%` }} />
              </div>
              <div className="rounded-xl border border-border/60 bg-background/30 p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BarChart3 className="h-4 w-4" />
                  Last 6 months (demo)
                </div>
                <div className="mt-3 grid grid-cols-6 items-end gap-2 h-28">
                  {chartBars.map((b) => (
                    <div key={b.month} className="flex flex-col items-center gap-2">
                      <div className="w-full rounded-md bg-primary/70" style={{ height: `${Math.round(b.value * 100)}%` }} />
                      <div className="text-[11px] text-muted-foreground">{b.month}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Work Orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">No recent work orders.</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Wrench className="h-4 w-4" />
                Work order history will appear here.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete technician?"
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
