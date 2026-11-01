/**
 * drizzle-orm >= 0.44 throws `DrizzleQueryError` whose MESSAGE is `Failed query: <sql>\nparams: <values>`
 * and which also carries `.params`. Before 0.44 the message was Postgres's own text. The values are
 * whatever the statement bound — password hashes, e-mail addresses, phone numbers, delivery
 * addresses — and the message is exactly what `console.error(e)`, Next's server-action error logger
 * and every `String(e)` in this repo print. Left alone, the upgrade turns each failed write into a
 * line of personal data in the container logs (UU PDP; reviewed 2026-11-02, specs/docs/tasks/
 * 2026-11-02-repo-review-recommendations.md).
 *
 * This keeps the SQL (that is the debugging value) and drops the values. It mutates in place and
 * returns the same object, so `instanceof`, `.cause` (the PostgresError: code, constraint_name) and
 * every reader in `@tokophi/lib/pg-errors` keep working. Duck-typed on purpose: no drizzle import,
 * so it also scrubs an error that crossed a module boundary or a mock in a test.
 */
export function scrubQueryError<E>(e: E): E {
  for (let cur: unknown = e, hops = 0; cur && typeof cur === "object" && hops < 5; cur = (cur as { cause?: unknown }).cause, hops++) {
    const c = cur as { query?: unknown; params?: unknown; message?: unknown };
    if (typeof c.query === "string" && "params" in c) {
      c.message = `Failed query: ${c.query}`;
      c.params = [];
    }
  }
  return e;
}
