// The SHARED half of the rate limiter: one row per key, in Postgres (Task 6.3 / NF-6).
//
// ── WHY POSTGRES AND NOT THE EDGE ────────────────────────────────────────────────────────────────
// The two candidates were Cloudflare Rate Limiting at the edge (PRD open question 3) and the database
// this product already runs on. Postgres wins here for three reasons that are facts about this repo,
// not preferences:
//
//   1. It is already the source of truth, already reachable from all four surfaces, and already the
//      thing every one of these gated paths queries on its next line. No new dependency, no new
//      credential, no new failure domain.
//   2. A Cloudflare rule is ZONE CONFIGURATION. Nothing in this repository can create it, so choosing
//      it would mean shipping a task whose enforcement lives in a dashboard nobody here can verify —
//      the shape of "a gate that does not run is not a gate" that AGENTS.md keeps re-learning.
//   3. THE EDGE CANNOT SEE AN ACCOUNT. The counter AGENTS.md records as missing is per-ACCOUNT login
//      failure, and the address lives inside the POST body of a Next server action. An edge rule can
//      only ever count source addresses — the very limitation this task exists to fix. Cloudflare
//      remains the right OUTER wall (it absorbs volume before it costs us a round-trip) and is a
//      recommendation, not a replacement.
//
// ── THE STATEMENT IS THE WHOLE DESIGN ────────────────────────────────────────────────────────────
// One `insert ... on conflict do update ... returning`, so the read, the window roll and the
// increment are a single atomic step under the row lock. Two replicas bumping the same key cannot
// both observe the same count. Splitting it into a select then an update restores exactly the race
// `receivePurchaseOrder` and `markPayoutPaid` have each already paid for.

/**
 * How the statement is run. A plain function rather than a client object on purpose: `@tokophi/lib`
 * must not grow a database dependency it can only satisfy by importing `@tokophi/db`, which depends
 * on THIS package. The default backend below resolves that with a lazy import; a test supplies its
 * own throwaway database instead, which is what keeps these suites off the shared dev DB.
 */
export type RateLimitExec = (text: string, params: unknown[]) => Promise<ReadonlyArray<BumpRow>>;
type BumpRow = { count: number; window_start: Date };

/**
 * `$1` key · `$2` now, epoch milliseconds · `$3` window length, milliseconds.
 *
 * Epoch millis rather than a timestamp literal so no timezone parsing sits between the caller's clock
 * and the row (`day-bucket.ts` is this repo's standing lesson about a query that silently buckets in
 * a different zone). Parameterised — `unsafe` in postgres.js means "the TEXT is not built by the tag",
 * not "the values are interpolated".
 */
export const BUMP_SQL = `
insert into "rate_limit_counters" ("key", "window_start", "count", "expires_at")
values ($1, to_timestamp($2::bigint / 1000.0), 1, to_timestamp($2::bigint / 1000.0) + ($3::bigint * interval '1 millisecond'))
on conflict ("key") do update set
  "count" = case
    when "rate_limit_counters"."window_start" + ($3::bigint * interval '1 millisecond') <= to_timestamp($2::bigint / 1000.0)
    then 1 else "rate_limit_counters"."count" + 1 end,
  "window_start" = case
    when "rate_limit_counters"."window_start" + ($3::bigint * interval '1 millisecond') <= to_timestamp($2::bigint / 1000.0)
    then to_timestamp($2::bigint / 1000.0) else "rate_limit_counters"."window_start" end,
  "expires_at" = to_timestamp($2::bigint / 1000.0) + ($3::bigint * interval '1 millisecond')
returning "count", "window_start"`;

/** Rows nothing will ever read again. Opportunistic — there is no cron for this and it needs none. */
export const SWEEP_SQL = `delete from "rate_limit_counters" where "expires_at" < now()`;

/** `$1` key. Used when a streak ENDS — a successful sign-in, in `clearFailedLogins`. */
export const CLEAR_SQL = `delete from "rate_limit_counters" where "key" = $1`;

// ── BACKEND WIRING ───────────────────────────────────────────────────────────────────────────────
// The default is a LAZY import of `@tokophi/db`, never a static one. Static would drag the owner
// connection pool into every consumer's module graph — including the Astro SSR bundle, where
// `apps/storefront/src/lib/chat.ts` reaches this file — and would put `@tokophi/db` in this package's
// dependency list while `@tokophi/db` already depends on `@tokophi/lib`. Lazy costs one resolved
// promise per process and keeps the edge one-directional.

let backend: RateLimitExec | null = null;
let backendResolved = false;

/** Point the shared counter at a specific database. `null` restores the lazy default. */
export function useRateLimitBackend(fn: RateLimitExec | null): void {
  backend = fn;
  backendResolved = fn !== null;
  everSucceeded = false;
  lastFailureAt = 0;
}

