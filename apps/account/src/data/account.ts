// TokoΦ Account — identity and sessions (ADR 0016, BUYER-ACCOUNT-P1). Cross-tenant platform data on
// the owner connection: every statement here carries an explicit buyer_id / session id predicate.
// Functions take `db` so the real-Postgres tests can run them inside a rolled-back transaction.
import type { db as DbClient } from "@tokophi/db";
import * as schema from "@tokophi/db/schema";
import { isUuid } from "@tokophi/lib/uuid";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { lockActiveAccount } from "./account-lock";

export type Db = typeof DbClient;
export type Account = { id: string; name: string | null; email: string | null };

/** Sessions older than this are dead even if never revoked (the cookie lives as long). */
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** Google sign-in (ACC-10) and the local dev sign-in (`dev:<email>`): one row per `sub`, ever. */
export async function upsertAccountBySub(db: Db, p: { sub: string; email: string; name: string | null }): Promise<string | null> {
  const [row] = await db
    .insert(schema.buyerAccounts)
    .values({ googleSub: p.sub, email: p.email, name: p.name })
    .onConflictDoUpdate({
      target: schema.buyerAccounts.googleSub,
      set: { email: p.email, name: sql`coalesce(${schema.buyerAccounts.name}, excluded.name)` },
    })
    .returning({ id: schema.buyerAccounts.id, status: schema.buyerAccounts.status });
  return row && row.status === "active" ? row.id : null;
}

export async function createSession(db: Db, buyerId: string, userAgent: string | null): Promise<string> {
  const [row] = await db
    .insert(schema.buyerSessions)
    .values({ buyerId, userAgent: userAgent?.slice(0, 300) ?? null })
    .returning({ id: schema.buyerSessions.id });
  return row.id;
}

/** The row decides, never the cookie: revoked, expired, unknown, or a non-active account ⇒ null. */
export async function loadSession(db: Db, sessionId: string): Promise<{ sessionId: string; account: Account } | null> {
  const [row] = await db
    .select({
      sessionId: schema.buyerSessions.id,
      id: schema.buyerAccounts.id,
      name: schema.buyerAccounts.name,
      email: schema.buyerAccounts.email,
    })
    .from(schema.buyerSessions)
    .innerJoin(schema.buyerAccounts, eq(schema.buyerAccounts.id, schema.buyerSessions.buyerId))
    .where(
      and(
        eq(schema.buyerSessions.id, sessionId),
        isNull(schema.buyerSessions.revokedAt),
        sql`${schema.buyerSessions.createdAt} > now() - make_interval(secs => ${SESSION_MAX_AGE_SEC})`,
        eq(schema.buyerAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Cheap liveness stamp, at most every 5 minutes.
  await db
    .update(schema.buyerSessions)
    .set({ lastSeenAt: sql`now()` })
    .where(and(eq(schema.buyerSessions.id, sessionId), sql`${schema.buyerSessions.lastSeenAt} < now() - interval '5 minutes'`));
  return { sessionId: row.sessionId, account: { id: row.id, name: row.name, email: row.email } };
}

export async function revokeSession(db: Db, buyerId: string, sessionId: string): Promise<void> {
  await db
    .update(schema.buyerSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(schema.buyerSessions.id, sessionId), eq(schema.buyerSessions.buyerId, buyerId), isNull(schema.buyerSessions.revokedAt)));
}

/** ACC-3: "Keluar dari perangkat lain" — every OTHER live session of this account. */
export async function revokeOtherSessions(db: Db, buyerId: string, keepSessionId: string): Promise<number> {
  const rows = await db
    .update(schema.buyerSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(schema.buyerSessions.buyerId, buyerId), ne(schema.buyerSessions.id, keepSessionId), isNull(schema.buyerSessions.revokedAt)))
    .returning({ id: schema.buyerSessions.id });
  return rows.length;
}

/** "Keluarkan" on ONE other device. Mine only, never the session making the request (that is
 *  "Keluar dari akun"); a foreign, current, unknown or already-revoked id changes nothing ⇒ false. */
export async function revokeOneSession(db: Db, buyerId: string, currentSessionId: string, targetId: unknown): Promise<boolean> {
  if (typeof targetId !== "string" || !isUuid(targetId) || targetId === currentSessionId) return false;
  const rows = await db
    .update(schema.buyerSessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(schema.buyerSessions.id, targetId),
        eq(schema.buyerSessions.buyerId, buyerId),
        ne(schema.buyerSessions.id, currentSessionId),
        isNull(schema.buyerSessions.revokedAt),
      ),
    )
    .returning({ id: schema.buyerSessions.id });
  return rows.length === 1;
}

