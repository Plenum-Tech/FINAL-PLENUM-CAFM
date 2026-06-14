export const runtime = "nodejs";

function getTargetBaseUrl() {
  const base = (process.env.NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base.trim()) throw new Error("Missing NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL");
  return base;
}

async function proxy(request: Request, pathSuffix: string) {
  const base = getTargetBaseUrl();
  const url = `${base}${pathSuffix}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const res = await fetch(url, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  const outHeaders = new Headers(res.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");

  return new Response(res.body, {
    status: res.status,
    headers: outHeaders,
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const incoming = new URL(request.url);
  const suffix = `/${path.map(encodeURIComponent).join("/")}${incoming.search ? incoming.search : ""}`;
  return proxy(request, suffix);
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const suffix = `/${path.map(encodeURIComponent).join("/")}`;
  return proxy(request, suffix);
}

export async function PUT(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const suffix = `/${path.map(encodeURIComponent).join("/")}`;
  return proxy(request, suffix);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const suffix = `/${path.map(encodeURIComponent).join("/")}`;
  return proxy(request, suffix);
}
