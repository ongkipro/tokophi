import "server-only";
import { db, schema } from "@tokophi/db";
import { and, asc, eq, sql } from "drizzle-orm";

/**
 * WHICH STORE A MULTI-STORE USER GETS, AND WHO MAY SWITCH TO WHAT (Task 5.9 / F-T10).
 *
 * Measured defect (2026-08-23): a user with memberships in two stores landed on an ARBITRARY store
 * at login — `findLogin`'s membership join had no ORDER BY, so the row that won was whatever the
 * query plan surfaced first — and the topbar switcher never offered the second store at all.
 *
 * 🔴 THE SELECTION CONTRACT — this ORDER BY is the product rule, not an implementation detail:
 * **earliest `invited_at` first (nulls last), tie-broken by ascending store id.** The store you were
 * invited to first is "your" store by default; the tie-break exists only so that two same-instant
 * invitations still resolve to ONE answer on every plan, every replica, every deploy. Every reader
 * of "the default membership" — `findLogin` (auth.ts), `listMemberships` below — must sort by this
 * one definition. A second copy of the ordering is how the two would drift apart.
 *
 * ⚠️ OWNER CONNECTION, DELIBERATELY — same standing exception as `findLogin` and the impersonation
 * exchange: everything here runs BEFORE a tenant context exists (login) or ACROSS tenants by
 * definition (listing every store one user belongs to). `withCurrentTenant` would scope these reads
 * to one store and return exactly the wrong answer.
 */
export function membershipOrder() {
  // `invited_at` is nullable in the schema (`ts()` has no default) — rows written by paths that
  // never stamped it must sort AFTER every dated invitation, not before (Postgres default for
  // `asc` is NULLS LAST, but saying it makes the contract survive a copy into a DESC context).
  return [sql`${schema.storeUsers.invitedAt} asc nulls last`, asc(schema.storeUsers.storeId)];
}

export type Membership = {
  storeId: string;
  name: string;
  slug: string;
  role: string;
};

/**
 * Every live membership of one user, in contract order — the topbar switcher's data source.
 * "Live" is simply "the `store_users` row exists NOW": deleting the row is what revocation IS here
 * (that is why deleting a membership logs a merchant out — see `getSession`).
 */
export async function listMemberships(userId: string): Promise<Membership[]> {
  return db
    .select({
      storeId: schema.storeUsers.storeId,
      name: schema.stores.name,
      slug: schema.stores.slug,
      role: schema.storeUsers.role,
    })
    .from(schema.storeUsers)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
    .where(eq(schema.storeUsers.userId, userId))
    .orderBy(...membershipOrder());
}

/**
 * Is THIS user a member of THAT store, right now? `null` means no — the caller must refuse.
 *
 * This is the boundary check `switchStore` runs before re-minting a session: a client-supplied
 * store id is a claim we verify against `store_users` in the same action, never an instruction we
 * obey. The role comes from the row, so a switch also picks up a demotion that happened since login.
 */
export async function resolveMembership(userId: string, storeId: string): Promise<Membership | null> {
  const [row] = await db
    .select({
      storeId: schema.storeUsers.storeId,
      name: schema.stores.name,
      slug: schema.stores.slug,
      role: schema.storeUsers.role,
    })
    .from(schema.storeUsers)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
    .where(and(eq(schema.storeUsers.userId, userId), eq(schema.storeUsers.storeId, storeId)))
    .limit(1);
  return row ?? null;
}

/**
 * The login row: the account by email, LEFT-joined to its DEFAULT membership (contract order).
 *
 * LEFT join, not inner — an account whose every membership has been revoked still exists and still
 * has a password. With the old inner join such a user was indistinguishable from a typo'd email
 * ("Email atau kata sandi salah"), which is a lie to the one person entitled to the truth: the
 * password check proves they own the account, so `signIn` can and does tell them the real reason
 * (`storeId === null` ⇒ no store access, a distinct message). Membership fields are therefore
 * nullable in the returned shape, and `signIn` refuses to mint a session without them.
 */
export async function findLoginRow(email: string) {
  const [row] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      passwordHash: schema.users.passwordHash,
      totpEnabled: schema.users.totpEnabled,
      totpSecret: schema.users.totpSecret,
      storeId: schema.storeUsers.storeId,
      role: schema.storeUsers.role,
      slug: schema.stores.slug,
    })
    .from(schema.users)
    .leftJoin(schema.storeUsers, eq(schema.storeUsers.userId, schema.users.id))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
    .where(eq(schema.users.email, email.toLowerCase().trim()))
    .orderBy(...membershipOrder())
    .limit(1);
  return row ?? null;
}
