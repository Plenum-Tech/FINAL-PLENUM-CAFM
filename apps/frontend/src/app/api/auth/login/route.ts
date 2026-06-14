import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, createDemoToken, decodeDemoToken } from "@/services/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as null | {
    email?: unknown;
    password?: unknown;
  };

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password.trim() : "";

  if (!email || !password) {
    return NextResponse.json({ message: "Email and password required." }, { status: 400 });
  }

  const token = createDemoToken(email);
  const user = decodeDemoToken(token);

  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
