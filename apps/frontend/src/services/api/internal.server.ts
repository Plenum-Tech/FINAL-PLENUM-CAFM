import { cookies, headers } from "next/headers";

import { ApiError } from "./errors";

type ApiFetchOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: HeadersInit;
};

function isAbsoluteUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://");
}

async function getAppOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function apiFetchInternal<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const origin = await getAppOrigin();
  const url = isAbsoluteUrl(path) ? path : new URL(path, origin).toString();

  const h = await headers();
  const headersOut = new Headers(options.headers);

  if (!headersOut.has("cookie")) {
    const cookieHeaderFromRequest = h.get("cookie");
    if (cookieHeaderFromRequest) {
      headersOut.set("cookie", cookieHeaderFromRequest);
    } else {
      const store = await cookies();
      const all = store.getAll();
      if (all.length) {
        headersOut.set("cookie", all.map((c) => `${c.name}=${c.value}`).join("; "));
      }
    }
  }
  if (!headersOut.has("Accept")) headersOut.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (!headersOut.has("Content-Type")) headersOut.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    ...options,
    headers: headersOut,
    body,
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const message =
      (typeof payload === "object" &&
      payload &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : undefined) ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}
