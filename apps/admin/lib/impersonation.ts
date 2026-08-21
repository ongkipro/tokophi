import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { grantTokenHash } from "@tokophi/lib/impersonation";
import { sessionOutlivesPassword } from "@tokophi/lib/session-revocation";
import type { Session } from "@/lib/auth";

/**
 * SPENDING AN IMPERSONATION HANDLE — the merchant side of the exchange (Task 4.11 / SEC-10).
 *
 * The super-admin's `impersonateStore` writes an `impersonation_grants` row and redirects the
 * operator's browser here with the plaintext handle. This module turns that handle into a merchant
 * session exactly once, or refuses.
 *
 * 🔴 THE WHOLE DESIGN IS IN ONE STATEMENT. `claimGrant` below is:
 *
 *     update impersonation_grants set consumed_at = now()
 *      where token_hash = $1 and consumed_at is null and expires_at > now() returning …
 *
 * · **Replay** — the second attempt sees `consumed_at is not null` and matches nothing.
 * · **Tamper** — one changed character is a different sha256, i.e. a row that never existed.
 * · **Expiry** — `expires_at > now()` is INSIDE the predicate, evaluated by Postgres on its own
 *   clock, not by a comparison we could forget to write.
 * · **Concurrency** — Postgres takes the row lock; the loser blocks, re-evaluates the predicate
 *   after the winner commits, and matches zero rows. Two tabs cannot both win. (Same idiom as
 *   `receivePurchaseOrder`'s claim, and it is here for the same reason: read-then-write is a race.)
 *
 * ⚠️ THE GRANT IS A PERMISSION TO EXCHANGE, NOT A SNAPSHOT TO TRUST. Everything it names is re-read
 * after the claim — the merchant's membership and CURRENT role, and the operator's row and CURRENT
 * rank. That is the control plane's standing rule ("rank comes from `platform_admins`, on every
 * request. Never from the cookie") carried across the gap between minting a link and clicking it. A
 * grant minted by an owner who was demoted, deleted or had their password rotated ten seconds later
 * is dead, and the merchant's role is whatever `store_users` says now — never what the link said.
 *
 * ⚠️ OWNER CONNECTION, DELIBERATELY. This runs BEFORE any session exists, exactly like
 * `lib/auth.ts`'s `findLogin`, so there is no `app.store_id` to set and `withCurrentTenant` would
 * scope it to the nil sentinel and find nothing. `impersonation_grants` carries RLS with no policy
 * precisely so that this owner path is the only one that can read it (see migration 0098).
 */

/** Why an exchange did not happen. Coarse on the wire (every failure redirects to `/login`
 *  identically — a caller must not learn WHICH), but named here so the server log and the tests can
 *  tell replay from expiry from a handle that never existed. */
export type ExchangeFailure =
  | "no-token"
  | "unknown" // no row with this hash — a guess, a truncation, or a tampered character
  | "spent" // already redeemed: the replay case this table exists to make impossible
  | "expired"
  | "operator-gone" // the operator's row was deleted between mint and click
  | "operator-changed" // demoted, or password rotated — the grant dies with the rank that made it
  | "membership-gone"; // the merchant is no longer in the store the grant names

export type ExchangeResult =
  | { ok: true; session: Session; slug: string }
  | { ok: false; reason: ExchangeFailure };

type ClaimedGrant = {
  id: string;
  storeId: string;
  userId: string;
  operatorId: string;
  operatorEmail: string;
  operatorRole: string;
  createdAt: Date;
};

/**
 * The atomic half. Returns the row if THIS call is the one that spent it, else null.
 *
 * ⚠️ `now()` is Postgres's clock on both sides of the comparison — never `new Date()` from Node.
 * Two containers with a few seconds of skew would otherwise disagree about whether a 120-second
 * handle is still alive, and the direction of that error is "accept an expired handle".
 */
async function claimGrant(tokenHash: string): Promise<ClaimedGrant | null> {
  const [row] = await db
    .update(schema.impersonationGrants)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(schema.impersonationGrants.tokenHash, tokenHash),
        isNull(schema.impersonationGrants.consumedAt),
        sql`${schema.impersonationGrants.expiresAt} > now()`,
      ),
    )
    .returning({
      id: schema.impersonationGrants.id,
      storeId: schema.impersonationGrants.storeId,
      userId: schema.impersonationGrants.userId,
      operatorId: schema.impersonationGrants.operatorId,
      operatorEmail: schema.impersonationGrants.operatorEmail,
      operatorRole: schema.impersonationGrants.operatorRole,
      createdAt: schema.impersonationGrants.createdAt,
    });
  return row ?? null;
}

