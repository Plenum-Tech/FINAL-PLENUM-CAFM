import { NextResponse } from "next/server";

import { APP_ROUTES } from "@/constants";
import { SESSION_COOKIE_NAME } from "@/services/auth";

export function GET(req: Request) {
  const res = NextResponse.redirect(new URL(APP_ROUTES.login, req.url));
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
