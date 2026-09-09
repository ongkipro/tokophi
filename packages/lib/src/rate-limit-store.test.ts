import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import type { RateLimitExec } from "./rate-limit-store";

// The SHARED rate-limit counter, against real Postgres (Task 6.3 / NF-6).
//
// WHY THIS FILE EXISTS. `rateLimit()` was an in-process `Map`, and both of its holes are invisible to
// `tsc`, to ESLint and to every existing suite: the count resets on every redeploy (several a day
// here, so an attacker's quota was refilled for them for free), and it does not span replicas. The
// only way to make a claim about either is to run two independent module instances against one
// database and count what gets served — which is exactly what a second replica, and a restarted
// container, are.
//
// Everything runs inside ONE transaction that is always rolled back, and the backend is INJECTED
// (`useRateLimitBackend`) rather than resolved from `@tokophi/db` — that injection is what keeps
// these writes off the shared dev database, whose truncation costs whoever else is mid-verification
// their afternoon.
//
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test \
//     npx vitest run packages/lib/src/rate-limit-store.test.ts

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
beforeAll(() => {
  if (URL_) sql = postgres(URL_, { max: 4, onnotice: () => {} });
});
afterAll(async () => {
  if (sql) await sql.end({ timeout: 5 });
});

// Run fn inside a transaction and ALWAYS roll back — `sql.begin` COMMITS when its callback resolves,
// which is the trap the first version of this file fell into (49 counter rows left behind in the
// throwaway database). Same idiom, same symbol, as `apps/admin/lib/ledger-credit.test.ts`.
const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (exec: RateLimitExec, tx: postgres.TransactionSql) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await fn((text, params) => tx.unsafe(text, params as never[]) as never, tx as postgres.TransactionSql);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

/** One "replica": a module graph of its own, so its `hits` Map is genuinely empty. */
async function replica(exec: RateLimitExec) {
  vi.resetModules();
  const store = await import("./rate-limit-store");
  const cache = await import("./cache");
  store.useRateLimitBackend(exec);
  return {
    /** Call the limiter and settle the write-behind, i.e. what happens between two real requests. */
    async hit(key: string, limit: number, windowMs: number) {
      const r = cache.rateLimit(key, limit, windowMs);
      await store.flushRateLimits();
      return r;
    },
    rateLimit: cache.rateLimit,
    flush: store.flushRateLimits,
    recordFailedLogin: cache.recordFailedLogin,
    clearFailedLogins: cache.clearFailedLogins,
    failedLoginLocked: cache.failedLoginLocked,
    backendDegraded: store.backendDegraded,
  };
}

