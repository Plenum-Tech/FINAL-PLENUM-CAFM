"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";

import { Badge, Button, Card, CardContent, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ApiError, apiFetch } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import {
  createTechnician,
  getTechnician,
  updateTechnician,
  type PlenumTechnician,
} from "@/features/technicians/plenum-api";
import { InfiniteSelect, type InfiniteSelectItem } from "@/components/ui/infinite-select";
import { getUser, listUsers } from "@/features/users/plenum-api";

type Mode = "create" | "edit";

type FastApiValidationIssue = {
  loc: Array<string | number>;
  msg: string;
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

function extractFieldErrorsFromPayload(payload: unknown): Record<string, string> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  const out: Record<string, string> = {};
  if ("detail" in rec) {
    const detail = (rec as { detail: unknown }).detail;
    if (Array.isArray(detail)) {
      for (const it of detail) {
        if (typeof it !== "object" || it === null) continue;
        const issue = it as Partial<FastApiValidationIssue>;
        if (Array.isArray(issue.loc) && typeof issue.msg === "string") {
          const key = [...issue.loc].reverse().find((x) => typeof x === "string" && (x as string).trim());
          if (typeof key === "string") out[key] = issue.msg;
        }
      }
    } else if (typeof detail === "string") {
      out._ = detail;
    }
  }
  return Object.keys(out).length ? out : null;
}

type PlenumLocationLite = { id: string; name: string };

