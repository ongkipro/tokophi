/**
 * Reading a Postgres constraint violation off a thrown error. Pure — no `pg`, no drizzle, no
 * `@tokophi/db` import: it inspects a value it is handed, so both apps can use it and neither pays
 * for the other's database client.
 *
 * ⚠️ THE FIELD IS `constraint_name`, NOT `constraint`. Measured 2026-08-05 against the real test
 * database through this repo's own driver (`postgres` + drizzle): a duplicate `users.email` throws a
 * `PostgresError` carrying
 *
 *     { code: "23505", constraint_name: "users_email_unique", table_name: "users",
 *       detail: 'Key (email)=(…) already exists.' }
 *
 * and `.constraint` is `undefined`. `node-postgres` spells it `constraint`, which is what most
 * examples on the internet show — reading that field here silently yields `undefined` for every
 * violation, so the fallback branch swallows a conflict the caller could have explained.
 *
 * Both are accepted below anyway. Not superstition: the driver is a swap away (the PostgREST cutover
 * is on the roadmap), and the failure mode of guessing wrong is an unexplained 500 on a signup form.
 */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

export type PgErrorFields = { code: string; constraint_name?: string };

/**
 * The driver's own error, found anywhere on a `cause` chain.
 *
 * ⚠️ drizzle-orm >= 0.44 WRAPS every failed query in a `DrizzleQueryError` whose `.cause` is the
 * `PostgresError` — `.code` / `.constraint_name` are no longer on the thrown value, and `.message`
 * is `Failed query: <sql> params: …` instead of the Postgres text. Measured 2026-11-02 while moving
 * 0.36 → 0.45: six DB tests went red, and `uniqueViolationConstraint` returned `null` for a real
 * duplicate email (signup would have reported an unexplained error instead of the conflict).
 * Every reader of a Postgres error goes through here so the next driver/ORM swap is one file.
 */
export function pgError(e: unknown): PgErrorFields | null {
  for (let cur: unknown = e, hops = 0; cur && typeof cur === "object" && hops < 5; cur = (cur as { cause?: unknown }).cause, hops++) {
    const c = cur as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    // SQLSTATE is exactly five chars of [0-9A-Z]; Node's own `code`s (ENOTFOUND, ECONNRESET…) are not.
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) {
      const name = c.constraint_name ?? c.constraint;
      return { code: c.code, ...(typeof name === "string" ? { constraint_name: name } : {}) };
    }
  }
  return null;
}

export function uniqueViolationConstraint(e: unknown): string | null {
  const err = pgError(e);
  if (!err || err.code !== UNIQUE_VIOLATION) return null;
  // A 23505 with no constraint name is still a 23505 — report it as a conflict rather than as a
  // non-conflict, or the caller falls through to "unexpected error" on the one case it handles.
  return err.constraint_name ?? "";
}

/** `23503`; pass `constraint` to require that ONE named foreign key (a bare code can be another FK). */
export function isForeignKeyViolation(e: unknown, constraint?: string): boolean {
  const err = pgError(e);
  return !!err && err.code === FOREIGN_KEY_VIOLATION && (constraint === undefined || err.constraint_name === constraint);
}
