import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import * as schema from "./schema";
import { IDENTITY_SQL, factsFromRow, judgeIdentity, planPools } from "./db-identity";

const LOCAL_DEV_URL = "postgresql://tokophi:tokophi@localhost:5433/tokophi";

// Task 4.12 / SEC-18 — TWO POOLS, and the restricted one has to prove it is restricted.
//
// WHAT WENT WRONG. This file read `process.env.APP_DATABASE_URL ?? ownerUrl`, so
// `DATABASE_RUNTIME_ROLE=app` with no APP_DATABASE_URL resolved, silently, to the OWNER connection.
// Measured on production 2026-08-22: all three app services carried that label, none carried the
// credential, and the role they connect as is `rolsuper = t, rolbypassrls = t`. The label said
// restricted for months; the identity never was — which is what Task 2.1 was recorded as leaving
// behind, and it is the same failure shape `@tokophi/lib/secret` exists to prevent: a fallback that
// keeps the process running is how a security control becomes decorative.
//
//   `db`    — the OWNER pool. The deliberate escape, and its callers are already the enumerated ones
//             (auth's pre-session read, `api/public/**`, cron, provision, super-admin, storefront).
//   `appDb` — the RESTRICTED pool in app-role mode, used by `withTenant()` and nothing else, so every
//             merchant read and write moves to a connection whose login role has no superuser and no
//             BYPASSRLS to reset back to. Outside app-role mode it IS the owner pool, so dev, test
//             and owner-mode surfaces open exactly one pool and behave as they always have.
//
// The refusal is a module-load throw, which is safe here and NOT the lazy first-use shape
// `@tokophi/lib/secret` needs: both Next builds already run with `DATABASE_RUNTIME_ROLE=owner
// DATABASE_URL=…build` in their Dockerfiles, and the storefront's build runs before
// `ENV NODE_ENV=production`, so nothing below fires during a build. A misconfigured RUNTIME should
// fail at start, loudly, rather than at the first request.
const plan = planPools(process.env, LOCAL_DEV_URL);
if (!plan.ok) throw new Error(`[@tokophi/db] ${plan.reason}`);

// Reuse the pools across HMR / serverless invocations.
const globalForDb = globalThis as unknown as { _tokophiPg?: Sql; _tokophiPgApp?: Sql };
const client = globalForDb._tokophiPg ?? postgres(plan.ownerUrl, { max: 10 });
// `max: 10` each, so an app-role admin holds up to 20 connections against `max_connections = 100`
// (10 open on production at the time of writing). The second pool is LAZY — postgres.js opens
// nothing until the first query — so an owner-mode surface that never calls `withTenant()` pays zero.
const appClient = plan.appUrl ? (globalForDb._tokophiPgApp ?? postgres(plan.appUrl, { max: 10 })) : client;
if (process.env.NODE_ENV !== "production") {
  globalForDb._tokophiPg = client;
  if (plan.appUrl) globalForDb._tokophiPgApp = appClient;
}

// ── The identity probe ────────────────────────────────────────────────────────────────────────────
// A URL naming a restricted role proves nothing: the role behind it is a fact only the database has.
// So we ask it, once — `pg_roles` for `current_user` AND `session_user` (a superuser that has run
// `SET ROLE tokophi_app` looks restricted from `current_user` alone, and is one `RESET ROLE` from
// everything).
//
// WHEN IT RUNS: armed at module load whenever a restricted pool exists, and awaited by
// `withTenant()`. Once, not per query — the promise is memoised, so the cost for the life of the
// process is a single round trip on a connection the pool was going to open anyway. Arming it at
// load means a mislabelled deploy dies in seconds with no traffic at all; awaiting it in `withTenant`
// means that even inside that window no tenant query can execute before the identity is proved. It
// cannot run synchronously at module load (a query is async) and it must not run per request (that
// is a round trip per page).
//
// FAILING CLOSED IS AN EXIT. There is no useful degraded mode: a process that cannot prove its
// identity is a process whose tenant isolation is unknown, and Next/Astro expose no "refuse to
// listen" hook reachable from a package. `restart: unless-stopped` plus the compose healthcheck turn
// that into a visible crash loop rather than a quiet privilege escalation. A database that is merely
// unreachable lands here too — deliberately: an app that cannot reach its database is not serving
// anything either, and "could not prove" must never read as "proved".
let identityGate: Promise<void> | undefined;

/**
 * Resolves once the restricted pool's role is proved restricted. Already-resolved when there is no
 * separate restricted pool, so local dev, `npm test` and every owner-mode surface pay nothing.
 */
export function assertRestrictedDbIdentity(): Promise<void> {
  if (!plan.ok || !plan.appUrl) return Promise.resolve();
  return (identityGate ??= appClient
    .unsafe(IDENTITY_SQL)
    .then((rows) => {
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error("the identity probe returned no row — pg_roles has no entry for the connected role.");
      const verdict = judgeIdentity(factsFromRow(row));
      if (!verdict.ok) throw new Error(verdict.reason);
      // Print the ROLE, never the connection string. The role name is the fact an operator needs; the
      // URL is a credential and must not reach a container log.
      console.log(`[@tokophi/db] restricted database identity verified: ${verdict.role}`);
    }));
}

if (plan.appUrl) {
  void assertRestrictedDbIdentity().catch((err: unknown) => {
    console.error(
      `[@tokophi/db] REFUSING TO SERVE — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}

/**
 * The OWNER connection. Correct for the paths that have no tenant to scope by — and wrong, silently,
 * for anything a merchant owns. Tenant data goes through `withTenant`/`withCurrentTenant`.
 */
export const db = drizzle(client, { schema, casing: "snake_case" });

/** The restricted connection. `withTenant()` is its only caller — do not reach for it directly. */
export const appDb = drizzle(appClient, { schema, casing: "snake_case" });

export { schema, client, appClient };
