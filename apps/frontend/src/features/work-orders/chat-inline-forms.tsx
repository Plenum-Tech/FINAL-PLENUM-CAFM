"use client";

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronUp, Plus } from "lucide-react";

import { Button, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import {
  AutocompleteField,
  ApprovalWatcher,
  type AssetOption,
  type LocationOption,
} from "@/features/work-orders/new-wo-form";
import { getWoErrorMessage, type WorkOrderResponse, woFetch } from "@/features/work-orders/wo-api";
import { useRouter } from "next/navigation";

/** Same payload shape as the preparation card on the WO detail page. */
export function PreparationInChatForm({
  workOrderId,
  disabled,
  onSuccess,
}: {
  workOrderId: string;
  disabled?: boolean;
  onSuccess?: () => void | Promise<void>;
}) {
  const [vendor, setVendor] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [duration, setDuration] = useState("");
  const [inspection, setInspection] = useState(false);
  const [special, setSpecial] = useState("");

  const mutation = useMutation<WorkOrderResponse>({
    mutationFn: () =>
      woFetch<WorkOrderResponse>(`/api/work-orders/${encodeURIComponent(workOrderId)}/prepare`, {
        method: "POST",
        body: {
          ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
          ...(scheduledDate ? { scheduled_date: scheduledDate } : {}),
          ...(scheduledTime ? { scheduled_time: scheduledTime } : {}),
          ...(duration ? { estimated_duration: parseFloat(duration) } : {}),
          inspection_required: inspection,
          ...(special.trim() ? { special_requirements: special.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      toast({ title: "Preparation saved — work order is now prepared", variant: "success" });
      await onSuccess?.();
    },
    onError: (e) => {
      toast({ title: "Preparation failed", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
        <CalendarClock size={14} className="shrink-0" />
        Preparation (in chat)
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-amber-950">Vendor</label>
          <input
            type="text"
            disabled={disabled || mutation.isPending}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            placeholder="Contractor name"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-amber-950">Duration (h)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            disabled={disabled || mutation.isPending}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            placeholder="e.g. 2.5"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-amber-950">Date</label>
          <input
            type="date"
            disabled={disabled || mutation.isPending}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-amber-950">Time</label>
          <input
            type="time"
            disabled={disabled || mutation.isPending}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-amber-950">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-input"
          checked={inspection}
          disabled={disabled || mutation.isPending}
          onChange={(e) => setInspection(e.target.checked)}
        />
        Inspection required
      </label>
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-amber-950">Special requirements</label>
        <textarea
          rows={2}
          disabled={disabled || mutation.isPending}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-none"
          placeholder="Optional notes"
          value={special}
          onChange={(e) => setSpecial(e.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
        className="w-full bg-amber-700 hover:bg-amber-800 text-white"
        disabled={disabled || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Saving…" : "Mark prepared with these details"}
      </Button>
    </div>
  );
}

/** Compact create flow for the concierge chat (same API as full new-WO form). */
export function QuickCreateWorkOrderInChat() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source] = useState("manual");
  const [asset, setAsset] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [requestType, setRequestType] = useState("repair");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [createdWoId, setCreatedWoId] = useState<string | null>(null);

  const fetchAssets = useCallback(
    (q: string) => woFetch<AssetOption[]>(`/api/assets?q=${encodeURIComponent(q)}&limit=10`),
    [],
  );
  const fetchLocations = useCallback(
    (q: string) => woFetch<LocationOption[]>(`/api/locations?q=${encodeURIComponent(q)}&limit=20`),
    [],
  );

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
      toast({ title: `Created ${data.work_order_id}`, variant: "success" });
      setCreatedWoId(data.work_order_id);
      setOpen(false);
    },
    onError: (e) => {
      toast({ title: "Create failed", description: getWoErrorMessage(e), variant: "destructive" });
    },
  });

  if (createdWoId) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
        <div className="text-xs font-medium text-emerald-900">Work order created</div>
        <ApprovalWatcher
          woId={createdWoId}
          onNavigate={() => router.push(`${APP_ROUTES.workOrders}/${createdWoId}`)}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white/90 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 rounded-xl"
      >
        <span className="inline-flex items-center gap-2">
          <Plus size={14} className="text-indigo-600" />
          Create work order (form)
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open ? (
        <form
          className="px-3 pb-3 pt-0 space-y-3 border-t border-slate-100"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <AutocompleteField<AssetOption>
              label="Asset"
              value={asset}
              onChange={setAsset}
              placeholder="Search asset…"
              fetchOptions={fetchAssets}
              getOptionLabel={(o) => o.asset_name}
              required
            />
            <AutocompleteField<LocationOption>
              label="Location"
              value={location}
              onChange={setLocation}
              placeholder="Search location…"
              fetchOptions={fetchLocations}
              getOptionLabel={(o) => o.name}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Issue / description</label>
            <textarea
              required
              rows={2}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Requester</label>
              <input
                required
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={requesterName}
                onChange={(e) => setRequesterName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Email</label>
              <input
                required
                type="email"
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={requesterEmail}
                onChange={(e) => setRequesterEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Priority</label>
              <select
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-medium">Request type</label>
              <select
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={requestType}
                onChange={(e) => setRequestType(e.target.value)}
              >
                <option value="repair">Repair</option>
                <option value="maintenance">Maintenance</option>
                <option value="inspection">Inspection</option>
                <option value="installation">Installation</option>
              </select>
            </div>
          </div>
          <input
            type="text"
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            placeholder="Phone (optional)"
            value={requesterPhone}
            onChange={(e) => setRequesterPhone(e.target.value)}
          />
          <Button type="submit" size="sm" className="w-full" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create work order"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
