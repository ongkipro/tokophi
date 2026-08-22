/**
 * Task 4.12 / SEC-18 — which credential this process may use, and whether the role behind it is
 * actually restricted. PURE: this module imports nothing and reads nothing but the object it is
 * handed, so it is testable without a database. Same split as `platform-rank.ts` / `route-roles.ts`
 * / `store-servable.ts`, and for the same reason: `client.ts` opens a pool at module scope, so a
 * rule that lives in it cannot be driven by a test.
 *
 * WHAT WENT WRONG. `client.ts` read
 *     const appUrl = process.env.APP_DATABASE_URL ?? ownerUrl;
 * so `DATABASE_RUNTIME_ROLE=app` with no `APP_DATABASE_URL` resolved, silently, to the OWNER
 * connection. Measured on production 2026-08-22: all three app services carry that label, none
 * carries the credential, and the role they connect as is `rolsuper = t, rolbypassrls = t`. The
 * label said restricted for months; the identity never was. That is the whole of SEC-18 — and it is
 * the failure mode `AUTH_SECRET` was given a fail-closed resolver for (`@tokophi/lib/secret`): a
 * fallback that keeps the process running is exactly how a security control becomes decorative.
 *
 * A CONNECTION STRING NEVER APPEARS IN A REASON STRING. Every value returned from here is written to
 * a log or an exception on the failure path, and a Postgres URL carries the password inline. The
 * strings below name env VARIABLES and ROLES, never values; `db-identity.test.ts` asserts it against
 * a URL with a password in it, because "we were careful" is not a guard.
 */

/** The only role `withTenant()` may drop into (`rls.ts` issues `set local role tokophi_app`). */
export const APP_ROLE = "tokophi_app";

export type RuntimeRole = "app" | "owner";

/** The env this decision reads. Passed in rather than read, so the tests are not a mutation of `process.env`. */
export type DbEnv = {
  DATABASE_URL?: string;
  APP_DATABASE_URL?: string;
  DATABASE_RUNTIME_ROLE?: string;
  NODE_ENV?: string;
};

/**
 * TWO POOLS, and which one a query lands on is decided by the WRAPPER it went through — not by a
 * fallback and not by a per-call-site choice:
 *
 *  - `ownerUrl` backs the `db` handle. It is the deliberate owner escape, and its callers are already
 *    enumerated by a rule this repo has enforced since day one (AGENTS.md: *"Do NOT use a bare
 *    module-level `db` for admin tenant data — it would run as owner and bypass RLS. Auth,
 *    super-admin and the storefront are the deliberate exceptions"*): the pre-session `store_users`
 *    read in `lib/auth.ts`, `apps/admin/app/api/public/**`, the cron sweeps, `lib/provision.ts` (slug
 *    uniqueness must see every store), the cross-tenant control plane, and the Host-resolved
 *    storefront catalog.
 *  - `appUrl` backs `appDb`, which ONLY `withTenant()` uses — i.e. all 79 merchant files, every
 *    `lib/data/*` read and every `lib/actions/*` write. `null` means "there is no separate restricted
 *    pool; tenant transactions share the owner pool", which is dev, test, and any owner-mode surface.
 *
 * Why the split is the whole point: `withTenant` already issues `SET LOCAL ROLE tokophi_app`, which
 * restricts INSIDE the transaction even on an owner connection. What it cannot do is survive a
 * `RESET ROLE`, and it says nothing about a connection that is a superuser to begin with. Moving
 * tenant traffic onto a pool whose login role IS non-superuser, non-BYPASSRLS makes the restriction a
 * property of the connection instead of a property of the last statement anyone ran on it.
 *
 * ⚠️ AND IT IS WHY THE OTHER DIRECTION IS NOT AVAILABLE. Measured on production 2026-08-22 as
 * `tokophi_app` with no tenant GUC: `stores` 0, `store_users` 0, `products` 0 (owner sees 14/13/78) —
 * not a permission error, RLS filtering, because all 50 policies are `TO PUBLIC` and
 * `app_current_store_id()` is NULL when nothing set the GUC. So a surface whose reads do NOT go
 * through `withTenant` cannot be moved onto the restricted pool at all: nobody could log in, every
 * shop would 404 and the control plane would render empty. That is the measurement behind
 * `DATABASE_RUNTIME_ROLE: owner` on super-admin and the storefront (0 `withTenant` call sites each).
 */