d("the counter lives in Postgres, not in a process", () => {
  it("two independent instances share one quota — they do not each get their own", async () => {
    await inTxn(async (exec, tx) => {
      const key = `order:${crypto.randomUUID()}`;
      const A = await replica(exec);
      const B = await replica(exec);

      // Ten calls, strictly alternating, each one settled before the next — i.e. two replicas behind
      // a load balancer serving one client at human speed.
      const verdicts: boolean[] = [];
      for (let i = 0; i < 10; i++) verdicts.push((await (i % 2 ? B : A).hit(key, 3, 60_000)).ok);
      const allowed = verdicts.filter(Boolean).length;

      // The claim that matters: ONE quota, not one per replica. Two in-process Maps would have
      // served 3 each. The `+1` is the write-behind lag, stated in cache.ts: at decision time an
      // instance knows the shared count as of ITS last flush, so with R replicas alternating the
      // quota can be exceeded by R-1. Production runs one replica per surface, where that is 0.
      expect(allowed).toBe(4);
      expect(allowed).toBeLessThan(2 * 3);

      // …and the row proves where the count came from.
      const [row] = await tx`select "count" from "rate_limit_counters" where "key" = ${key}`;
      expect(Number(row.count)).toBe(10);
    });
  });

  it("a RESTART does not hand back a fresh quota — the classic redeploy hole", async () => {
    await inTxn(async (exec, tx) => {
      const key = `login:admin:${crypto.randomUUID()}`;
      const A = await replica(exec);

      for (let i = 0; i < 3; i++) expect((await A.hit(key, 3, 60_000)).ok).toBe(true);
      expect((await A.hit(key, 3, 60_000)).ok).toBe(false);

      // Deploy. New container, new process, empty Map, same database.
      const afterDeploy = await replica(exec);
      const first = await afterDeploy.hit(key, 3, 60_000);
      const second = await afterDeploy.hit(key, 3, 60_000);

      // ⚠️ The FIRST call is answered before the shared count is known — one request per key per
      // replica, documented in cache.ts. The old behaviour served a whole fresh 3 here, on every
      // deploy, several times a day.
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
    });
  });

  it("the window rolls: an expired row starts over instead of refusing forever", async () => {
    await inTxn(async (exec, tx) => {
      const key = `ongkir:${crypto.randomUUID()}`;
      const A = await replica(exec);

      for (let i = 0; i < 2; i++) expect((await A.hit(key, 2, 250)).ok).toBe(true);
      expect((await A.hit(key, 2, 250)).ok).toBe(false);
      const [before] = await tx`select "window_start", "count" from "rate_limit_counters" where "key" = ${key}`;

      await new Promise((r) => setTimeout(r, 300));

      expect((await A.hit(key, 2, 250)).ok).toBe(true);
      const [after] = await tx`select "window_start", "count" from "rate_limit_counters" where "key" = ${key}`;
      // The ROW rolled — the count restarted and the window moved. Postgres decided this, in the same
      // statement that incremented, not the caller.
      expect(Number(after.count)).toBe(1);
      expect(new Date(after.window_start).getTime()).toBeGreaterThan(new Date(before.window_start).getTime());
    });
  });

  it("the bump is ATOMIC — 20 concurrent hits are counted 20 times, never fewer", async () => {
    // A select-then-update would lose increments here. This is the same lost-update class that
    // `receivePurchaseOrder` and `markPayoutPaid` each shipped once.
    const client = postgres(URL_ as string, { max: 10, onnotice: () => {} });
    const key = `order:${crypto.randomUUID()}`;
    try {
      const { bumpShared, useRateLimitBackend } = await import("./rate-limit-store");
      useRateLimitBackend((text, params) => client.unsafe(text, params as never[]) as never);
      const now = Date.now();
      await Promise.all(Array.from({ length: 20 }, () => bumpShared(key, 60_000, now)));
      const [row] = await client`select "count" from "rate_limit_counters" where "key" = ${key}`;
      expect(Number(row.count)).toBe(20);
    } finally {
      await client`delete from "rate_limit_counters" where "key" = ${key}`;
      await client.end({ timeout: 5 });
    }
  });
});

// ── THE PER-ACCOUNT BRAKE, WHICH IS THE HALF AN EDGE RULE COULD NEVER DO ────────────────────────
// `rateLimit` counts a source address; a distributed grind brings its own addresses. The account
// lock is keyed on the EMAIL, which lives in the POST body of a server action — invisible to any
// Cloudflare rule. It was per-process too, so a redeploy let the streak start over.
d("the failed-login streak survives a restart", () => {
  it("a lock earned before a deploy is still a lock after it", async () => {
    await inTxn(async (exec, tx) => {
      const email = `grind-${crypto.randomUUID()}@example.com`;
      const A = await replica(exec);

      for (let i = 0; i < 25; i++) A.recordFailedLogin("seller", email);
      await A.flush();
      expect(A.failedLoginLocked("seller", email)).toBe(true);

      const afterDeploy = await replica(exec);
      expect(afterDeploy.failedLoginLocked("seller", email)).toBe(false); // empty Map, nothing known yet
      afterDeploy.recordFailedLogin("seller", email); // …one attempt is what fetches the shared count
      await afterDeploy.flush();
      expect(afterDeploy.failedLoginLocked("seller", email)).toBe(true);
    });
  });

  it("a SUCCESSFUL sign-in clears the shared row too, or the lock re-arms on the next typo", async () => {
    await inTxn(async (exec, tx) => {
      const email = `ok-${crypto.randomUUID()}@example.com`;
      const A = await replica(exec);

      for (let i = 0; i < 25; i++) A.recordFailedLogin("seller", email);
      await A.flush();
      A.clearFailedLogins("seller", email);
      await A.flush();

      const [row] = await tx`select "count" from "rate_limit_counters" where "key" = ${`loginfail:seller:${email}`}`;
      expect(row).toBeUndefined();

      // A brand-new process must not be able to re-derive the lock from a row nobody deleted.
      const next = await replica(exec);
      next.recordFailedLogin("seller", email);
      await next.flush();
      expect(next.failedLoginLocked("seller", email)).toBe(false);
    });
  });
});

