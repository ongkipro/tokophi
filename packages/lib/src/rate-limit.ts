// The rate limiter's DECISION, separated from where the count is kept (Task 6.3 / NF-6).
//
// Nothing in this file does I/O, imports `server-only`, or touches the database. That is what makes
// it importable from the Astro SSR bundle as well as from both Next apps — the exact wall that made
// `apps/storefront/src/lib/chat.ts` hand-roll a second copy of the limiter in the first place
// (`@tokophi/lib/cache` starts with `import "server-only"`, which Rollup cannot resolve there). A
// second copy is how the weaker half of a pair survives a fix; this repo has already paid for that
// with the 24-bit password mint. One decision, one file, two callers.
//
// It is also what makes the rule testable as a table. `rateLimit()` used to be a Map plus an `if`,
// and the `if` had no test of its own: every claim about it had to be made by hammering the Map.

/** What one key looks like right now, wherever the count is actually stored. */
export type Window = { count: number; windowStart: number };

export type RateVerdict = { ok: boolean; remaining: number; retryAfterMs: number };

/**
 * Fixed window. `count` INCLUDES the call being judged, so the first hit of a window arrives here as
 * 1 and a limit of 15 is reached — not exceeded — on the 15th.
 */
export function decide(w: Window, limit: number, windowMs: number, now: number): RateVerdict {
  const reset = w.windowStart + windowMs;
  if (now >= reset) return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  if (w.count > limit) return { ok: false, remaining: 0, retryAfterMs: Math.max(0, reset - now) };
  return { ok: true, remaining: Math.max(0, limit - w.count), retryAfterMs: 0 };
}

/** Roll `w` forward by one hit, starting a new window if the old one has expired. */
export function bump(w: Window | undefined, windowMs: number, now: number): Window {
  if (!w || now >= w.windowStart + windowMs) return { count: 1, windowStart: now };
  return { count: w.count + 1, windowStart: w.windowStart };
}

/**
 * Fold the authoritative shared window back into a local one.
 *
 * The ROW is the truth for both fields, and the second one is where this went wrong first: a
 * freshly restarted process opens its local window at `now`, which is LATER than the shared window
 * the row has been counting in since before the deploy. A merge that only accepted a shared window
 * newer than the local one therefore threw away every answer on exactly the path this task exists
 * for, and the restarted replica served a whole fresh quota — silently, with the shared row sitting
 * right there holding the real count.
 *
 * A shared window already expired at `now` is dropped instead: it is a reply that lost a race with
 * the roll, and adopting it would refuse a caller inside a window that no longer exists.
 */
export function mergeShared(cur: Window, shared: Window, windowMs: number, now: number): Window {
  if (now >= shared.windowStart + windowMs) return cur;
  return { count: Math.max(cur.count, shared.count), windowStart: shared.windowStart };
}

// ── WHAT HAPPENS WHEN THE SHARED COUNTER IS BROKEN ────────────────────────────────────────────────
//
// Every key is `"<bucket>:<subject>"`, and the bucket is what decides. Two answers are possible and
// both are wrong somewhere, so the choice is made per bucket and written down:
//
//   · "open"   — the shared counter is skipped and the process-local one still applies. The quota
//                degrades to per-replica, which is exactly what production had before this task.
//   · "closed" — the request is refused.
//
// The order endpoint fails OPEN because refusing it costs a real sale to a real shopper for a fault
// that is ours; the same goes for the shipping quote, the voucher check, the payment callback (a
// refused callback leaves a paid order stuck at `menunggu` — that outage has happened here once) and
// the shopper-facing chat.
//
// LOGIN AND SIGN-UP FAIL CLOSED, and the reason it costs nothing is worth stating: both already
// require the database on the very next line (`findLogin` / `findAdmin` read `users`), so a database
// that cannot serve this counter cannot serve the sign-in either. Fail-closed does not add an outage
// mode here; it removes a silent downgrade — otherwise the one gate whose whole purpose is to stop a
// credential grind would quietly go back to per-replica counting at precisely the moment nobody is
// watching. A login limiter that fails open is not a limiter.
//
// ⚠️ Unknown buckets are OPEN. A gate added later without an entry here must not be able to invent
// an outage; `rate-limit.test.ts` pins the strict list so widening it is a deliberate edit.
export type BackendFailureMode = "open" | "closed";

const STRICT_BUCKETS = new Set(["login", "signup"]);

export function bucketOf(key: string): string {
  const i = key.indexOf(":");
  return i === -1 ? key : key.slice(0, i);
}

export function onBackendFailure(key: string): BackendFailureMode {
  return STRICT_BUCKETS.has(bucketOf(key)) ? "closed" : "open";
}