export type PoolPlan =
  | { ok: true; role: RuntimeRole; ownerUrl: string; appUrl: string | null }
  | { ok: false; reason: string };

/**
 * ⚠️ THE FALLBACK IS GONE ON PURPOSE, AND IT IS A DEPLOYMENT PRECONDITION. A service labelled `app`
 * with no `APP_DATABASE_URL` now refuses to start instead of quietly running as owner.
 * `APP_DATABASE_URL` must exist in the environment BEFORE this merges. See
 * `specs/docs/tasks/2026-08-22-task-4.12-restricted-db-identity.md` §⑤.
 *
 * Dev and test keep today's frictionless behaviour (owner on `DATABASE_URL`, falling back to the
 * docker-compose localhost default, one pool): there is nothing to prove about a disposable
 * database, and probing there would make `npm test` depend on a login role nobody has provisioned
 * locally.
 */
export function planPools(env: DbEnv, localDevUrl: string): PoolPlan {
  const production = env.NODE_ENV === "production";
  const role: RuntimeRole = production && env.DATABASE_RUNTIME_ROLE === "app" ? "app" : "owner";

  if (!production) {
    return { ok: true, role: "owner", ownerUrl: env.DATABASE_URL || localDevUrl, appUrl: null };
  }

  // The owner URL is required in BOTH modes. An app-role surface still runs auth, the public API and
  // the cron sweeps on it — dropping it would not harden anything, it would delete the login page.
  if (!env.DATABASE_URL) {
    return { ok: false, reason: "DATABASE_URL is not set. Every surface needs the owner connection for its pre-session, public-API and cron paths." };
  }

  if (role === "app") {
    if (!env.APP_DATABASE_URL) {
      return {
        ok: false,
        reason:
          "DATABASE_RUNTIME_ROLE=app but APP_DATABASE_URL is not set. app-role mode no longer falls back to " +
          "DATABASE_URL (the owner connection) — that fallback is exactly what made the restricted label untrue. " +
          `Set APP_DATABASE_URL to a credential for a role that is neither superuser nor BYPASSRLS (e.g. ${APP_ROLE}), ` +
          "or set DATABASE_RUNTIME_ROLE=owner if this surface has no withTenant() traffic to restrict.",
      };
    }
    return { ok: true, role: "app", ownerUrl: env.DATABASE_URL, appUrl: env.APP_DATABASE_URL };
  }

  return { ok: true, role: "owner", ownerUrl: env.DATABASE_URL, appUrl: null };
}

/**
 * What the probe reads back. `current_user` is the EFFECTIVE role, `session_user` is the one that
 * logged in — and both are checked, because they differ exactly when it matters: a superuser
 * connection that has run `SET ROLE tokophi_app` reports a restricted `current_user` while remaining
 * one `RESET ROLE` away from full privilege. Judging `current_user` alone would call that connection
 * safe.
 */
export type IdentityFacts = {
  currentUser: string;
  sessionUser: string;
  currentSuper: boolean;
  currentBypassRls: boolean;
  sessionSuper: boolean;
  sessionBypassRls: boolean;
  /** Can this connection reach `tokophi_app`? `withTenant()` issues `set local role tokophi_app` on every txn. */
  canAssumeAppRole: boolean;
};

export type IdentityVerdict = { ok: true; role: string } | { ok: false; reason: string };

