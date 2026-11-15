// Super Admin → Affiliate: the support desk for affiliate ACCOUNTS (ADR 0022) — the interim answer to
// AFFILIATE-PW-RESET while the platform has no mail provider. The logic takes `db` so the real-Postgres
// suite (`affiliate-accounts.test.ts`) runs it inside a rolled-back transaction; the "use server" wrappers
// in `lib/actions/affiliate-accounts.ts` add the rank gate (`platformGate`) and nothing else.
//
// Platform-level tables (no store_id, RLS on with no policy) on the OWNER connection: every statement
// carries an explicit account-id predicate. Each write and its `platform_activity` line commit together,
// and the line reports what the write RETURNED, never what was asked.
import type { db as DbClient } from "@tokophi/db";
import * as schema from "@tokophi/db/schema";
import { likeContains } from "@tokophi/lib/like";
import { hashPassword, tempPassword } from "@tokophi/lib/password";
import { isUuid } from "@tokophi/lib/uuid";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

export type Db = typeof DbClient;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** One row per affiliate account; `stores` = every store programme this account is bound to. */
export type AffiliateAccountRow = {
  id: string;
  email: string;
  name: string;
  phone: string;
  createdAt: Date;
  disabledAt: Date | null;
  /** Sessions that would still sign this account in (not revoked, not expired). */
  liveSessions: number;
  stores: { name: string; slug: string; status: "menunggu" | "aktif" | "ditolak" | "nonaktif" }[];
};

export const AFFILIATE_LIST_LIMIT = 200;

/** Newest first; `q` matches email or name (case-insensitive, typed `%`/`_` matched literally). */
export async function listAffiliateAccounts(db: Db, q?: string): Promise<{ rows: AffiliateAccountRow[]; total: number }> {
  const a = schema.affiliateAccounts;
  const term = (q ?? "").trim().slice(0, 100);
  const where = term ? sql`(${a.email} ilike ${likeContains(term.toLowerCase())} or ${a.name} ilike ${likeContains(term)})` : undefined;
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(a)
    .where(where);
  const rows = await db
    .select({
      id: a.id,
      email: a.email,
      name: a.name,
      phone: a.phone,
      createdAt: a.createdAt,
      disabledAt: a.disabledAt,
      // Qualified BY NAME inside the correlated subqueries: drizzle renders an interpolated column
      // unqualified in a `sql` template, and the inner scope would win (same as listSignupCodes).
      liveSessions: sql<number>`(select count(*)::int from affiliate_sessions s
        where s.account_id = "affiliate_accounts"."id" and s.revoked_at is null and s.expires_at > now())`,
      stores: sql<AffiliateAccountRow["stores"]>`coalesce((select json_agg(json_build_object('name', st.name, 'slug', st.slug, 'status', af.status) order by st.name)
        from affiliates af join stores st on st.id = af.store_id
        where af.account_id = "affiliate_accounts"."id"), '[]'::json)`,
    })
    .from(a)
    .where(where)
    .orderBy(desc(a.createdAt))
    .limit(AFFILIATE_LIST_LIMIT);
  return { rows: rows.map((r) => ({ ...r, liveSessions: Number(r.liveSessions) })), total: Number(total) };
}

const NOT_FOUND = "Akun affiliate tidak ditemukan.";

/** Revoke every live session of the account; returns how many were live. */
async function revokeAll(tx: Tx, accountId: string): Promise<number> {
  const s = schema.affiliateSessions;
  const revoked = await tx
    .update(s)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(s.accountId, accountId), isNull(s.revokedAt)))
    .returning({ id: s.id });
  return revoked.length;
}

const log = (tx: Tx, text: string) => tx.insert(schema.platformActivity).values({ kind: "admin", text });

export type ResetResult = { ok: true; email: string; password: string; revokedSessions: number } | { ok: false; error: string };

/**
 * A random password from the ONE mint (`tempPassword`), shown to the operator once and stored only as its
 * scrypt hash. In the same transaction every session of the account is revoked, so whoever held the old
 * password (or a stolen cookie) is signed out. A DISABLED account keeps its `disabled_at` — a reset is not
 * a way to re-open an account somebody closed; that is the separate "Aktifkan" action.
 */
export async function resetAffiliatePassword(db: Db, accountId: string, operatorEmail: string): Promise<ResetResult> {
  if (!isUuid(accountId)) return { ok: false, error: NOT_FOUND };
  const password = tempPassword();
  return db.transaction(async (tx) => {
    const a = schema.affiliateAccounts;
    const [row] = await tx
      .update(a)
      .set({ passwordHash: hashPassword(password) })
      .where(eq(a.id, accountId))
      .returning({ email: a.email, disabledAt: a.disabledAt });
    if (!row) return { ok: false as const, error: NOT_FOUND };
    const revokedSessions = await revokeAll(tx, accountId);
    await log(
      tx,
      `Password akun affiliate ${row.email} direset oleh ${operatorEmail} — ${revokedSessions} sesi dicabut${row.disabledAt ? " (akun tetap nonaktif)" : ""}`,
    );
    return { ok: true as const, email: row.email, password, revokedSessions };
  });
}

export type DisableResult = { ok: true; email: string; disabled: boolean; revokedSessions: number } | { ok: false; error: string };

/**
 * Disable = the account cannot sign in (`checkCredentials` refuses it) AND every live session is revoked
 * now (`loadSession` would refuse them anyway; revoking makes it a fact in the table, not only a filter).
 * Enable = `disabled_at` cleared; sessions stay revoked, the affiliate signs in again. One conditional
 * UPDATE decides: a second click (or a stale tab) changes nothing and is told so.
 */
export async function setAffiliateDisabled(db: Db, accountId: string, disabled: boolean, operatorEmail: string): Promise<DisableResult> {
  if (!isUuid(accountId)) return { ok: false, error: NOT_FOUND };
  return db.transaction(async (tx) => {
    const a = schema.affiliateAccounts;
    const [row] = await tx
      .update(a)
      .set({ disabledAt: disabled ? sql`now()` : null })
      .where(and(eq(a.id, accountId), disabled ? isNull(a.disabledAt) : isNotNull(a.disabledAt)))
      .returning({ email: a.email });
    if (!row) {
      const [exists] = await tx.select({ id: a.id }).from(a).where(eq(a.id, accountId)).limit(1);
      return { ok: false as const, error: exists ? (disabled ? "Akun ini sudah nonaktif." : "Akun ini sudah aktif.") : NOT_FOUND };
    }
    const revokedSessions = disabled ? await revokeAll(tx, accountId) : 0;
    await log(
      tx,
      disabled
        ? `Akun affiliate ${row.email} dinonaktifkan oleh ${operatorEmail} — ${revokedSessions} sesi dicabut`
        : `Akun affiliate ${row.email} diaktifkan lagi oleh ${operatorEmail}`,
    );
    return { ok: true as const, email: row.email, disabled, revokedSessions };
  });
}