async function resolveBackend(): Promise<RateLimitExec | null> {
  if (backendResolved) return backend;
  backendResolved = true;
  // 🔴 A TEST PROCESS NEVER REACHES THE DEFAULT BACKEND. `DATABASE_URL` points at the SHARED DEV
  // DATABASE, and this limiter is called from suites that are about something else entirely
  // (`signup-metered.test.ts` hammers `rateLimit` 6 times to prove the sign-up gate meters) — so an
  // auto-resolved backend would have every one of them writing rows into the database other agents
  // are mid-verification against, and opening a connection pool vitest then has to wait on. A suite
  // that MEANS to exercise the shared counter injects its own `_test` database with
  // `useRateLimitBackend`, which is checked above and therefore unaffected by this.
  if (process.env.VITEST) {
    backend = null;
    return null;
  }
  try {
    const { client } = await import("@tokophi/db");
    backend = (text, params) => client.unsafe(text, params as never[]) as unknown as Promise<BumpRow[]>;
  } catch {
    backend = null;
  }
  return backend;
}

// ── HEALTH, AND WHY "NEVER WORKED" IS NOT "BROKEN" ───────────────────────────────────────────────
// `onBackendFailure` (rate-limit.ts) refuses a login when the shared counter is broken. That must not
// fire on a machine where the shared counter was never there to begin with: a fresh checkout with no
// database, a deploy whose migration has not landed yet, a unit suite. So the strict answer is armed
// only AFTER at least one successful bump in this process — from then on, losing the counter is a
// real degradation and is treated as one. Before that, we are simply the old in-process limiter.
let everSucceeded = false;
let lastFailureAt = 0;
const DEGRADED_FOR_MS = 30_000;

export function backendDegraded(now = Date.now()): boolean {
  return everSucceeded && lastFailureAt > 0 && now - lastFailureAt < DEGRADED_FOR_MS;
}

// Write-behind: the caller does not wait, so nothing here may be unbounded. 2000 outstanding bumps is
// far past any healthy state (each is a single indexed upsert); beyond it we stop scheduling rather
// than let a stalled database turn into heap pressure. An overflow is NOT counted as a health
// failure — it is our own back-pressure, and closing every login door because we are busy would be a
// self-inflicted outage.
const MAX_IN_FLIGHT = 2000;
const inFlight = new Set<Promise<unknown>>();
let sinceSweep = 0;

/** Await every scheduled bump. Tests use it to make the write-behind deterministic. */
export async function flushRateLimits(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

/**
 * Count one hit against the shared row and hand the authoritative window back.
 *
 * Returns `null` when there is no usable backend — the caller then keeps whatever its local map said.
 */
export async function bumpShared(
  key: string,
  windowMs: number,
  now: number,
): Promise<{ count: number; windowStart: number } | null> {
  const exec = await resolveBackend();
  if (!exec) return null;
  try {
    const rows = await exec(BUMP_SQL, [key, now, windowMs]);
    const row = rows[0];
    if (!row) return null;
    everSucceeded = true;
    lastFailureAt = 0;
    if (++sinceSweep >= 256) {
      sinceSweep = 0;
      void exec(SWEEP_SQL, []).catch(() => {});
    }
    return { count: Number(row.count), windowStart: new Date(row.window_start).getTime() };
  } catch (err) {
    lastFailureAt = now;
    // Loud on the server, silent to the caller: a limiter that throws into a checkout would be a
    // worse bug than the one it guards.
    console.error("[rate-limit] shared counter unavailable:", err);
    return null;
  }
}

/** Schedule a bump without waiting for it, handing the shared answer to `merge` when it lands. */
export function scheduleBump(
  key: string,
  windowMs: number,
  now: number,
  merge: (shared: { count: number; windowStart: number }) => void,
): void {
  if (inFlight.size >= MAX_IN_FLIGHT) return;
  const p = bumpShared(key, windowMs, now)
    .then((shared) => {
      if (shared) merge(shared);
    })
    .catch(() => {})
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/**
 * Forget a key entirely, without waiting. Only the failed-login streak uses this: a sign-in that
 * SUCCEEDED has to end the streak everywhere, or the next failure merges the stale shared count back
 * in and "berturut-turut" stops meaning what it says — worse, the per-account lock would re-arm on a
 * user who has just proved they own the account.
 */
export function scheduleClear(key: string): void {
  if (inFlight.size >= MAX_IN_FLIGHT) return;
  const p = resolveBackend()
    .then((exec) => (exec ? exec(CLEAR_SQL, [key]) : null))
    .catch((err) => {
      lastFailureAt = Date.now();
      console.error("[rate-limit] shared counter unavailable:", err);
    })
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}
