import { NextResponse } from "next/server";
import { rateLimit } from "@tokophi/lib/cache";

// client IP from common proxy headers (Cloudflare first, then standard forwards)
export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
}

// Per-IP fixed-window rate limit for public (no-auth) endpoints. Returns a 429 response if the
// caller is over the limit, else null. PROD: front this with Cloudflare Rate Limiting at the edge.
export function rateLimited(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
  cors: Record<string, string>,
): NextResponse | null {
  const r = rateLimit(`${bucket}:${clientIp(req)}`, limit, windowMs);
  if (r.ok) return null;
  return NextResponse.json(
    { ok: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." },
    { status: 429, headers: { ...cors, "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
  );
}
