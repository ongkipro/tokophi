// TokoΦ Account → Affiliate area (AFFILIATE_SPEC F-A15, account spec §17 phase 1, owner 2026-10-15:
// "akun affiliate itu buat seperti akun user -> jadi bisa affiliate banyak toko").
//
// One account, many stores: each store keeps its own `affiliates` row (the merchant approves per
// store, pays per store); `affiliates.account_id` links the rows to the account. Owner connection —
// so EVERY query here carries `account_id = <me>` (and `store_id` from the affiliate row itself on
// every child read). An account never sees another account's rows, and no buyer data is selected.
import * as schema from "@tokophi/db/schema";
import { hashInvite } from "@tokophi/lib/account-invite";
import { suggestAffiliateCode } from "@tokophi/lib/affiliate";
import { BUMP_SQL } from "@tokophi/lib/rate-limit-store";
import { isUuid } from "@tokophi/lib/uuid";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "./account";

export type CommissionState = "belum_selesai" | "ditahan" | "siap" | "dibayar" | "batal";
export const COMMISSION_STATES: readonly CommissionState[] = ["belum_selesai", "ditahan", "siap", "dibayar", "batal"];
export type Totals = { heldIdr: number; readyIdr: number; paidIdr: number };

const c = schema.affiliateCommissions;
const a = schema.affiliates;
const READY = sql`${c.status} = 'pending' and ${c.eligibleAt} is not null and ${c.eligibleAt} <= now()`;
// The ONE derivation of a commission's state for the affiliate (summary tiles, ledger, filter): the
// stored status says paid/cancelled; "ready" is derived from the hold date, so no cron is needed.
const STATE = sql<CommissionState>`case when ${c.status} = 'dibayar' then 'dibayar' when ${c.status} = 'batal' then 'batal'
  when ${READY} then 'siap' when ${c.eligibleAt} is not null then 'ditahan' else 'belum_selesai' end`;
