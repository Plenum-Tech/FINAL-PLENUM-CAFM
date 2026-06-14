/**
 * Absolute base URL for work-order API calls from Next.js route handlers (Node fetch).
 *
 * `NEXT_PUBLIC_WO_BASE_URL=/backend/work-order` works in the browser (same origin).
 * Server-side fetch requires a full URL — set `WO_API_SERVER_URL` in Docker/local env.
 */
export function getWoServerBaseUrl(): string {
  const explicit = (
    process.env.WO_API_SERVER_URL ??
    process.env.WORK_ORDER_SERVICE_URL ??
    ""
  ).trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const publicBase = (process.env.NEXT_PUBLIC_WO_BASE_URL ?? "http://localhost:8007")
    .trim()
    .replace(/\/+$/, "");

  if (/^https?:\/\//i.test(publicBase)) {
    return publicBase;
  }

  // Relative public path (/backend/work-order) — hit uvicorn directly (not through nginx prefix).
  return "http://127.0.0.1:8007";
}

export function woServerUrl(path: string): string {
  const base = getWoServerBaseUrl();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}