/**
 * Why the claim matched nothing. A SECOND read, on the failure path only — it costs nothing on the
 * happy path and it is the difference between a log line that says "replay attempt on a grant
 * consumed 4 minutes ago" and one that says "something did not work".
 *
 * ⚠️ This classification is for OUR logs and OUR tests. It is never returned to the browser: every
 * failure below produces the same redirect, because distinguishing "expired" from "never existed"
 * for a caller is an oracle for guessing handles.
 */
async function classifyFailure(tokenHash: string): Promise<ExchangeFailure> {
  const [row] = await db
    .select({
      consumedAt: schema.impersonationGrants.consumedAt,
      expiresAt: schema.impersonationGrants.expiresAt,
    })
    .from(schema.impersonationGrants)
    .where(eq(schema.impersonationGrants.tokenHash, tokenHash))
    .limit(1);
  if (!row) return "unknown";
  if (row.consumedAt) return "spent";
  return "expired";
}

/**
 * Spend a handle and build the merchant session it entitles the operator to.
 *
 * @param token the opaque handle from the query string, verbatim.
 */
export async function consumeImpersonationGrant(token: string | null | undefined): Promise<ExchangeResult> {
  if (!token) return { ok: false, reason: "no-token" };
  const tokenHash = grantTokenHash(token);

  const grant = await claimGrant(tokenHash);
  if (!grant) return { ok: false, reason: await classifyFailure(tokenHash) };

  // ── The operator, re-read. A grant is not a rank. ────────────────────────────────────────────
  const [operator] = await db
    .select({
      role: schema.platformAdmins.role,
      passwordChangedAt: schema.platformAdmins.passwordChangedAt,
    })
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.id, grant.operatorId))
    .limit(1);
  if (!operator) return { ok: false, reason: "operator-gone" };
  // ⚠️ EQUALITY, NOT A RANK COMPARISON, AND THAT IS THE POINT. The ladder
  // (`support` 1 < `admin` 2 < `owner` 3) lives in `apps/super-admin/lib/platform-rank.ts` and must
  // stay ONE copy — this repo has paid for a duplicated security constant twice (the 24-bit password
  // mint; the two comment strippers). Requiring the live role to still equal the role that minted
  // the grant refuses every demotion without importing the ladder at all, and it is strictly
  // stricter: a *promotion* inside the window also invalidates, which costs one more click.
  if (operator.role !== grant.operatorRole) return { ok: false, reason: "operator-changed" };
  // The operator's password was rotated after this grant was minted — the incident-response move.
  // Same shared rule as both session surfaces, so a leaked operator credential cannot cash in a
  // link it created seconds before the reset.
  if (!sessionOutlivesPassword(Math.floor(grant.createdAt.getTime() / 1000), operator.passwordChangedAt)) {
    return { ok: false, reason: "operator-changed" };
  }

  // ── The merchant, re-read. Role from the ROW, exactly as `getSession()` does on every request. ──
  const [membership] = await db
    .select({
      role: schema.storeUsers.role,
      email: schema.users.email,
      name: schema.users.name,
      slug: schema.stores.slug,
    })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
    .where(and(eq(schema.storeUsers.userId, grant.userId), eq(schema.storeUsers.storeId, grant.storeId)))
    .limit(1);
  if (!membership) return { ok: false, reason: "membership-gone" };

  return {
    ok: true,
    slug: membership.slug,
    session: {
      userId: grant.userId,
      storeId: grant.storeId,
      role: membership.role,
      email: membership.email,
      name: membership.name ?? membership.email,
      // THE OPERATOR TRAVELS WITH THE SESSION. It is inside the signed JWT, so it cannot be added,
      // removed or edited by whoever holds the cookie — and every downstream merchant write can name
      // both parties (see `requireCapability`). Without this the audit trail stopped at "the owner
      // did it", which is what the merchant's own screen would say too.
      imp: {
        operatorId: grant.operatorId,
        operatorEmail: grant.operatorEmail,
        grantId: grant.id,
      },
    },
  };
}

/**
 * The audit row for an impersonation that actually STARTED (or ENDED). Written on the OWNER
 * connection into `platform_activity` — the platform's own cross-tenant log, the same table
 * `apps/super-admin` writes and the one table `verify-rls` exempts by design.
 *
 * Kept here rather than in `lib/actions/*` because both writers are outside the tenant wrappers:
 * the exchange runs before a session exists, and the gate runs before `withTenant` opens.
 */
export async function logImpersonation(storeId: string, text: string): Promise<void> {
  await db.insert(schema.platformActivity).values({ kind: "admin", text, storeId });
}
