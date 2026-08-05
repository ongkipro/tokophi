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

export function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: unknown; constraint_name?: unknown; constraint?: unknown } | null;
  if (!err || err.code !== UNIQUE_VIOLATION) return null;
  const name = err.constraint_name ?? err.constraint;
  // A 23505 with no constraint name is still a 23505 — report it as a conflict rather than as a
  // non-conflict, or the caller falls through to "unexpected error" on the one case it handles.
  return typeof name === "string" ? name : "";
}
