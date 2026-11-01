import { PgPreparedQuery } from "drizzle-orm/pg-core";

/**
 * drizzle-orm >= 0.44 throws `DrizzleQueryError` whose MESSAGE is `Failed query: <sql>\nparams: <values>`
 * and which also carries `.params`. Before 0.44 the message was Postgres's own text. The values are
 * whatever the statement bound — password hashes, e-mail addresses, phone numbers, delivery
 * addresses — and the message is exactly what `console.error(e)`, Next's server-action error logger
 * and every `String(e)` in this repo print. Left alone, the upgrade turns each failed write into a
 * line of personal data in the container logs (UU PDP; reviewed 2026-11-02, specs/docs/tasks/
 * 2026-11-02-repo-review-recommendations.md).
 *
 * This keeps the SQL (the debugging value) and drops the values from EVERY place they hide:
 *   · `message` and `params` of the DrizzleQueryError;
 *   · `stack` — V8 bakes the message into it, so `console.error(e)` prints `params: …` from there;
 *   · `detail` of the Postgres error on the cause chain (`Key (email)=(ada@…) already exists.`).
 * `code`, `constraint_name`, `table_name` stay: they are what `@tokophi/lib/pg-errors` reads.
 *
 * It mutates in place and returns the same object, so `instanceof` and `.cause` keep working.
 * Duck-typed on purpose: no drizzle import for the scrub itself.
 */
export function scrubQueryError<E>(e: E): E {
  for (let cur: unknown = e, hops = 0; cur && typeof cur === "object" && hops < 5; cur = (cur as { cause?: unknown }).cause, hops++) {
    const c = cur as { query?: unknown; params?: unknown; message?: unknown; stack?: unknown; code?: unknown; detail?: unknown };
    try {
      if (typeof c.query === "string" && "params" in c) {
        const before = typeof c.message === "string" ? c.message : "";
        const after = `Failed query: ${c.query}`;
        c.message = after;
        c.params = [];
        if (before && typeof c.stack === "string") c.stack = c.stack.split(before).join(after);
      } else if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code) && typeof c.detail === "string") {
        c.detail = "";
      }
    } catch {
      // a frozen/odd error object: leave it, never throw from an error path
    }
  }
  return e;
}

const MARK = Symbol.for("tokophi.queryErrorScrub");

/**
 * Wrap the ONE place drizzle turns a driver error into a DrizzleQueryError
 * (`PgPreparedQuery.prototype.queryWithCache`, used by every pool and every transaction), so the
 * scrub also covers the owner connection — public order route, cron, storefront — not only
 * `withTenant`. `queryWithCache` is internal API: if a drizzle upgrade moves it we warn at startup
 * and `scrub-error.test.ts` goes red, instead of silently logging values again.
 */
export function installQueryErrorScrub(): boolean {
  const proto = PgPreparedQuery.prototype as unknown as Record<string | symbol, unknown>;
  const original = proto.queryWithCache;
  if (typeof original !== "function") {
    console.warn("[@tokophi/db] drizzle internals changed: PgPreparedQuery.queryWithCache is gone — query errors are NOT scrubbed.");
    return false;
  }
  if (proto[MARK]) return true;
  proto.queryWithCache = async function (this: unknown, ...args: unknown[]) {
    try {
      return await (original as (...a: unknown[]) => Promise<unknown>).apply(this, args);
    } catch (e) {
      throw scrubQueryError(e);
    }
  };
  proto[MARK] = true;
  return true;
}
