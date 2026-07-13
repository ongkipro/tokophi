// First-party analytics ingest — the ONLY writer of `analytics_events` besides the seed.
//
// Why it lives in the STOREFRONT (and not in the admin's /api/public/*): the request must be
// same-origin with the page that fires it. Merchants get their own subdomain today and custom
// domains later, so a cross-origin call would need CORS + would be eaten by tracking blockers and
// third-party-cookie/`keepalive` restrictions. Same reasoning as the planned chat API
// (specs/docs/CHAT_SPEC.md).
//
// The store is resolved from the `Host` header by src/middleware.ts (Astro.locals.store) — a
// store_id sent by the client is NEVER trusted, so one merchant's page cannot write events into
// another merchant's funnel.
//
// Reads land in apps/admin/lib/data/funnel.ts (getFunnelDaily / getDeviceDaily → /analitik).
import type { APIRoute } from "astro";
import { db, schema } from "@tokophi/db";

// The exact contract — anything else is rejected (funnel.ts FUNNEL_STEPS depends on these strings).
const TYPES = new Set(["visit", "product_view", "add_to_cart", "checkout_start", "purchase"]);
const DEVICES = new Set(["ponsel", "desktop", "tablet"]);

const noContent = () => new Response(null, { status: 204 });
const bad = (error: string) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const store = locals.store;
  if (!store) return bad("unknown store");

  // sendBeacon posts a Blob — parse the body by hand rather than trusting the content-type.
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return bad("invalid json");
  }
  if (!body || typeof body !== "object") return bad("invalid body");

  const { type, sessionId, device } = body as Record<string, unknown>;
  if (typeof type !== "string" || !TYPES.has(type)) return bad("unknown event type");

  const session = typeof sessionId === "string" ? sessionId.slice(0, 64) : null;
  const dev = typeof device === "string" && DEVICES.has(device) ? device : null;

  // Fire-and-forget from the client's point of view: a DB hiccup must never surface in the shop
  // (checkout in particular), so failures are swallowed into a 204.
  try {
    await db.insert(schema.analyticsEvents).values({
      storeId: store.id,
      type,
      sessionId: session,
      device: dev,
    });
  } catch (err) {
    console.error("[track] insert failed", err);
  }
  return noContent();
};

// A GET here is always a mistake (or a crawler) — never log an event for it.
export const GET: APIRoute = () => new Response("Method Not Allowed", { status: 405 });
