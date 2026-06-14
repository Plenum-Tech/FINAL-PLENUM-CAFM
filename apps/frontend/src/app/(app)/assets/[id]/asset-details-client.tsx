"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit,
  Trash2,
  Activity,
  MapPin,
  Calendar,
  DollarSign,
  Zap,

} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/utils";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ConfirmDialog } from "@/components/common";
import { ApiError, apiFetch } from "@/services/api";
import { AssetDocumentsPanel } from "@/features/assets/asset-documents-panel";

type AssetStatus = "active" | "maintenance" | "warning" | "critical";

type PlenumAsset = {
  id: string;
  organization_id: string;
  location_id: string | null;
  category_id: string | null;
  asset_name: string;
  asset_code: string;
  serial_number: string | null;
  manufacturer: string | null;
  model_number: string | null;
  installation_date: string | null;
  warranty_expiry: string | null;
  status: string;
  health_score: number | null;
  qr_code: string | null;
  created_at: string;
  updated_at: string;
};

type Asset = {
  id: string;
  name: string;
  code: string;
  category: string;
  location: string;
  healthScore: number;
  status: AssetStatus;
  warrantyExpiry?: string;
  lastMaintenance?: string;
  createdAt: string;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  installationDate?: string;
  value?: number;
};

function toAssetStatus(value: string): AssetStatus {
  if (value === "active") return "active";
  if (value === "maintenance") return "maintenance";
  if (value === "warning") return "warning";
  if (value === "critical") return "critical";
  return "active";
}

