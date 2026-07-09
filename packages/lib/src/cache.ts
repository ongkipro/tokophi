import "server-only";

// Simple in-process TTL cache. Cuts repeated live calls (e.g. KiriminAja pricing) + latency.
// PROD SWAP: replace this module with Cloudflare Workers KV (edge) or Redis — same get/set/cached
// interface — since in-memory doesn't persist across serverless/edge invocations.
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
  // opportunistic cleanup so the Map doesn't grow unbounded in a long-lived process
  if (store.size > 5000) {
    const now = Date.now();
    for (const [k, v] of store) if (now > v.expires) store.delete(k);
  }
}

// get-or-compute: return the cached value, else run fn() and cache it.
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const val = await fn();
  cacheSet(key, val, ttlMs);
  return val;
}

// Fixed-window rate limit. Returns {ok:false} once `limit` hits are reached within `windowMs`.
// PROD SWAP: Cloudflare Rate Limiting (edge) / Workers KV / Upstash — same intent.
const hits = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    if (hits.size > 10000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  e.count++;
  if (e.count > limit) return { ok: false, remaining: 0, retryAfterMs: e.reset - now };
  return { ok: true, remaining: limit - e.count, retryAfterMs: 0 };
}
