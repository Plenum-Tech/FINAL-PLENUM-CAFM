import { env } from "@/config";

import { ApiError } from "./errors";

type ApiFetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof FormData ||
    value instanceof URLSearchParams
  );
}

function buildUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const rawBase = env.apiBaseUrl.trim();
  if (!rawBase) {
    throw new Error("Missing NEXT_PUBLIC_API_BASE_URL. Set it in .env.local and restart the dev server.");
  }
  const base = rawBase.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers(options.headers);

  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (isBodyInit(options.body)) {
      body = options.body;
      if (typeof options.body === "string") {
        const trimmed = options.body.trim();
        if (!headers.has("Content-Type") && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
          headers.set("Content-Type", "application/json");
        }
      }
    } else {
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url, {
    ...options,
    body,
    credentials: options.credentials ?? "include",
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const message = (() => {
      if (typeof payload === "object" && payload) {
        if ("message" in payload && typeof payload.message === "string") return payload.message;
        if (
          "detail" in payload &&
          Array.isArray(payload.detail) &&
          payload.detail.length > 0 &&
          typeof payload.detail[0] === "object" &&
          payload.detail[0] &&
          "msg" in payload.detail[0] &&
          typeof payload.detail[0].msg === "string"
        ) {
          return payload.detail[0].msg;
        }
        if ("detail" in payload && typeof payload.detail === "string") return payload.detail;
      }
      return `Request failed (${res.status})`;
    })();
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}