// ── FAIL-OPEN vs FAIL-CLOSED, DRIVEN ────────────────────────────────────────────────────────────
describe("the default backend is unreachable from a test process", () => {
  it("resolves to nothing under VITEST — a suite must never write to the shared dev database", async () => {
    vi.resetModules();
    const store = await import("./rate-limit-store");
    const cache = await import("./cache");
    expect(process.env.VITEST).toBeTruthy();
    // No `useRateLimitBackend`: this is exactly what an unrelated suite calling `rateLimit` does.
    cache.rateLimit(`order:${crypto.randomUUID()}`, 5, 60_000);
    await store.flushRateLimits();
    expect(store.backendDegraded()).toBe(false); // nothing was attempted, so nothing failed
  });
});

d("what happens when the shared counter breaks", () => {
  const broken: RateLimitExec = () => Promise.reject(new Error("no database"));
  // The failure is deliberately LOUD on a server (`console.error` in `bumpShared`) — silenced here
  // only so a green run reads as green.
  beforeAll(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
  afterAll(() => void vi.restoreAllMocks());

  it("a backend that NEVER worked is not a degradation — it is a machine without a database", async () => {
    const A = await replica(broken);
    A.rateLimit("login:admin:1.2.3.4", 3, 60_000);
    await A.flush();
    expect(A.backendDegraded()).toBe(false);
    // …so the login door still opens, on the in-process limiter alone.
    expect(A.rateLimit("login:admin:1.2.3.4", 3, 60_000).ok).toBe(true);
  });

  it("LOSING a counter that was working closes the login door and leaves the order door open", async () => {
    await inTxn(async (exec) => {
      let live = true;
      const flaky: RateLimitExec = (text, params) => (live ? exec(text, params) : Promise.reject(new Error("no database")));
      const A = await replica(flaky);

      await A.hit(`order:${crypto.randomUUID()}`, 60, 60_000); // one success arms the strict answer
      live = false;
      await A.hit(`order:${crypto.randomUUID()}`, 60, 60_000); // …and one failure trips it
      expect(A.backendDegraded()).toBe(true);

      // Login: refused. It already needs the database on its next line (`findLogin` reads `users`),
      // so this adds no outage — it removes a silent downgrade back to per-replica counting.
      expect(A.rateLimit("login:admin:5.5.5.5", 15, 60_000).ok).toBe(false);
      expect(A.rateLimit("signup:admin:5.5.5.5", 5, 600_000).ok).toBe(false);

      // Order, quote, voucher, callback, chat: served. Refusing these costs a real shopper a real
      // sale for a fault that is ours.
      for (const k of ["order:5.5.5.5", "ongkir:5.5.5.5", "promo:5.5.5.5", "paycb:5.5.5.5", "chat:send:ip:5.5.5.5"]) {
        expect(A.rateLimit(k, 10, 60_000).ok, k).toBe(true);
      }
    });
  });
});
