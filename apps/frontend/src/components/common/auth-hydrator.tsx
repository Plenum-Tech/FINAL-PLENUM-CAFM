"use client";

import { useEffect } from "react";

import { useAuthStore, type User } from "@/store";

export function AuthHydrator({ user }: { user: User | null }) {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate(user);
  }, [hydrate, user]);

  return null;
}