/**
 * Is this connection allowed to serve app-role traffic?
 *
 * Fail closed on anything that is not provably restricted, and name the ONE fact that failed — a
 * refusal an operator cannot act on is a crash loop with extra words.
 *
 * ⚠️ WHAT THIS DOES **NOT** PROVE, stated so nobody reads more into a green probe than is there:
 *  - A role that is a MEMBER of a superuser role is not superuser itself and passes here, while
 *    still being one `SET ROLE` from everything. Membership is not walked: `tokophi_app` is granted
 *    directly and a general "reachable privilege" closure is a different, larger piece of work.
 *  - `FORCE ROW LEVEL SECURITY` is on **0** tables (measured on production), so a non-superuser that
 *    happens to OWN a table still bypasses that table's own policies. Out of scope by owner decision
 *    — it is a migration over 54 tables, recorded in the preflight §3.
 *  - This says nothing about queries issued outside `withTenant()`. Those run with no `app.store_id`
 *    GUC; under a restricted role every policed table returns zero rows, which is why the
 *    cross-tenant surfaces are still owner-mode. See the task handoff §③.
 */
export function judgeIdentity(f: IdentityFacts): IdentityVerdict {
  if (f.sessionSuper) return { ok: false, reason: refusal("session_user", f.sessionUser, "is a SUPERUSER") };
  if (f.currentSuper) return { ok: false, reason: refusal("current_user", f.currentUser, "is a SUPERUSER") };
  if (f.sessionBypassRls) return { ok: false, reason: refusal("session_user", f.sessionUser, "holds BYPASSRLS") };
  if (f.currentBypassRls) return { ok: false, reason: refusal("current_user", f.currentUser, "holds BYPASSRLS") };
  if (!f.canAssumeAppRole) {
    return {
      ok: false,
      reason:
        `the connected role "${f.currentUser}" cannot assume "${APP_ROLE}", so every withTenant() transaction ` +
        `would fail on 'set local role ${APP_ROLE}'. GRANT ${APP_ROLE} TO "${f.currentUser}".`,
    };
  }
  return { ok: true, role: f.currentUser };
}

const refusal = (which: string, role: string, what: string) =>
  `${which} "${role}" ${what}, so DATABASE_RUNTIME_ROLE=app is a false label: RLS policies do not apply to it ` +
  "and every tenant boundary in this database rests on application code alone. Point APP_DATABASE_URL at a " +
  `restricted role (e.g. ${APP_ROLE}: not superuser, no BYPASSRLS), or set DATABASE_RUNTIME_ROLE=owner.`;

/**
 * The probe. One query, one round trip — the facts come from `pg_roles`, which is the catalog, not a
 * guess about what the URL says. Kept here (a string, not a call) so the pure module owns the shape
 * the judge consumes and `client.ts` owns only the execution.
 *
 * The join is against `pg_roles` twice because `current_user` and `session_user` can differ; both
 * rows always exist, so the query cannot return zero rows for a live connection.
 *
 * ⚠️ The aliases are `cur_*`/`sess_*`, NOT `current_user`/`session_user`: both of those are reserved
 * words in Postgres and an unquoted alias of one is a syntax error. A wrong alias here is invisible
 * to `tsc` — it is a string — which is why the Postgres half of the test suite runs this constant
 * itself rather than a hand-written copy of it.
 */
export const IDENTITY_SQL = `
  select
    current_user::text as cur_user,
    session_user::text as sess_user,
    c.rolsuper         as cur_super,
    c.rolbypassrls     as cur_bypass_rls,
    s.rolsuper         as sess_super,
    s.rolbypassrls     as sess_bypass_rls,
    pg_has_role(current_user, '${APP_ROLE}', 'USAGE') as can_assume_app_role
  from pg_roles c, pg_roles s
  where c.rolname = current_user and s.rolname = session_user`;

/** Shape the raw row (snake_case, from the driver) into the facts the judge reads. */
export function factsFromRow(row: Record<string, unknown>): IdentityFacts {
  return {
    currentUser: String(row.cur_user ?? ""),
    sessionUser: String(row.sess_user ?? ""),
    currentSuper: row.cur_super === true,
    currentBypassRls: row.cur_bypass_rls === true,
    sessionSuper: row.sess_super === true,
    sessionBypassRls: row.sess_bypass_rls === true,
    canAssumeAppRole: row.can_assume_app_role === true,
  };
}
