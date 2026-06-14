"use server";

import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/constants";
import { setSessionToken } from "@/services/auth";
import { createDemoToken } from "@/services/auth/demo";

export type LoginState = { error?: string };

export async function loginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();

  if (!email || !password) return { error: "Email and password required." };

  await setSessionToken(createDemoToken(email));

  redirect(redirectTo || APP_ROUTES.ai);
}
