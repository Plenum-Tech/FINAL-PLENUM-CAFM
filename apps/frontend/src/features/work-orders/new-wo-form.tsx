"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Search, XCircle, AlertTriangle } from "lucide-react";

import { Button, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import {
  buildWoSseUrl,
  getWoErrorMessage,
  type SSEEvent,
  type WorkOrderResponse,
  woFetch,
} from "@/features/work-orders/wo-api";

// ─── API types ───────────────────────────────────────────────────────────────

export interface AssetOption {
  asset_id: string;
  asset_name: string;
  asset_code: string;
  category: string;
}

export interface LocationOption {
  location_id: string;
  name: string;
}

// ─── Autocomplete field ──────────────────────────────────────────────────────

export function AutocompleteField<T>({
  label,
  value,
  onChange,
  placeholder,
  fetchOptions,
  getOptionLabel,
  required,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  fetchOptions: (q: string) => Promise<T[]>;
  getOptionLabel: (opt: T) => string;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(v: string) {
    onChange(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (v.length >= 1) {
        try {
          const opts = await fetchOptions(v);
          setSuggestions(opts);
          setOpen(opts.length > 0);
        } catch {
          setSuggestions([]);
          setOpen(false);
        }
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    }, 300);
  }

  return (
    <div className="space-y-1.5 relative">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          required={required}
          className="w-full h-10 rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && (
        <div className="absolute z-50 w-full rounded-md border bg-popover shadow-lg overflow-hidden mt-1 max-h-48 overflow-y-auto">
          {suggestions.map((opt, i) => (
            <button
              key={i}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted/60 truncate"
              onMouseDown={() => {
                onChange(getOptionLabel(opt));
                setOpen(false);
              }}
            >
              {getOptionLabel(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Post-creation approval watcher ─────────────────────────────────────────

type WatchStep = {
  key: string;
  label: string;
  state: "pending" | "running" | "done" | "error" | "warning";
  message?: string;
};

export function ApprovalWatcher({ woId, onNavigate }: { woId: string; onNavigate: () => void }) {
  const [steps, setSteps] = useState<WatchStep[]>([
    { key: "waiting_approval", label: "Awaiting Manager Approval", state: "running" },
    { key: "technician_assigned", label: "Technician Assignment", state: "pending" },
    { key: "notifications_sent", label: "Notifications Sent", state: "pending" },
  ]);

  useEffect(() => {
    const url = buildWoSseUrl(`/api/email/watch/${encodeURIComponent(woId)}`);
    const es = new EventSource(url);

    es.onmessage = (event) => {
      if (event.data === "[DONE]") {
        es.close();
        setTimeout(onNavigate, 1200);
        return;
      }
      try {
        const payload = JSON.parse(event.data) as SSEEvent;
        setSteps((prev) =>
          prev.map((s) => {
            if (s.key === payload.step) {
              const state =
                payload.status === "complete"
                  ? "done"
                  : payload.status === "error"
                    ? "error"
                    : payload.status === "warning"
                      ? "warning"
                      : "running";
              return { ...s, state, message: payload.message };
            }
            if (
              payload.step === "waiting_approval" &&
              payload.status === "complete" &&
              s.key === "technician_assigned"
            ) {
              return { ...s, state: "running" };
            }
            if (
              payload.step === "technician_assigned" &&
              payload.status === "complete" &&
              s.key === "notifications_sent"
            ) {
              return { ...s, state: "running" };
            }
            return s;
          }),
        );
        if (payload.step === "notifications_sent" && payload.status === "complete") {
          setTimeout(onNavigate, 1200);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => es.close();
    return () => es.close();
  }, [woId, onNavigate]);

  function stepIcon(state: WatchStep["state"]) {
    if (state === "done") return <CheckCircle2 size={13} className="text-green-600" />;
    if (state === "error") return <XCircle size={13} className="text-red-500" />;
    if (state === "warning") return <AlertTriangle size={13} className="text-amber-500" />;
    if (state === "running") return <Loader2 size={13} className="animate-spin text-blue-500" />;
    return <span className="h-2 w-2 rounded-full bg-slate-300" />;
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-5 space-y-4">
      <div className="text-sm font-semibold text-blue-800">Work order created — watching for approval</div>
      <div className="text-xs font-mono text-blue-600 bg-blue-100 px-2 py-1 rounded inline-block">{woId}</div>
      <div className="space-y-3 pt-1">
        {steps.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white">
              {stepIcon(s.state)}
            </div>
            <div>
              <div
                className={[
                  "text-xs font-medium",
                  s.state === "done"
                    ? "text-green-700"
                    : s.state === "error"
                      ? "text-red-600"
                      : s.state === "running"
                        ? "text-blue-700"
                        : "text-muted-foreground",
                ].join(" ")}
              >
                {s.label}
              </div>
              {s.message && (
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.message}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={onNavigate} className="w-full gap-2 mt-2">
        <CheckCircle2 size={13} />
        View Work Order
      </Button>
    </div>
  );
}

// ─── Main form ───────────────────────────────────────────────────────────────

export function NewWoForm() {
  const router = useRouter();

  const [source, setSource] = useState("manual");
  const [asset, setAsset] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [requestType, setRequestType] = useState("repair");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");

  const [createdWoId, setCreatedWoId] = useState<string | null>(null);

  const createMutation = useMutation<WorkOrderResponse>({
    mutationFn: () =>
      woFetch<WorkOrderResponse>("/api/work-orders/", {
        method: "POST",
        body: {
          source,
          asset,
          location,
          issue_description: description,
          priority,
          request_type: requestType,
          requester_name: requesterName,
          requester_email: requesterEmail,
          ...(requesterPhone.trim() ? { requester_phone: requesterPhone.trim() } : {}),
        },
      }),
    onSuccess: (data) => {
      toast({ title: `Work order ${data.work_order_id} created`, variant: "success" });
      setCreatedWoId(data.work_order_id);
    },
    onError: (e) => {
      toast({
        title: "Failed to create work order",
        description: getWoErrorMessage(e),
        variant: "destructive",
      });
    },
  });

  const fetchAssets = useCallback(
    (q: string) =>
      woFetch<AssetOption[]>(`/api/assets?q=${encodeURIComponent(q)}&limit=10`),
    [],
  );

  const fetchLocations = useCallback(
    (q: string) =>
      woFetch<LocationOption[]>(`/api/locations?q=${encodeURIComponent(q)}&limit=20`),
    [],
  );

  if (createdWoId) {
    return (
      <ApprovalWatcher
        woId={createdWoId}
        onNavigate={() => router.push(`${APP_ROUTES.workOrders}/${createdWoId}`)}
      />
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Source / Priority / Request Type */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Source <span className="text-destructive">*</span>
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="manual">Manual</option>
            <option value="email">Email</option>
            <option value="ppm">PPM</option>
            <option value="tenant">Tenant</option>
            <option value="internal">Internal</option>
            <option value="remediation">Remediation</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Request Type</label>
          <select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="repair">Repair</option>
            <option value="maintenance">Maintenance</option>
            <option value="inspection">Inspection</option>
            <option value="installation">Installation</option>
          </select>
        </div>
      </div>

      {/* Asset + Location */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AutocompleteField<AssetOption>
          label="Asset"
          value={asset}
          onChange={setAsset}
          placeholder="Search or type asset name / code…"
          fetchOptions={fetchAssets}
          getOptionLabel={(opt) => opt.asset_name || opt.asset_code}
          required
        />
        <AutocompleteField<LocationOption>
          label="Location"
          value={location}
          onChange={setLocation}
          placeholder="Search or type location…"
          fetchOptions={fetchLocations}
          getOptionLabel={(opt) => opt.name}
          required
        />
      </div>

      {/* Issue description */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          Issue Description <span className="text-destructive">*</span>
        </label>
        <textarea
          required
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Describe the issue in detail…"
        />
      </div>

      {/* Requester */}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Requester
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Full name"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Email <span className="text-destructive">*</span>
            </label>
            <input
              type="email"
              required
              value={requesterEmail}
              onChange={(e) => setRequesterEmail(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="name@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Phone</label>
            <input
              type="tel"
              value={requesterPhone}
              onChange={(e) => setRequesterPhone(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="+971-50-123-4567"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={createMutation.isPending} className="gap-2 min-w-[160px]">
          {createMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          {createMutation.isPending ? "Creating…" : "Create Work Order"}
        </Button>
      </div>
    </form>
  );
}
