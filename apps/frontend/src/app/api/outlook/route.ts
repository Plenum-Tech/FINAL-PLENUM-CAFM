export const runtime = "nodejs";

import { woServerUrl } from "@/lib/wo-server-base-url";

type InboxEmail = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: string;
  read: boolean;
  priority: "high" | "medium" | "low";
};

function parseErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.error === "string") return p.error;
    const detail = p.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const d = detail as Record<string, unknown>;
      if (typeof d.message === "string") return d.message;
    }
  }
  return `Outlook inbox request failed (${status})`;
}

/**
 * Load inbox via work-order service (Azure Graph credentials live on backend-app).
 * Avoids duplicating AZURE_* env vars on the Next.js container.
 */
export async function GET() {
  const url = woServerUrl("/api/email/inbox?max_count=30");

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const payload = (await res.json().catch(() => null)) as InboxEmail[] | Record<string, unknown>;

    if (!res.ok) {
      return Response.json(
        { error: parseErrorMessage(payload, res.status) },
        { status: res.status >= 500 ? 500 : res.status },
      );
    }

    if (!Array.isArray(payload)) {
      return Response.json(
        { error: "Unexpected inbox response from work-order service" },
        { status: 502 },
      );
    }

    return Response.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 500 });
  }
}