function parseSkills(input: string | null | undefined): string[] {
  const raw = (input ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[,|\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function addSkill(list: string[], raw: string): string[] {
  const v = raw.trim();
  if (!v) return list;
  const exists = list.some((x) => x.toLowerCase() === v.toLowerCase());
  if (exists) return list;
  return [...list, v];
}

function removeSkill(list: string[], skill: string): string[] {
  return list.filter((x) => x !== skill);
}

function SkillChipsInput({
  label,
  placeholder,
  values,
  onChange,
  error,
  optional = false,
}: {
  label: string;
  placeholder?: string;
  values: string[];
  onChange: (next: string[]) => void;
  error?: string;
  optional?: boolean;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        {label}
        {optional ? <span className="text-muted-foreground"> (Optional)</span> : null}
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            const next = addSkill(values, draft);
            if (next !== values) onChange(next);
            setDraft("");
          } else if (e.key === "Backspace" && !draft.trim() && values.length) {
            e.preventDefault();
            onChange(values.slice(0, -1));
          }
        }}
      />
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-[220px] truncate">{v}</span>
              <button
                type="button"
                className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted"
                onClick={() => onChange(removeSkill(values, v))}
                aria-label={`Remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-[11px] text-muted-foreground">Type and press Enter to add.</p>
    </div>
  );
}

function userLabelToTechName(label: string): string {
  const idx = label.indexOf(" (");
  if (idx > 0) return label.slice(0, idx).trim();
  return label.trim();
}

async function fetchUsersSelectPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const page = await listUsers({
    organizationId: input.organizationId,
    limit: input.limit,
    offset: input.offset,
    search: input.search,
    signal: input.signal,
  });

  const data = page.data.map((u) => {
    const name = u.full_name?.trim() ?? "";
    const email = u.email?.trim() ?? "";
    const label = name && email ? `${name} (${email})` : name || email || u.id;
    return { id: u.id, label };
  });
  return { total: page.total, data };
}

async function fetchLocationsSelectPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
  signal?: AbortSignal;
}): Promise<{ total: number; data: InfiniteSelectItem[] }> {
  const params = new URLSearchParams();
  params.set("organization_id", input.organizationId);
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  if (input.search.trim()) params.set("search", input.search.trim());
  const payload = await apiFetch<unknown>(`/api/v1/plenum/locations?${params.toString()}`, { signal: input.signal });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.locations) ? obj.locations : [];
  const data: InfiniteSelectItem[] = raw
    .map((x): PlenumLocationLite | null => {
      if (typeof x !== "object" || x === null) return null;
      const r = x as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      const name = typeof r.name === "string" ? r.name : "";
      if (!id.trim() || !name.trim()) return null;
      return { id, name };
    })
    .filter((v): v is PlenumLocationLite => Boolean(v))
    .map((l) => ({ id: l.id, label: l.name }));
  return { total, data };
}

export function TechnicianForm({ mode, technicianId }: { mode: Mode; technicianId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgSelected = useOrganizationStore((s) => s.selected);
  const orgId = orgSelected?.id ?? "";
  const orgName = orgSelected?.name ?? "";

  const [userOpen, setUserOpen] = useState(false);
  const [user, setUser] = useState<InfiniteSelectItem | null>(null);

  const [locationOpen, setLocationOpen] = useState(false);
  const [location, setLocation] = useState<InfiniteSelectItem | null>(null);
  const [baseSiteId, setBaseSiteId] = useState("");

  const [techId, setTechId] = useState("");
  const [techName, setTechName] = useState("");
  const [primarySkills, setPrimarySkills] = useState<string[]>([]);
  const [secondarySkills, setSecondarySkills] = useState<string[]>([]);
  const [level, setLevel] = useState("Tech");
  const [shift, setShift] = useState("Day");
  const [employmentType, setEmploymentType] = useState("Inhouse");
  const [hourlyCostAed, setHourlyCostAed] = useState<string>("");

  const [availabilityStatus, setAvailabilityStatus] = useState("available");
  const [performanceScore, setPerformanceScore] = useState<string>("0");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const detailsQuery = useQuery<PlenumTechnician, unknown>({
    queryKey: ["plenum-technician", technicianId],
    enabled: mode === "edit" && Boolean(technicianId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) => getTechnician({ id: technicianId ?? "", signal }),
  });

  useEffect(() => {
    if (mode !== "edit") return;
    const t = detailsQuery.data;
    if (!t) return;
    const uid = t.user_id ?? "";
    setUser(uid ? { id: uid, label: uid } : null);
    setTechId(t.tech_id ?? "");
    setTechName(t.tech_name ?? "");
    setPrimarySkills(parseSkills(t.primary_skill));
    setSecondarySkills(parseSkills(t.secondary_skill));
    setLevel(t.level ?? "Tech");
    setShift(t.shift ?? "Day");
    setEmploymentType(t.employment_type ?? "Inhouse");
    setHourlyCostAed(String(t.hourly_cost_aed ?? ""));
    const bs = t.base_site_id ?? "";
    setBaseSiteId(bs);
    setLocation(bs ? { id: bs, label: bs } : null);
    setAvailabilityStatus(t.availability_status ?? "available");
    setPerformanceScore(String(t.performance_score ?? 0));
    setSubmitError(null);
    setFieldErrors({});
  }, [detailsQuery.data, mode]);

  useEffect(() => {
    if (!orgId) return;
    if (!user?.id || user.label !== user.id) return;
    const ac = new AbortController();
    getUser({ id: user.id, signal: ac.signal })
      .then((u) => {
        const name = u.full_name?.trim() ?? "";
        const email = u.email?.trim() ?? "";
        const label = name && email ? `${name} (${email})` : name || email || u.id;
        setUser({ id: u.id, label });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [orgId, user?.id, user?.label]);

  const saveMutation = useMutation<PlenumTechnician, unknown>({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      if (!orgId) errs.organization_id = "Organization is required.";

      const u = (user?.id ?? "").trim();
      if (!u) errs.user_id = "User ID is required.";
      else if (!isUuid(u)) errs.user_id = "Invalid UUID.";

      const tid = techId.trim();
      if (!tid) errs.tech_id = "Technician ID is required.";

      const tn = techName.trim();
      if (!tn) errs.tech_name = "Technician name is required.";

      const ps = primarySkills.map((x) => x.trim()).filter(Boolean);
      if (!ps.length) errs.primary_skill = "Primary skill is required.";

      const ss = secondarySkills.map((x) => x.trim()).filter(Boolean);

      const lvl = level.trim();
      if (!lvl) errs.level = "Level is required.";

      const sh = shift.trim();
      if (!sh) errs.shift = "Shift is required.";

      const bs = baseSiteId.trim();
      if (!bs) errs.base_site_id = "Base site is required.";

      const et = employmentType.trim();
      if (!et) errs.employment_type = "Employment type is required.";

      const hcNum = Number(hourlyCostAed);
      if (!Number.isFinite(hcNum)) errs.hourly_cost_aed = "Hourly cost must be a number.";
      else if (hcNum < 0) errs.hourly_cost_aed = "Hourly cost must be >= 0.";

      const a = availabilityStatus.trim();
      if (!a) errs.availability_status = "Availability status is required.";

      const scoreNum = Number(performanceScore);
      if (!Number.isFinite(scoreNum)) errs.performance_score = "Performance score must be a number.";
      else if (scoreNum < 0 || scoreNum > 100) errs.performance_score = "Performance score must be 0-100.";

      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        throw new Error("VALIDATION");
      }

      setFieldErrors({});
      if (mode === "create") {
        return createTechnician({
          organization_id: orgId,
          user_id: u,
          tech_id: tid,
          tech_name: tn,
          primary_skill: ps.join(", "),
          secondary_skill: ss.length ? ss.join(", ") : undefined,
          level: lvl,
          shift: sh,
          base_site_id: bs,
          employment_type: et,
          hourly_cost_aed: hcNum,
          base_location: location?.label ?? undefined,
          availability_status: a,
          performance_score: scoreNum,
        });
      }
      return updateTechnician({
        id: technicianId ?? "",
        body: {
          user_id: u,
          tech_id: tid,
          tech_name: tn,
          primary_skill: ps.join(", "),
          secondary_skill: ss.length ? ss.join(", ") : undefined,
          level: lvl,
          shift: sh,
          base_site_id: bs,
          employment_type: et,
          hourly_cost_aed: hcNum,
          base_location: location?.label ?? undefined,
          availability_status: a,
          performance_score: scoreNum,
        },
      });
    },
    onSuccess: async (t) => {
      toast({ title: mode === "create" ? "Technician created" : "Technician updated", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["plenum-technicians"] });
      await queryClient.invalidateQueries({ queryKey: ["plenum-technician", t.id] });
      if (mode === "create") router.push(APP_ROUTES.technicians);
      else router.push(`${APP_ROUTES.technicians}/${t.id}`);
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "VALIDATION") return;
      if (e instanceof ApiError && e.status === 401) {
        router.replace(APP_ROUTES.login);
        return;
      }
      if (e instanceof ApiError) {
        const fe = extractFieldErrorsFromPayload(e.payload);
        if (fe) {
          const msg = fe._;
          const { _, ...rest } = fe as Record<string, string>;
          if (Object.keys(rest).length) setFieldErrors(rest);
          if (msg) setSubmitError(msg);
          if (!msg && Object.keys(rest).length === 0) setSubmitError(e.message);
        } else {
          setSubmitError(getErrorMessage(e));
        }
        return;
      }
      setSubmitError(getErrorMessage(e));
    },
  });

  const pending = saveMutation.isPending;
  const disableSubmit = pending || !orgId || (mode === "edit" && !technicianId);

  const title = useMemo(() => (mode === "create" ? "Add Technician" : "Edit Technician"), [mode]);
  const subtitle = useMemo(() => {
    if (!orgId) return "Select organization from header";
    return orgName || orgId;
  }, [orgId, orgName]);

  if (mode === "edit" && detailsQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/50" />;
  }

  if (mode === "edit" && detailsQuery.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{getErrorMessage(detailsQuery.error)}</p>
        <Button variant="outline" type="button" onClick={() => detailsQuery.refetch()}>
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
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Technician ID</label>
              <Input value={techId} onChange={(e) => setTechId(e.target.value)} placeholder="T00001" />
              {fieldErrors.tech_id ? <p className="text-xs text-destructive">{fieldErrors.tech_id}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Technician Name</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setUserOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{user?.label ?? (techName || "Select user")}</span>
                </Button>
                <InfiniteSelect
                  open={userOpen}
                  onClose={() => setUserOpen(false)}
                  onSelect={(item) => {
                    setUser(item);
                    const name = userLabelToTechName(item.label);
                    setTechName(name || item.label);
                  }}
                  valueLabel={user?.label ?? techName}
                  placeholder="Search users..."
                  pageSize={10}
                  cacheKey={orgId ? `tech-users:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchUsersSelectPage({ organizationId: orgId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.tech_name ? <p className="text-xs text-destructive">{fieldErrors.tech_name}</p> : null}
              {fieldErrors.user_id ? <p className="text-xs text-destructive">{fieldErrors.user_id}</p> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Base Site</label>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => setLocationOpen((v) => !v)}
                  disabled={!orgId}
                >
                  <span className="truncate">{location?.label ?? "Select location"}</span>
                </Button>
                <InfiniteSelect
                  open={locationOpen}
                  onClose={() => setLocationOpen(false)}
                  onSelect={(item) => {
                    setLocation(item);
                    setBaseSiteId(item.id);
                  }}
                  valueLabel={location?.label ?? ""}
                  placeholder="Search locations..."
                  pageSize={10}
                  cacheKey={orgId ? `tech-locations:${orgId}` : undefined}
                  cacheTTL={90_000}
                  fullWidth
                  fetchPage={({ limit, offset, search, signal }) =>
                    fetchLocationsSelectPage({ organizationId: orgId, limit, offset, search, signal })
                  }
                />
              </div>
              {fieldErrors.base_site_id ? <p className="text-xs text-destructive">{fieldErrors.base_site_id}</p> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SkillChipsInput
              label="Primary Skill"
              placeholder="Type skill and press Enter…"
              values={primarySkills}
              onChange={setPrimarySkills}
              error={fieldErrors.primary_skill}
            />
            <SkillChipsInput
              label="Secondary Skill"
              optional
              placeholder="Type skill and press Enter…"
              values={secondarySkills}
              onChange={setSecondarySkills}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Level</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="pro">Pro</option>
                <option value="intermediate">Intermediate</option>
                <option value="beginner">Beginner</option>

              </select>
              {fieldErrors.level ? <p className="text-xs text-destructive">{fieldErrors.level}</p> : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Shift</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              >
                <option value="Day">Day</option>
                <option value="Swing">Swing</option>
              </select>
              {fieldErrors.shift ? <p className="text-xs text-destructive">{fieldErrors.shift}</p> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Employment Type</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
              >
                <option value="Inhouse">Inhouse</option>
                <option value="Outsourced">Outsourced</option>
              </select>
              {fieldErrors.employment_type ? (
                <p className="text-xs text-destructive">{fieldErrors.employment_type}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Hourly Cost (AED)</label>
              <Input
                type="number"
                inputMode="decimal"
                value={hourlyCostAed}
                min={0}
                onChange={(e) => setHourlyCostAed(e.target.value)}
                placeholder="48"
              />
              {fieldErrors.hourly_cost_aed ? (
                <p className="text-xs text-destructive">{fieldErrors.hourly_cost_aed}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Availability Status</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={availabilityStatus}
                onChange={(e) => setAvailabilityStatus(e.target.value)}
              >
                <option value="available">Available</option>
                <option value="busy">Busy</option>
                <option value="on_leave">On Leave</option>
              </select>
              {fieldErrors.availability_status ? (
                <p className="text-xs text-destructive">{fieldErrors.availability_status}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Performance Score (0-100)</label>
              <Input
                type="number"
                value={performanceScore}
                min={0}
                max={100}
                onChange={(e) => setPerformanceScore(e.target.value)}
              />
              {fieldErrors.performance_score ? (
                <p className="text-xs text-destructive">{fieldErrors.performance_score}</p>
              ) : null}
            </div>
          </div>

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          {fieldErrors.organization_id ? (
            <p className="text-sm text-destructive">{fieldErrors.organization_id}</p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="secondary" disabled={pending}>
              <Link href={APP_ROUTES.technicians}>Cancel</Link>
            </Button>
            <Button disabled={disableSubmit} type="submit">
              {pending ? "Saving..." : mode === "create" ? "Add Technician" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
