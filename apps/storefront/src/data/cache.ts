// Tiny in-process TTL cache for the SSR storefront.
//
// Why not @tokophi/lib/cache? That module is Next-flavoured (`import "server-only"`), which the
// Astro/Vite SSR bundle can't resolve. Same get-or-compute contract, ~20 lines, zero deps.
//
// PROD SWAP: same interface, backed by Cloudflare Workers KV / Redis once the storefront runs
// behind more than one process (PROD_PLAN §3) — in-memory doesn't share across instances.

type Entry<T> = { value: T; expires: number };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

// Per-request DB reads are cached this long. Short by design: ADR 0009 promises a Store Builder
// save shows up on the next page load, so this is "smooth out bursts", not "cache the site".
// STOREFRONT_CACHE_TTL_MS=0 disables it entirely (handy in dev).
export function ttlMs(): number {
  const raw = process.env.STOREFRONT_CACHE_TTL_MS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 15_000;
}

/** get-or-compute. Concurrent callers for the same key share one in-flight promise (no stampede). */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const ttl = ttlMs();
  if (ttl > 0) {
    const hit = store.get(key) as Entry<T> | undefined;
    if (hit && Date.now() < hit.expires) return hit.value;
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
  }

  const p = (async () => {
    try {
      const value = await fn();
      if (ttl > 0) store.set(key, { value, expires: Date.now() + ttl });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  if (ttl > 0) inflight.set(key, p);
  return p;
}

/** Test/ops escape hatch — drop everything (e.g. after a seed reload). */
export function cacheClear(): void {
  store.clear();
}
