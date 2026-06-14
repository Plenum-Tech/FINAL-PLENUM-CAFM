"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { APP_ROUTES } from "@/constants";
import { useAuthStore } from "@/store";
import { cn } from "@/utils";
import { useOrganizationStore } from "@/store/organizationStore";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const clearUser = useAuthStore((s) => s.clearUser);
  const clearOrg = useOrganizationStore((s) => s.clear);
  const [pending, setPending] = useState(false);

  async function onLogout() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      clearUser();
      clearOrg();
      router.replace(APP_ROUTES.login);
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={pending}
      className={cn(
        "rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {pending ? "Logging out..." : "Logout"}
    </button>
  );
}
