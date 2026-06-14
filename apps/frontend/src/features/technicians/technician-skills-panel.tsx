"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { ApiError, apiFetch } from "@/services/api";
import { APP_ROUTES } from "@/constants";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";

type TechnicianSkill = {
  id: string;
  technician_id: string;
  name: string;
  description?: string | null;
  created_at?: string | null;
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

type FastApiValidationIssue = {
  loc: Array<string | number>;
  msg: string;
};

function extractFieldErrorsFromPayload(payload: unknown): Record<string, string> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  const out: Record<string, string> = {};
  const detail = (rec as { detail?: unknown }).detail;
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
  return Object.keys(out).length ? out : null;
}

function parseSkill(x: unknown): TechnicianSkill | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id =
    typeof r.id === "string"
      ? r.id
      : typeof r.skill_id === "string"
        ? r.skill_id
        : "";
  const technician_id =
    typeof r.technician_id === "string"
      ? r.technician_id
      : typeof r.tech_id === "string"
        ? r.tech_id
        : "";
  const name =
    typeof r.name === "string"
      ? r.name
      : typeof r.skill_name === "string"
        ? r.skill_name
        : typeof r.title === "string"
          ? r.title
          : "";
  if (!id.trim() || !technician_id.trim() || !name.trim()) return null;

  return {
    id,
    technician_id,
    name,
    description: typeof r.description === "string" ? r.description : null,
    created_at: typeof r.created_at === "string" ? r.created_at : null,
  };
}

async function listTechnicianSkills(input: {
  technicianId: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<{ total: number; data: TechnicianSkill[] }> {
  const params = new URLSearchParams();
  params.set("technician_id", input.technicianId);
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  const payload = await apiFetch<unknown>(`/api/v1/plenum/technician-skills?${params.toString()}`, {
    signal: input.signal,
  });
  if (typeof payload !== "object" || payload === null) return { total: 0, data: [] };
  const obj = payload as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : 0;
  const raw = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.skills)
      ? obj.skills
      : Array.isArray(obj.technician_skills)
        ? obj.technician_skills
        : [];
  const data = raw.map(parseSkill).filter((v): v is TechnicianSkill => Boolean(v));
  return { total, data };
}

export function TechnicianSkillsPanel({ technicianId }: { technicianId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const query = useQuery<{ total: number; data: TechnicianSkill[] }, unknown>({
    queryKey: ["plenum-technician-skills", technicianId],
    enabled: Boolean(technicianId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => listTechnicianSkills({ technicianId, limit: 20, offset: 0, signal }),
  });

  useEffect(() => {
    if (!query.isError) return;
    const e = query.error;
    if (e instanceof ApiError && e.status === 401) router.replace(APP_ROUTES.login);
  }, [query.error, query.isError, router]);

  const skills = useMemo(() => query.data?.data ?? [], [query.data?.data]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TechnicianSkill | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      setName(editing.name ?? "");
      setDescription(editing.description ?? "");
    } else {
      setName("");
      setDescription("");
    }
    setFieldErrors({});
    setSubmitError(null);
  }, [editing, modalOpen]);

  const saveMutation = useMutation<void, unknown>({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      const n = name.trim();
      if (!n) errs.name = "Skill name is required.";
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        throw new Error("VALIDATION");
      }
      setFieldErrors({});
      setSubmitError(null);

      if (editing) {
        await apiFetch(`/api/v1/plenum/technician-skills/${encodeURIComponent(editing.id)}`, {
          method: "PUT",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            skill_name: n,
            description: description.trim() || undefined,
          },
        });
      } else {
        await apiFetch("/api/v1/plenum/technician-skills", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: {
            technician_id: technicianId,
            skill_name: n,
            description: description.trim() || undefined,
          },
        });
      }
    },
    onSuccess: async () => {
      toast({ title: editing ? "Skill updated" : "Skill added", variant: "success" });
      setModalOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-technician-skills", technicianId] });
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
          return;
        }
      }
      setSubmitError(getErrorMessage(e));
    },
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteMutation = useMutation<void, unknown, { id: string }>({
    mutationFn: async ({ id }) => {
      await apiFetch(`/api/v1/plenum/technician-skills/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
    },
    onSuccess: async () => {
      toast({ title: "Skill deleted", variant: "success" });
      setDeleteOpen(false);
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-technician-skills", technicianId] });
    },
    onError: (e) => {
      toast({ title: "Failed to delete skill", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  return (
    <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Skills & Certifications</CardTitle>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isError ? <div className="text-sm text-destructive">{getErrorMessage(query.error)}</div> : null}
        {query.isFetching && !query.data ? <div className="text-sm text-muted-foreground">Loading...</div> : null}

        <div className="flex flex-wrap gap-2">
          {skills.map((s) => (
            <div
              key={s.id}
              className="group inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/30 px-2 py-1"
            >
              <Badge variant="secondary" className="rounded-full">
                {s.name}
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Edit skill"
                onClick={() => {
                  setEditing(s);
                  setModalOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete skill"
                onClick={() => {
                  setDeleteId(s.id);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {skills.length === 0 && !query.isFetching ? (
            <div className="text-sm text-muted-foreground">No skills added yet.</div>
          ) : null}
        </div>

        {modalOpen && mounted
          ? createPortal(
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <button
                  type="button"
                  aria-label="Close"
                  className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  onClick={() => {
                    if (!saveMutation.isPending) setModalOpen(false);
                  }}
                />
                <div className="relative w-full max-w-lg rounded-xl border bg-card shadow-xl animate-in fade-in zoom-in-95 duration-200">
                  <div className="px-5 pt-5">
                    <div className="text-base font-semibold">{editing ? "Edit Skill" : "Add Skill"}</div>
                    <div className="mt-4 space-y-3">
                      <div className="space-y-1.5">
                        <div className="text-sm font-medium">Skill Name</div>
                        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                        {fieldErrors.name ? <div className="text-xs text-destructive">{fieldErrors.name}</div> : null}
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-sm font-medium">Description (Optional)</div>
                        <textarea
                          className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Optional details"
                        />
                        {fieldErrors.description ? (
                          <div className="text-xs text-destructive">{fieldErrors.description}</div>
                        ) : null}
                      </div>
                      {submitError ? <div className="text-sm text-destructive">{submitError}</div> : null}
                      <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={saveMutation.isPending}
                          onClick={() => setModalOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                          {saveMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="h-5" />
                </div>
              </div>,
              document.body,
            )
          : null}

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete skill?"
          description="This action cannot be undone."
          confirmText="Yes, delete"
          cancelText="No"
          pending={deleteMutation.isPending}
          onConfirm={async () => {
            if (!deleteId) return;
            await deleteMutation.mutateAsync({ id: deleteId });
          }}
        />
      </CardContent>
    </Card>
  );
}