const totalsCols = {
  heldIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'pending' and not (${READY})), 0)`.mapWith(Number),
  readyIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${READY}), 0)`.mapWith(Number),
  paidIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'dibayar'), 0)`.mapWith(Number),
};

/** Join ATTEMPTS per account per hour (shared DB counter, so it holds across replicas). */
export const JOIN_LIMIT_PER_HOUR = 5;

export type MyStore = {
  affiliateId: string;
  storeName: string;
  storeSlug: string;
  code: string;
  status: "menunggu" | "aktif" | "ditolak" | "nonaktif";
  orders: number;
  /** The store's own return window after delivery (`store_settings.affiliate_hold_days`, H+3 default). */
  holdDays: number;
  /** The store's default rate in basis points (`store_settings.affiliate_rate_bps`); products may differ. Null = no settings row. */
  rateBps: number | null;
} & Totals;

/** My programmes; `only` narrows it to one of MY affiliate ids in SQL (the account predicate stays). */
export async function myAffiliateStores(db: Db, accountId: string, only?: string): Promise<MyStore[]> {
  return db
    .select({
      affiliateId: a.id,
      storeName: schema.stores.name,
      storeSlug: schema.stores.slug,
      code: a.code,
      status: a.status,
      orders: sql<number>`count(${c.id}) filter (where ${c.status} <> 'batal')`.mapWith(Number),
      holdDays: sql<number>`coalesce(${schema.storeSettings.affiliateHoldDays}, 3)`.mapWith(Number),
      rateBps: schema.storeSettings.affiliateRateBps,
      ...totalsCols,
    })
    .from(a)
    .innerJoin(schema.stores, eq(schema.stores.id, a.storeId))
    .leftJoin(schema.storeSettings, eq(schema.storeSettings.storeId, a.storeId))
    .leftJoin(c, and(eq(c.affiliateId, a.id), eq(c.storeId, a.storeId)))
    .where(and(eq(a.accountId, accountId), only ? eq(a.id, only) : undefined))
    .groupBy(a.id, schema.stores.id, schema.storeSettings.storeId)
    .orderBy(schema.stores.name);
}

export type Commission = {
  affiliateId: string;
  storeName: string;
  orderNumber: string;
  placedAt: Date;
  baseIdr: number;
  commissionIdr: number;
  rateNote: string | null;
  state: CommissionState;
  eligibleAt: Date | null;
  paidAt: Date | null;
};
export type Ledger = { rows: Commission[]; count: number; baseIdr: number; commissionIdr: number };

/** Rows shown per ledger page; the count and totals always cover the whole filtered set. */
export const LEDGER_LIMIT = 200;

/**
 * One commission ledger across every programme of MY account (spec §18.4 F), newest order first.
 * `store` is one of my affiliate ids; another account's id simply matches nothing. The single
 * `account_id = me` predicate below is the boundary — this runs on the owner connection.
 */
export async function myCommissions(
  db: Db,
  accountId: string,
  opts: { store?: string | null; state?: CommissionState | null } = {},
): Promise<Ledger> {
  if (opts.store && !isUuid(opts.store)) return { rows: [], count: 0, baseIdr: 0, commissionIdr: 0 };
  const where = and(
    eq(a.accountId, accountId),
    opts.store ? eq(c.affiliateId, opts.store) : undefined,
    opts.state ? sql`(${STATE}) = ${opts.state}` : undefined,
  );
  const base = () =>
    db
      .select({
        affiliateId: c.affiliateId,
        storeName: schema.stores.name,
        orderNumber: schema.orders.number,
        placedAt: schema.orders.placedAt,
        baseIdr: c.baseIdr,
        commissionIdr: c.commissionIdr,
        rateNote: c.rateNote,
        state: STATE,
        eligibleAt: c.eligibleAt,
        paidAt: c.paidAt,
      })
      .from(c)
      .innerJoin(a, and(eq(a.id, c.affiliateId), eq(a.storeId, c.storeId)))
      .innerJoin(schema.stores, eq(schema.stores.id, c.storeId))
      .innerJoin(schema.orders, and(eq(schema.orders.id, c.orderId), eq(schema.orders.storeId, c.storeId)))
      .where(where);
  const [rows, [sum]] = await Promise.all([
    base().orderBy(desc(schema.orders.placedAt), desc(c.id)).limit(LEDGER_LIMIT),
    db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        baseIdr: sql<number>`coalesce(sum(${c.baseIdr}), 0)`.mapWith(Number),
        commissionIdr: sql<number>`coalesce(sum(${c.commissionIdr}), 0)`.mapWith(Number),
      })
      .from(c)
      .innerJoin(a, and(eq(a.id, c.affiliateId), eq(a.storeId, c.storeId)))
      .where(where),
  ]);
  return { rows, count: sum?.count ?? 0, baseIdr: sum?.baseIdr ?? 0, commissionIdr: sum?.commissionIdr ?? 0 };
}

/** `•••• 7801` — the payout account is shown, never handed out: only the last 4 digits leave the DB layer. */
export function maskAccount(n: string | null): string | null {
  const d = (n ?? "").replace(/\D/g, "");
  // A number of 4 digits or fewer would be shown whole by its "last 4": mask it entirely instead.
  return !d.length ? null : d.length <= 4 ? "••••" : `•••• ${d.slice(-4)}`;
}
/** `Rina Wulandari` → `R*** W***`: enough to recognise, not enough to copy. */
export function maskHolder(n: string | null): string | null {
  const w = (n ?? "").trim().split(/\s+/).filter(Boolean);
  return w.length ? w.map((x) => `${x[0]!.toUpperCase()}***`).join(" ") : null;
}

export type MyStoreDetail = MyStore & {
  commissions: Commission[];
  /** All of this programme's commission rows (`commissions` stops at LEDGER_LIMIT). */
  commissionCount: number;
  /** Masked, read-only: a payout account the affiliate could edit is a fraud path (spec §18.4 F). */
  payout: { bankName: string | null; account: string | null; holder: string | null };
  /** The store's WhatsApp (digits, `62…`) for payment questions, or null. */
  storeWhatsapp: string | null;
};

/** One of MY affiliate rows, or null — another account's id answers exactly like an unknown one. */
export async function myAffiliateDetail(db: Db, accountId: string, affiliateId: string): Promise<MyStoreDetail | null> {
  if (!isUuid(affiliateId)) return null;
  const [head] = await myAffiliateStores(db, accountId, affiliateId);
  if (!head) return null;
  const [[extra], ledger] = await Promise.all([
    db
      .select({ bankName: a.bankName, bankAccount: a.bankAccount, bankHolder: a.bankHolder, whatsapp: schema.stores.whatsapp })
      .from(a)
      .innerJoin(schema.stores, eq(schema.stores.id, a.storeId))
      .where(and(eq(a.id, affiliateId), eq(a.accountId, accountId)))
      .limit(1),
    myCommissions(db, accountId, { store: affiliateId }),
  ]);
  return {
    ...head,
    commissions: ledger.rows,
    commissionCount: ledger.count,
    payout: { bankName: extra?.bankName ?? null, account: maskAccount(extra?.bankAccount ?? null), holder: maskHolder(extra?.bankHolder ?? null) },
    storeWhatsapp: extra?.whatsapp || null,
  };
}

/** A store whose programme an account may apply to: known, not locked, programme switched on. */
export async function joinableStore(db: Db, slug: string): Promise<{ id: string; name: string; slug: string } | null> {
  if (!/^[a-z0-9-]{1,63}$/.test(slug)) return null;
  const [s] = await db
    .select({ id: schema.stores.id, name: schema.stores.name, slug: schema.stores.slug })
    .from(schema.stores)
    .innerJoin(schema.storeSettings, eq(schema.storeSettings.storeId, schema.stores.id))
    .where(and(eq(schema.stores.slug, slug), isNull(schema.stores.suspendedAt), eq(schema.storeSettings.affiliateEnabled, true)))
    .limit(1);
  return s ?? null;
}

export type JoinInput = {
  name: string;
  /** Canonical `62…` (normalizePhone) — validated by the caller. */
  phone: string;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  note: string | null;
};
export type JoinResult = "created" | "member" | "phone_taken" | "closed" | "rate_limited" | "failed";

/** One window of the shared limiter (`rate_limit_counters`), counted per account. */
const JOIN_WINDOW_MS = 60 * 60 * 1000;

/**
 * Count one join ATTEMPT for this account and return the count in the current window. It runs the
 * shared limiter's own statement (`BUMP_SQL`, one atomic upsert) through the caller's connection, so
 * tests stay inside their rolled-back transaction and production uses the same owner pool.
 */
async function bumpJoinAttempts(db: Db, accountId: string): Promise<number> {
  const params = [`acc-join:${accountId}`, Date.now(), JOIN_WINDOW_MS];
  const parts = BUMP_SQL.split(/\$(\d)/);
  const stmt = sql.join(
    parts.map((p, i) => (i % 2 ? sql`${params[Number(p) - 1]}` : sql.raw(p))),
    sql.raw(""),
  );
  const [row] = (await db.execute(stmt)) as unknown as { count: number }[];
  return Number(row?.count ?? Infinity);
}

/**
 * Apply to a store's programme as a signed-in account: one `menunggu` row bound to the account; the
 * merchant still approves it. A row in that store with the same phone but no account is NOT taken
 * over — that is someone's form application, and only the seller's invitation binds it (ACC-14).
 *
 * `phone_taken` answers "is this number an affiliate of store X", so every ATTEMPT is counted before
 * the phone is looked at (not only the rows that got created) — 5 guesses an hour, then nothing.
 * The rest runs under a lock on this account's own row, so two tabs cannot interleave past the checks.
 */
export async function joinProgramme(db: Db, accountId: string, slug: string, input: JoinInput): Promise<JoinResult> {
  const store = await joinableStore(db, slug);
  if (!store) return "closed";
  let attempts: number;
  try {
    attempts = await bumpJoinAttempts(db, accountId);
  } catch (err) {
    // Fail closed: no counter, no phone lookup. Joining can wait; an open oracle cannot.
    console.error("[affiliate] join limiter unavailable:", err);
    return "failed";
  }
  if (attempts > JOIN_LIMIT_PER_HOUR) return "rate_limited";
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from buyer_accounts where id = ${accountId} for update`);
    const [mine] = await tx
      .select({ id: a.id })
      .from(a)
      .where(and(eq(a.storeId, store.id), eq(a.accountId, accountId)))
      .limit(1);
    if (mine) return "member";
    const [samePhone] = await tx
      .select({ id: a.id })
      .from(a)
      .where(and(eq(a.storeId, store.id), eq(a.phone, input.phone)))
      .limit(1);
    if (samePhone) return "phone_taken";
    // A clash on (store_id, code) just tries another generated code; a clash on (store_id, account_id)
    // returns nothing and is re-read as `member`.
    for (let i = 0; i < 5; i++) {
      const rows = await tx
        .insert(a)
        .values({
          storeId: store.id,
          accountId,
          code: suggestAffiliateCode(input.name),
          name: input.name,
          phone: input.phone,
          bankName: input.bankName,
          bankAccount: input.bankAccount,
          bankHolder: input.bankHolder,
          note: input.note,
        })
        .onConflictDoNothing()
        .returning({ id: a.id });
      if (rows.length) return "created";
      const [raced] = await tx.select({ id: a.id }).from(a).where(and(eq(a.storeId, store.id), eq(a.accountId, accountId))).limit(1);
      if (raced) return "member";
    }
    return "failed";
  });
}