function mapPlenumAsset(a: PlenumAsset): Asset {
  return {
    id: a.id,
    name: a.asset_name,
    code: a.asset_code,
    category: a.category_id ?? "N/A",
    location: a.location_id ?? "N/A",
    healthScore: Math.max(0, Math.min(100, Math.round(a.health_score ?? 0))),
    status: toAssetStatus(a.status),
    warrantyExpiry: a.warranty_expiry ?? undefined,
    lastMaintenance: undefined,
    createdAt: a.created_at,
    manufacturer: a.manufacturer ?? undefined,
    modelNumber: a.model_number ?? undefined,
    serialNumber: a.serial_number ?? undefined,
    installationDate: a.installation_date ?? undefined,
    value: undefined,
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message || "Something went wrong";
  return "Something went wrong";
}

function StatusBadge({ status }: { status: AssetStatus }) {
  const variants: Record<AssetStatus, "success" | "warning" | "destructive" | "secondary"> = {
    active: "success",
    maintenance: "warning",
    warning: "warning",
    critical: "destructive",
  };

  return (
    <Badge variant={variants[status]} className="capitalize">
      {status}
    </Badge>
  );
}

export function AssetDetailsClient({ assetId }: { assetId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery({
    queryKey: ["plenum-asset", assetId],
    retry: 0,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () => apiFetch<PlenumAsset>(`/api/v1/plenum/assets/${encodeURIComponent(assetId)}`),
  });

  const asset = useMemo(() => (query.data ? mapPlenumAsset(query.data) : null), [query.data]);

  const categoryQuery = useQuery({
    queryKey: ["plenum-asset-category", asset?.category],
    enabled: Boolean(asset?.category && asset.category !== "N/A"),
    retry: 0,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      apiFetch<{ id: string; name: string; description?: string }>(
        `/api/v1/plenum/asset-categories/${encodeURIComponent(asset!.category)}`
      ),
  });

  const categoryName = categoryQuery.data?.name || asset?.category || "N/A";

  const locationQuery = useQuery({
    queryKey: ["plenum-location", asset?.location],
    enabled: Boolean(asset?.location && asset.location !== "N/A"),
    retry: 0,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      apiFetch<{ id: string; name: string; type?: string; level?: number | null }>(
        `/api/v1/plenum/locations/${encodeURIComponent(asset!.location)}`
      ),
  });

  const locationName = locationQuery.data?.name || asset?.location || "N/A";

  const deleteMutation = useMutation<void, unknown, { id: string }>({
    mutationFn: async ({ id }) => {
      await apiFetch(`/api/v1/plenum/assets/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["plenum-assets"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-asset", assetId] });
      toast({ title: "Asset deleted", variant: "success" });
      router.push(APP_ROUTES.assets);
    },
    onError: (e) => {
      toast({
        title: "Failed to delete asset",
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
      return;
    }
    toast({ title: "Failed to load asset", description: getErrorMessage(e), variant: "destructive" });
  }, [query.error, query.isError, router]);

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (query.isError) {
    const e = query.error;
    if (e instanceof ApiError && e.status === 404) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Asset not found.</p>
          <Button variant="outline" asChild>
            <Link href={APP_ROUTES.assets}>Back to Assets</Link>
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{getErrorMessage(e)}</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!asset) return null;

  const manufacturer = asset.manufacturer || "Carrier";
  const modelNumber = asset.modelNumber || "CA-HVAC-5000";
  const serialNumber = asset.serialNumber || "SN-2024-HVAC-00301";
  const installationDate = asset.installationDate || "May 15, 2024";
  const assetValue = asset.value || 45000;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild className="rounded-full h-10 w-10">
            <Link href={APP_ROUTES.assets}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{asset.name}</h1>
              <StatusBadge status={asset.status} />
            </div>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">{asset.code}</span>
              <span className="text-sm">•</span>
              <span className="text-sm">{categoryName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" asChild className="gap-2">
            <Link href={`${APP_ROUTES.assets}/${asset.id}/edit`}>
              <Edit className="h-4 w-4" />
              <span>Edit Asset</span>
            </Link>
          </Button>
          <Button
            variant="destructive"
            className="gap-2"
            onClick={() => setConfirmOpen(true)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
            <span>{deleteMutation.isPending ? "Deleting..." : "Delete"}</span>
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete asset?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          await deleteMutation.mutateAsync({ id: asset.id });
          setConfirmOpen(false);
        }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <Activity className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Health Score</p>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">{asset.healthScore}</span>
                  <Badge
                    variant={asset.healthScore > 80 ? "success" : "warning"}
                    className="h-5 px-1.5 text-[10px]"
                  >
                    {asset.healthScore > 80 ? "Excellent" : "Needs Attention"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                <MapPin className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Location</p>
                <p className="text-xl font-bold truncate max-w-[150px]">{locationName}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-orange-500/10 flex items-center justify-content-center text-orange-500">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Warranty Ends</p>
                <p className="text-xl font-bold">{asset.warrantyExpiry || "N/A"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-500">
                <DollarSign className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Asset Value</p>
                <p className="text-xl font-bold">${assetValue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="border-none shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
            <CardHeader className="border-b bg-muted/30">
              <CardTitle className="text-lg">Asset Information</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {[
                  { label: "Asset Name", value: asset.name },
                  { label: "Asset Code", value: asset.code },
                  { label: "Category", value: categoryName },
                  { label: "Manufacturer", value: manufacturer },
                  { label: "Model Number", value: modelNumber },
                  { label: "Serial Number", value: serialNumber },
                  { label: "Installation Date", value: installationDate },
                  { label: "Created At", value: new Date(asset.createdAt).toLocaleDateString() },
                ].map((item, i) => (
                  <div
                    key={i}
                    className={cn(
                      "p-6 flex flex-col gap-1 border-b sm:border-r last:border-r-0",
                      (i === 6 || i === 7) && "border-b-0",
                    )}
                  >
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {item.label}
                    </span>
                    <span className="text-sm font-bold">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">Performance Monitoring</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full relative flex items-end justify-between gap-2 px-2 pb-8 border-b border-l mt-4">
                {[45, 60, 55, 75, 80, 70, 85, 90, 85, 95, 92, 88].map((h, i) => (
                  <div key={i} className="flex-1 group relative">
                    <div
                      className="w-full bg-primary/20 hover:bg-primary transition-all rounded-t-md relative"
                      style={{ height: `${h}%` }}
                    >
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-[10px] font-bold py-1 px-2 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                        {h}% Health
                      </div>
                    </div>
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground font-medium">
                      {i * 2}h
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">AI Recommendations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="p-4 rounded-xl border bg-background/50 space-y-2 hover:border-primary/50 transition-colors">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold">Vibration Alert</h4>
                  <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                    High
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Abnormal vibration pattern detected. Potential bearing wear. Scheduled inspection recommended within
                  48h.
                </p>
              </div>

              <div className="p-4 rounded-xl border bg-background/50 space-y-2 hover:border-primary/50 transition-colors">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold">Maintenance Window</h4>
                  <Badge variant="warning" className="h-5 px-1.5 text-[10px]">
                    Medium
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Next optimal maintenance window: March 22nd, 02:00 AM. Estimated downtime: 45 minutes.
                </p>
              </div>
            </CardContent>
          </Card>

          <AssetDocumentsPanel assetId={asset.id} />
        </div>
      </div>
    </div>
  );
}