export const NAME_MAX = 80;
export type RenameResult = { ok: true; name: string } | { ok: false; error: string };

/** "Informasi pribadi": the display name only — whitespace collapsed, 1–80 characters. The email
 *  comes from Google and is not editable here. */
export async function renameAccount(db: Db, buyerId: string, raw: unknown): Promise<RenameResult> {
  const name = typeof raw === "string" ? raw.replace(/[\s\p{Cc}]+/gu, " ").trim() : "";
  if (!name) return { ok: false, error: "Nama wajib diisi." };
  if ([...name].length > NAME_MAX) return { ok: false, error: `Nama maksimal ${NAME_MAX} karakter.` };
  const rows = await db
    .update(schema.buyerAccounts)
    .set({ name })
    .where(eq(schema.buyerAccounts.id, buyerId))
    .returning({ id: schema.buyerAccounts.id });
  return rows.length ? { ok: true, name } : { ok: false, error: "Akun tidak ditemukan." };
}

export async function listSessions(db: Db, buyerId: string) {
  return db
    .select({
      id: schema.buyerSessions.id,
      createdAt: schema.buyerSessions.createdAt,
      lastSeenAt: schema.buyerSessions.lastSeenAt,
      userAgent: schema.buyerSessions.userAgent,
    })
    .from(schema.buyerSessions)
    .where(
      and(
        eq(schema.buyerSessions.buyerId, buyerId),
        isNull(schema.buyerSessions.revokedAt),
        sql`${schema.buyerSessions.createdAt} > now() - make_interval(secs => ${SESSION_MAX_AGE_SEC})`,
      ),
    )
    .orderBy(desc(schema.buyerSessions.lastSeenAt));
}

export type CloseResult = { ok: true } | { ok: false; reason: "not_active" };

/**
 * "Tutup akun" (UU PDP right to stop processing / delete; ADR 0016 "two-layer closure"). The platform
 * layer goes: credentials (the Google binding), every session (rows kept, device strings blanked), the
 * list of saved orders and every store link. The store layer is never touched: orders, customers,
 * payments and the ledger stay exactly as they were — closing an account must not corrupt a merchant's
 * books. The account row is locked first (`lockActiveAccount`), so a claim racing the closure either
 * commits before it (and is swept here) or waits, sees `closed`, and is refused.
 */
export async function closeAccount(db: Db, buyerId: string): Promise<CloseResult> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAccount(tx as unknown as Db, buyerId))) return { ok: false, reason: "not_active" } as const;
    // Every session row, not only the live ones: the device string (`user_agent`) is personal enough to blank.
    await tx
      .update(schema.buyerSessions)
      .set({ revokedAt: sql`coalesce(${schema.buyerSessions.revokedAt}, now())`, userAgent: null })
      .where(eq(schema.buyerSessions.buyerId, buyerId));
    await tx.delete(schema.buyerOrderClaims).where(eq(schema.buyerOrderClaims.buyerId, buyerId));
    await tx
      .update(schema.buyerStoreLinks)
      .set({ status: "revoked", revokedAt: sql`now()` })
      .where(and(eq(schema.buyerStoreLinks.buyerId, buyerId), eq(schema.buyerStoreLinks.status, "active")));
    // The real sub is freed so the same Google account starts a NEW account later; nothing reactivates
    // this one. `google_sub` is NOT NULL, so it becomes an inert marker (unique, no personal data).
    await tx
      .update(schema.buyerAccounts)
      .set({ status: "closed", googleSub: sql`'closed:' || ${schema.buyerAccounts.id}`, email: null, name: null })
      .where(eq(schema.buyerAccounts.id, buyerId));
    return { ok: true } as const;
  });
}