export type InvitePreview = { storeName: string; affiliateName: string; code: string };

/** What a live invitation would bind — for the confirmation screen. null = invalid/used/expired. */
export async function previewInvite(db: Db, token: unknown): Promise<InvitePreview | null> {
  const hash = hashInvite(token);
  if (!hash) return null;
  const [row] = await db
    .select({ storeName: schema.stores.name, affiliateName: a.name, code: a.code })
    .from(a)
    .innerJoin(schema.stores, eq(schema.stores.id, a.storeId))
    .where(and(eq(a.inviteHash, hash), isNull(a.accountId), gt(a.inviteExpiresAt, sql`now()`), eq(a.status, "aktif")))
    .limit(1);
  return row ?? null;
}

export type AcceptResult = { ok: true; affiliateId: string } | { ok: false; reason: "invalid" | "member" };

/**
 * Accept a seller's invitation: ONE conditional UPDATE decides and writes, so the same link cannot
 * bind twice (the hash is cleared in the same statement) and two accounts racing for it cannot both
 * win. An account that already has a row in that store is refused rather than given a second one.
 */
export async function acceptInvite(db: Db, accountId: string, token: unknown): Promise<AcceptResult> {
  const hash = hashInvite(token);
  if (!hash) return { ok: false, reason: "invalid" };
  const rows = await db
    .update(a)
    .set({ accountId, inviteHash: null, inviteExpiresAt: null })
    .where(
      and(
        eq(a.inviteHash, hash),
        isNull(a.accountId),
        gt(a.inviteExpiresAt, sql`now()`),
        eq(a.status, "aktif"),
        sql`not exists (select 1 from affiliates x where x.store_id = ${a.storeId} and x.account_id = ${accountId})`,
      ),
    )
    .returning({ id: a.id });
  if (rows.length) return { ok: true, affiliateId: rows[0].id };
  // Nothing written. Only to word the message: is it because this account is already in that store?
  const [owned] = await db
    .select({ id: sql<string>`x.id` })
    .from(sql`affiliates i join affiliates x on x.store_id = i.store_id and x.account_id = ${accountId}`)
    .where(sql`i.invite_hash = ${hash}`)
    .limit(1);
  return { ok: false, reason: owned ? "member" : "invalid" };
}
