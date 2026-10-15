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
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "./account";

export type CommissionState = "belum_selesai" | "ditahan" | "siap" | "dibayar" | "batal";
export type Totals = { heldIdr: number; readyIdr: number; paidIdr: number };

const c = schema.affiliateCommissions;
const a = schema.affiliates;
const READY = sql`${c.status} = 'pending' and ${c.eligibleAt} is not null and ${c.eligibleAt} <= now()`;
const totalsCols = {
  heldIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'pending' and not (${READY})), 0)`.mapWith(Number),
  readyIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${READY}), 0)`.mapWith(Number),
  paidIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'dibayar'), 0)`.mapWith(Number),
};

/** Applications per account per hour (DB-counted, so it holds across replicas). */
export const JOIN_LIMIT_PER_HOUR = 5;

export type MyStore = {
  affiliateId: string;
  storeName: string;
  storeSlug: string;
  code: string;
  status: "menunggu" | "aktif" | "ditolak" | "nonaktif";
  orders: number;
} & Totals;

export async function myAffiliateStores(db: Db, accountId: string): Promise<MyStore[]> {
  return db
    .select({
      affiliateId: a.id,
      storeName: schema.stores.name,
      storeSlug: schema.stores.slug,
      code: a.code,
      status: a.status,
      orders: sql<number>`count(${c.id}) filter (where ${c.status} <> 'batal')`.mapWith(Number),
      ...totalsCols,
    })
    .from(a)
    .innerJoin(schema.stores, eq(schema.stores.id, a.storeId))
    .leftJoin(c, and(eq(c.affiliateId, a.id), eq(c.storeId, a.storeId)))
    .where(eq(a.accountId, accountId))
    .groupBy(a.id, schema.stores.id)
    .orderBy(schema.stores.name);
}

export type MyStoreDetail = MyStore & {
  commissions: {
    orderNumber: string;
    placedAt: Date;
    baseIdr: number;
    commissionIdr: number;
    rateNote: string | null;
    state: CommissionState;
    eligibleAt: Date | null;
    paidAt: Date | null;
  }[];
};

/** One of MY affiliate rows, or null — another account's id answers exactly like an unknown one. */
export async function myAffiliateDetail(db: Db, accountId: string, affiliateId: string): Promise<MyStoreDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(affiliateId)) return null;
  const [head] = (await myAffiliateStores(db, accountId)).filter((s) => s.affiliateId === affiliateId);
  if (!head) return null;
  const rows = await db
    .select({
      orderNumber: schema.orders.number,
      placedAt: schema.orders.placedAt,
      baseIdr: c.baseIdr,
      commissionIdr: c.commissionIdr,
      rateNote: c.rateNote,
      status: c.status,
      eligibleAt: c.eligibleAt,
      paidAt: c.paidAt,
      isReady: sql<boolean>`${READY}`,
    })
    .from(c)
    .innerJoin(a, and(eq(a.id, c.affiliateId), eq(a.storeId, c.storeId), eq(a.accountId, accountId)))
    .innerJoin(schema.orders, and(eq(schema.orders.id, c.orderId), eq(schema.orders.storeId, c.storeId)))
    .where(eq(c.affiliateId, affiliateId))
    .orderBy(desc(c.createdAt))
    .limit(200);
  return {
    ...head,
    commissions: rows.map((r) => ({
      orderNumber: r.orderNumber,
      placedAt: r.placedAt,
      baseIdr: r.baseIdr,
      commissionIdr: r.commissionIdr,
      rateNote: r.rateNote,
      eligibleAt: r.eligibleAt,
      paidAt: r.paidAt,
      state:
        r.status === "dibayar" ? "dibayar"
        : r.status === "batal" ? "batal"
        : r.isReady ? "siap"
        : r.eligibleAt ? "ditahan"
        : "belum_selesai",
    })),
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

/**
 * Apply to a store's programme as a signed-in account: one `menunggu` row bound to the account; the
 * merchant still approves it. A row in that store with the same phone but no account is NOT taken
 * over — that is someone's form application, and only the seller's invitation binds it (ACC-14).
 */
export async function joinProgramme(db: Db, accountId: string, slug: string, input: JoinInput): Promise<JoinResult> {
  const store = await joinableStore(db, slug);
  if (!store) return "closed";
  const [mine] = await db
    .select({ id: a.id })
    .from(a)
    .where(and(eq(a.storeId, store.id), eq(a.accountId, accountId)))
    .limit(1);
  if (mine) return "member";
  const [recent] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(a)
    .where(and(eq(a.accountId, accountId), gt(a.createdAt, sql`now() - interval '1 hour'`)));
  if ((recent?.n ?? 0) >= JOIN_LIMIT_PER_HOUR) return "rate_limited";
  const [samePhone] = await db
    .select({ id: a.id })
    .from(a)
    .where(and(eq(a.storeId, store.id), eq(a.phone, input.phone)))
    .limit(1);
  if (samePhone) return "phone_taken";
  // A clash on (store_id, code) just tries another generated code; a clash on (store_id, account_id)
  // (a concurrent double submit) returns nothing and is re-read as `member`.
  for (let i = 0; i < 5; i++) {
    const rows = await db
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
    const [raced] = await db.select({ id: a.id }).from(a).where(and(eq(a.storeId, store.id), eq(a.accountId, accountId))).limit(1);
    if (raced) return "member";
  }
  return "failed";
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
