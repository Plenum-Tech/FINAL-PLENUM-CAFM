"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Pencil, Phone, Trash2 } from "lucide-react";

import { Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from "@/components/ui";
import { APP_ROUTES } from "@/constants";
import { ConfirmDialog } from "@/components/common";
import { ApiError } from "@/services/api";
import { useOrganizationStore } from "@/store/organizationStore";
import {
  createVendorContact,
  createVendorContract,
  deleteVendor,
  deleteVendorContract,
  getVendor,
  listVendorContracts,
  listVendorContacts,
  updateVendorContact,
  updateVendorContract,
  type PlenumVendor,
  type PlenumVendorContact,
  type PlenumVendorContract,
} from "@/features/vendor/plenum-api";

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

function ContractModal({
  open,
  pending,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  initial?: PlenumVendorContract | null;
  onClose: () => void;
  onSubmit: (v: {
    contract_name: string;
    contract_start: string;
    contract_end: string;
    contract_value: number;
    sla_terms: string;
    contract_document: string;
    status: string;
  }) => void;
}) {
  const [contractName, setContractName] = useState("");
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [contractValue, setContractValue] = useState<string>("0");
  const [slaTerms, setSlaTerms] = useState("");
  const [contractDocument, setContractDocument] = useState("");
  const [status, setStatus] = useState("active");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setContractName(initial?.contract_name ?? "");
    setContractStart(initial?.contract_start ?? "");
    setContractEnd(initial?.contract_end ?? "");
    setContractValue(typeof initial?.contract_value === "number" ? String(initial.contract_value) : "0");
    setSlaTerms(initial?.sla_terms ?? "");
    setContractDocument(initial?.contract_document ?? "");
    setStatus(initial?.status ?? "active");
    setFieldErrors({});
  }, [
    initial?.contract_document,
    initial?.contract_end,
    initial?.contract_name,
    initial?.contract_start,
    initial?.contract_value,
    initial?.sla_terms,
    initial?.status,
    open,
  ]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div className="relative w-full max-w-lg rounded-xl border bg-card shadow-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 pt-5">
          <div className="text-base font-semibold">{initial ? "Edit Contract" : "Add Contract"}</div>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Contract Name</div>
              <Input value={contractName} onChange={(e) => setContractName(e.target.value)} autoFocus />
              {fieldErrors.contract_name ? (
                <div className="text-xs text-destructive">{fieldErrors.contract_name}</div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Start</div>
                <Input value={contractStart} onChange={(e) => setContractStart(e.target.value)} type="date" />
                {fieldErrors.contract_start ? (
                  <div className="text-xs text-destructive">{fieldErrors.contract_start}</div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">End</div>
                <Input value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} type="date" />
                {fieldErrors.contract_end ? <div className="text-xs text-destructive">{fieldErrors.contract_end}</div> : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Value</div>
                <Input value={contractValue} onChange={(e) => setContractValue(e.target.value)} inputMode="decimal" />
                {fieldErrors.contract_value ? (
                  <div className="text-xs text-destructive">{fieldErrors.contract_value}</div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Status</div>
                <Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="active" />
                {fieldErrors.status ? <div className="text-xs text-destructive">{fieldErrors.status}</div> : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">SLA Terms</div>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={slaTerms}
                onChange={(e) => setSlaTerms(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">Contract Document</div>
              <Input value={contractDocument} onChange={(e) => setContractDocument(e.target.value)} placeholder="URL or reference" />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  const errs: Record<string, string> = {};
                  if (!contractName.trim()) errs.contract_name = "Contract name is required.";
                  if (!contractStart.trim()) errs.contract_start = "Start date is required.";
                  if (!contractEnd.trim()) errs.contract_end = "End date is required.";
                  const v = Number(contractValue);
                  if (Number.isNaN(v)) errs.contract_value = "Value must be a number.";
                  if (!status.trim()) errs.status = "Status is required.";
                  if (Object.keys(errs).length) {
                    setFieldErrors(errs);
                    return;
                  }
                  setFieldErrors({});
                  onSubmit({
                    contract_name: contractName.trim(),
                    contract_start: contractStart.trim(),
                    contract_end: contractEnd.trim(),
                    contract_value: Number(contractValue),
                    sla_terms: slaTerms.trim(),
                    contract_document: contractDocument.trim(),
                    status: status.trim(),
                  });
                }}
              >
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
        <div className="h-5" />
      </div>
    </div>,
    document.body,
  );
}

function ContactModal({
  open,
  pending,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  initial?: PlenumVendorContact | null;
  onClose: () => void;
  onSubmit: (v: { name: string; email: string; phone: string; designation: string }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setEmail(initial?.email ?? "");
    setPhone(initial?.phone ?? "");
    setDesignation(initial?.designation ?? "");
    setFieldErrors({});
  }, [initial?.designation, initial?.email, initial?.name, initial?.phone, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div className="relative w-full max-w-lg rounded-xl border bg-card shadow-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 pt-5">
          <div className="text-base font-semibold">{initial ? "Edit Contact" : "Add Contact"}</div>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Name</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              {fieldErrors.name ? <div className="text-xs text-destructive">{fieldErrors.name}</div> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Email</div>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              </div>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Phone</div>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Designation</div>
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  const errs: Record<string, string> = {};
                  if (!name.trim()) errs.name = "Name is required.";
                  if (Object.keys(errs).length) {
                    setFieldErrors(errs);
                    return;
                  }
                  setFieldErrors({});
                  onSubmit({
                    name: name.trim(),
                    email: email.trim(),
                    phone: phone.trim(),
                    designation: designation.trim(),
                  });
                }}
              >
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
        <div className="h-5" />
      </div>
    </div>,
    document.body,
  );
}

export function VendorDetailsClient({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const orgSelected = useOrganizationStore((s) => s.selected);
  const organizationId = orgSelected?.id ?? "";

  useEffect(() => {
    setMounted(true);
  }, []);

  const vendorQuery = useQuery<PlenumVendor, unknown>({
    queryKey: ["plenum-vendor", vendorId],
    enabled: Boolean(vendorId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => getVendor({ id: vendorId, signal }),
  });

  const contactsQuery = useQuery<{ total: number; data: PlenumVendorContact[] }, unknown>({
    queryKey: ["plenum-vendor-contacts", vendorId],
    enabled: Boolean(vendorId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => listVendorContacts({ vendorId, limit: 100, offset: 0, signal }),
  });

  const contractsQuery = useQuery<{ total: number; data: PlenumVendorContract[] }, unknown>({
    queryKey: ["plenum-vendor-contracts", vendorId],
    enabled: Boolean(vendorId),
    retry: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => listVendorContracts({ vendorId, limit: 100, offset: 0, signal }),
  });

  useEffect(() => {
    const e = vendorQuery.error ?? contactsQuery.error ?? contractsQuery.error;
    const isErr = vendorQuery.isError || contactsQuery.isError || contractsQuery.isError;
    if (!isErr) return;
    if (e instanceof ApiError && e.status === 401) router.replace(APP_ROUTES.login);
  }, [
    contactsQuery.error,
    contactsQuery.isError,
    contractsQuery.error,
    contractsQuery.isError,
    router,
    vendorQuery.error,
    vendorQuery.isError,
  ]);

  const vendor = vendorQuery.data;
  const contacts = useMemo(() => contactsQuery.data?.data ?? [], [contactsQuery.data?.data]);
  const primary = contacts[0] ?? null;
  const contracts = useMemo(() => contractsQuery.data?.data ?? [], [contractsQuery.data?.data]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useMutation<void, unknown>({
    mutationFn: async () => {
      if (!vendorId) return;
      await deleteVendor({ id: vendorId });
    },
    onSuccess: async () => {
      toast({ title: "Vendor deleted", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["plenum-vendors"] });
      router.push(APP_ROUTES.vendors);
    },
    onError: (e) => {
      toast({ title: "Failed to delete vendor", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<PlenumVendorContract | null>(null);
  const [deleteContractId, setDeleteContractId] = useState<string | null>(null);
  const [deleteContractOpen, setDeleteContractOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<PlenumVendorContact | null>(null);

  const saveContractMutation = useMutation<
    void,
    unknown,
    {
      payload: {
        contract_name: string;
        contract_start: string;
        contract_end: string;
        contract_value: number;
        sla_terms: string;
        contract_document: string;
        status: string;
      };
    }
  >({
    mutationFn: async ({ payload }) => {
      if (editingContract) {
        await updateVendorContract({
          id: editingContract.id,
          body: {
            contract_name: payload.contract_name,
            contract_start: payload.contract_start,
            contract_end: payload.contract_end,
            contract_value: payload.contract_value,
            sla_terms: payload.sla_terms || undefined,
            contract_document: payload.contract_document || undefined,
            status: payload.status,
          },
        });
      } else {
        if (!organizationId) throw new Error("Organization is required.");
        await createVendorContract({
          organization_id: organizationId,
          vendor_id: vendorId,
          contract_name: payload.contract_name,
          contract_start: payload.contract_start,
          contract_end: payload.contract_end,
          contract_value: payload.contract_value,
          sla_terms: payload.sla_terms,
          contract_document: payload.contract_document,
          status: payload.status,
        });
      }
    },
    onSuccess: async () => {
      toast({ title: editingContract ? "Contract updated" : "Contract added", variant: "success" });
      setContractModalOpen(false);
      setEditingContract(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-vendor-contracts", vendorId] });
    },
    onError: (e) => {
      toast({ title: "Failed to save contract", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const saveContactMutation = useMutation<void, unknown, { payload: { name: string; email: string; phone: string; designation: string } }>({
    mutationFn: async ({ payload }) => {
      if (editingContact) {
        await updateVendorContact({
          id: editingContact.id,
          body: {
            name: payload.name,
            email: payload.email || undefined,
            phone: payload.phone || undefined,
            designation: payload.designation || undefined,
          },
        });
      } else {
        await createVendorContact({
          vendor_id: vendorId,
          name: payload.name,
          email: payload.email || "",
          phone: payload.phone || "",
          designation: payload.designation || "",
        });
      }
    },
    onSuccess: async () => {
      toast({ title: editingContact ? "Contact updated" : "Contact added", variant: "success" });
      setContactModalOpen(false);
      setEditingContact(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-vendor-contacts", vendorId] });
    },
    onError: (e) => {
      toast({ title: "Failed to save contact", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const deleteContractMutation = useMutation<void, unknown, { id: string }>({
    mutationFn: async ({ id }) => {
      await deleteVendorContract({ id });
    },
    onSuccess: async () => {
      toast({ title: "Contract deleted", variant: "success" });
      setDeleteContractOpen(false);
      setDeleteContractId(null);
      await queryClient.invalidateQueries({ queryKey: ["plenum-vendor-contracts", vendorId] });
    },
    onError: (e) => {
      toast({ title: "Failed to delete contract", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  function contractStatusVariant(s: string | null | undefined): "success" | "warning" | "destructive" | "secondary" {
    const v = (s ?? "").toLowerCase();
    if (v === "active") return "success";
    if (v === "expired") return "secondary";
    if (v === "terminated" || v === "cancelled" || v === "canceled") return "destructive";
    if (!v) return "secondary";
    return "warning";
  }

  if (vendorQuery.isFetching && !vendorQuery.data) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Loading vendor...
      </div>
    );
  }

  if (vendorQuery.isError) {
    return <div className="rounded-xl border bg-card p-4 text-sm text-destructive">{getErrorMessage(vendorQuery.error)}</div>;
  }

  if (!vendor) {
    return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Vendor not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/40 bg-gradient-to-b from-card/60 to-card/30 backdrop-blur-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <Button
              asChild
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-full border-border/60 bg-background/20 hover:bg-background/30"
            >
              <Link href={APP_ROUTES.vendors} aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>

            <div className="min-w-0">
              <div className="text-2xl font-semibold leading-tight truncate">{vendor.name}</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                  Active Vendor
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-full px-4 gap-2 border-border/60 bg-background/20 hover:bg-background/30"
              onClick={() => router.push(`${APP_ROUTES.vendors}/${vendorId}/edit`)}
            >
              <Pencil className="h-4 w-4" />
              Edit Vendor
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-9 rounded-full px-4 gap-2"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr] items-start">
        <Card className="bg-card/50 backdrop-blur-sm border-border/40 lg:row-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Contact Information</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-9 rounded-full px-4 border-border/60 bg-background/20 hover:bg-background/30"
              onClick={() => {
                setEditingContact(primary);
                setContactModalOpen(true);
              }}
            >
              {primary ? "Edit Contact" : "Add Contact"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-start gap-3 text-muted-foreground">
              <Mail className="mt-0.5 h-4 w-4 opacity-80" />
              <div className="min-w-0 truncate">{primary?.email?.trim() ? primary.email : "-"}</div>
            </div>
            <div className="flex items-start gap-3 text-muted-foreground">
              <Phone className="mt-0.5 h-4 w-4 opacity-80" />
              <div className="min-w-0 truncate">{primary?.phone?.trim() ? primary.phone : "-"}</div>
            </div>
            <div className="flex items-start gap-3 text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 opacity-80" />
              <div className="min-w-0">{vendor.address?.trim() ? vendor.address : "-"}</div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="bg-card/50 backdrop-blur-sm border-border/40">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Active Contracts</CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-full px-4 border-border/60 bg-background/20 hover:bg-background/30"
                onClick={() => {
                  setEditingContract(null);
                  setContractModalOpen(true);
                }}
                disabled={!organizationId}
              >
                Add Contract
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {contractsQuery.isError ? (
                <div className="text-sm text-destructive">{getErrorMessage(contractsQuery.error)}</div>
              ) : null}
              {contractsQuery.isFetching && !contractsQuery.data ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : null}

              <div className="space-y-3">
                {contracts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-background/20 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-semibold truncate">{c.contract_name}</div>
                        <span
                          className={
                            "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold capitalize " +
                            (contractStatusVariant(c.status) === "success"
                              ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                              : contractStatusVariant(c.status) === "secondary"
                                ? "border border-border/60 bg-muted/30 text-muted-foreground"
                                : contractStatusVariant(c.status) === "destructive"
                                  ? "border border-red-500/30 bg-red-500/15 text-red-300"
                                  : "border border-amber-500/30 bg-amber-500/15 text-amber-300")
                          }
                        >
                          {c.status ?? "—"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground truncate">
                        {(c.contract_start ?? "—") + " - " + (c.contract_end ?? "—")} •{" "}
                        {typeof c.contract_value === "number" ? c.contract_value.toLocaleString() : "—"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 rounded-full border border-border/50 bg-background/20 p-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full hover:bg-muted/40"
                          aria-label="Edit"
                          onClick={() => {
                            setEditingContract(c);
                            setContractModalOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10"
                          aria-label="Delete"
                          onClick={() => {
                            setDeleteContractId(c.id);
                            setDeleteContractOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                {contracts.length === 0 && !contractsQuery.isFetching ? (
                  <div className="rounded-xl border border-border/40 bg-background/20 p-6 text-sm text-muted-foreground">
                    No contracts yet.
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur-sm border-border/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Service History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border/40 bg-background/20 p-6 text-sm text-muted-foreground">
                No service history available.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {mounted ? (
        <ContactModal
          open={contactModalOpen}
          pending={saveContactMutation.isPending}
          initial={editingContact}
          onClose={() => {
            if (saveContactMutation.isPending) return;
            setContactModalOpen(false);
            setEditingContact(null);
          }}
          onSubmit={(payload) => saveContactMutation.mutate({ payload })}
        />
      ) : null}

      {mounted ? (
        <ContractModal
          open={contractModalOpen}
          pending={saveContractMutation.isPending}
          initial={editingContract}
          onClose={() => {
            if (saveContractMutation.isPending) return;
            setContractModalOpen(false);
            setEditingContract(null);
          }}
          onSubmit={(payload) => saveContractMutation.mutate({ payload })}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete vendor?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deleteMutation.isPending}
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />

      <ConfirmDialog
        open={deleteContractOpen}
        onOpenChange={setDeleteContractOpen}
        title="Delete contract?"
        description="This action cannot be undone."
        confirmText="Yes, delete"
        cancelText="No"
        pending={deleteContractMutation.isPending}
        onConfirm={async () => {
          if (!deleteContractId) return;
          await deleteContractMutation.mutateAsync({ id: deleteContractId });
        }}
      />
    </div>
  );
}
