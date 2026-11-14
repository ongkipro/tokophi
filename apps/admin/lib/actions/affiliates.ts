"use server";
import { schema } from "@tokophi/db";
import { normalizeAffiliateCode, parseAffiliateHoldDays, parseAffiliateRatePct, suggestAffiliateCode } from "@tokophi/lib/affiliate";
import { INVITE_TTL_DAYS, newInvite } from "@tokophi/lib/affiliate-invite";
import { affiliateAppUrl } from "@/lib/affiliate-url";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import { emailError, nameError, normalizeEmail, normalizeName, normalizePhone } from "@tokophi/lib/validate";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/uuid";
import { requireCapability } from "@/lib/rbac";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import { getSession } from "@/lib/auth";
import { commissionCsv, parseExportRange } from "@/lib/affiliate-commission-csv";
import { commissionState } from "@/lib/commission-state";
import { STORE_TZ } from "@/lib/data/day-bucket";

// Seller panel → Affiliate writes (AFFILIATE-P2, ADR 0022). Every action: capability first, tenant
// transaction, explicit `store_id` predicate, and a returned `{ ok, error }` (a thrown Error is masked in
// prod). The merchant pays affiliates OUTSIDE TokoΦ: nothing here touches the ledger or a payout.
type Result = { ok: true } | { ok: false; error: string };
const PATH = "/affiliate";
// A server action is a public endpoint: its arguments are whatever the caller sends. A non-UUID reaching
// `eq(table.id, …)` makes Postgres throw 22P02 (masked to a 500 in production) instead of answering.
const NOT_FOUND = "Data tidak ditemukan.";

// Same ceilings the affiliate app's application form applies (apps/affiliate/src/pages/gabung.astro).
// REFUSED rather than clipped: a bank account cut short is an affiliate paid to the wrong place.
const LIMITS = { name: 80, email: 120, bankName: 60, bankAccount: 40, bankHolder: 80, note: 200 } as const;
const tooLong = (v: string | undefined, max: number) => (v?.trim().length ?? 0) > max;

/** Pengaturan → Affiliate card: is the programme on for the signed-in store? (Read; any role may look.) */
export async function getAffiliateProgramEnabled(): Promise<boolean> {
  if (!(await getSession())) return false;
  return withCurrentTenant(async (db, storeId) => {
    const [s] = await db
      .select({ enabled: schema.storeSettings.affiliateEnabled })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1);
    return s?.enabled ?? false;
  });
}

/**
 * Pengaturan → "Program affiliate": the seller turns the programme on or off for THIS store (ADR 0022 —
 * no Super Admin gate). Off = no code field at checkout, no new commission, `/affiliate` answers 404,
 * nobody can apply. Commissions already recorded are untouched either way.
 */
export async function setAffiliateProgramEnabled(enabled: boolean): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  const value = enabled === true;
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, affiliateEnabled: value })
      .onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { affiliateEnabled: value } }),
  );
  revalidatePath(PATH);
  revalidatePath("/pengaturan");
  return { ok: true };
}

export async function saveAffiliateSettings(input: {
  enabled: boolean;
  ratePct: string | number;
  holdDays: string | number;
}): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  // Refused, never guessed: an affiliate reads this rate as their pay, and the commission it produces is
  // frozen at order time — a silent 0% cannot be repaired by correcting the setting later.
  const rate = parseAffiliateRatePct(input.ratePct);
  if (!rate.ok) return { ok: false, error: rate.error };
  const hold = parseAffiliateHoldDays(input.holdDays);
  if (!hold.ok) return { ok: false, error: hold.error };
  const values = {
    affiliateEnabled: !!input.enabled,
    affiliateRateBps: rate.bps,
    affiliateHoldDays: hold.days,
  };
  await withTenant(storeId, (db) =>
    db.insert(schema.storeSettings).values({ storeId, ...values }).onConflictDoUpdate({ target: schema.storeSettings.storeId, set: values }),
  );
  revalidatePath(PATH);
  return { ok: true };
}

export async function setAffiliateStatus(id: string, status: "aktif" | "ditolak" | "nonaktif"): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  if (!["aktif", "ditolak", "nonaktif"].includes(status)) return { ok: false, error: "Status tidak dikenal." };
  if (!isUuid(id)) return { ok: false, error: "Affiliate tidak ditemukan." };
  const rows = await withTenant(storeId, (db) =>
    db
      .update(schema.affiliates)
      .set(status === "aktif" ? { status, approvedAt: sql`coalesce(${schema.affiliates.approvedAt}, now())` } : { status })
      .where(and(eq(schema.affiliates.id, id), eq(schema.affiliates.storeId, storeId)))
      .returning({ id: schema.affiliates.id }),
  );
  if (!rows.length) return { ok: false, error: "Affiliate tidak ditemukan." };
  revalidatePath(PATH);
  return { ok: true };
}

export async function createAffiliate(input: {
  name: string;
  phone: string;
  email?: string;
  code?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
}): Promise<Result & { code?: string }> {
  const { storeId } = await requireCapability("affiliates:write");
  const name = input.name?.trim();
  const phone = normalizePhone(input.phone);
  if (!name) return { ok: false, error: "Nama wajib diisi." };
  if (!phone) return { ok: false, error: "Nomor WhatsApp tidak valid." };
  for (const [k, max] of Object.entries(LIMITS)) {
    if (k !== "note" && tooLong(input[k as keyof typeof input] as string | undefined, max)) {
      return { ok: false, error: `Isian terlalu panjang (maks ${max} karakter).` };
    }
  }
  const wanted = input.code?.trim() ? normalizeAffiliateCode(input.code) : null;
  if (input.code?.trim() && !wanted) return { ok: false, error: "Kode hanya huruf/angka, 3–20 karakter." };
  // A merchant-chosen code is tried once (a clash is their decision to make); a generated one retries.
  for (let attempt = 0; attempt < (wanted ? 1 : 5); attempt++) {
    const code = wanted ?? suggestAffiliateCode(name);
    try {
      await withTenant(storeId, (db) =>
        db.insert(schema.affiliates).values({
          storeId,
          code,
          name,
          phone,
          email: input.email?.trim() || null,
          bankName: input.bankName?.trim() || null,
          bankAccount: input.bankAccount?.trim() || null,
          bankHolder: input.bankHolder?.trim() || null,
          status: "aktif",
          approvedAt: new Date(),
          note: "Ditambahkan oleh Seller",
        }),
      );
      revalidatePath(PATH);
      return { ok: true, code };
    } catch (e) {
      const constraint = uniqueViolationConstraint(e);
      if (constraint === null) throw e;
      // 0125: one affiliate row per WhatsApp number per store. Seller-facing, so it may say so plainly.
      if (constraint === "affiliates_store_id_phone_unique") {
        return { ok: false, error: "Nomor WhatsApp ini sudah terdaftar sebagai affiliate di toko ini." };
      }
      if (wanted) return { ok: false, error: `Kode ${wanted} sudah dipakai affiliate lain di toko ini.` };
    }
  }
  return { ok: false, error: "Gagal membuat kode unik, coba lagi." };
}

export type AffiliateDetailsInput = {
  name: string;
  phone: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  note?: string;
};

/**
 * The seller corrects an affiliate's details for THIS store (a new WhatsApp number, a new bank account).
 * Never touches `account_id`, the code, the status or any commission: a commission is frozen at order
 * time, and the code is what is printed on the affiliate's shared links. The same validators as the
 * affiliate's own sign-up (`@tokophi/lib/validate`); the phone is stored canonical `62…`.
 * Like every other action in this file there is no store-side audit row — the Seller panel has no
 * audit log for affiliates; an operator acting under impersonation is still logged by requireCapability.
 */
export async function updateAffiliate(id: string, input: AffiliateDetailsInput): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  if (!isUuid(id)) return { ok: false, error: "Affiliate tidak ditemukan." };
  const nameErr = nameError(input?.name);
  if (nameErr) return { ok: false, error: nameErr };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890." };
  const emailErr = emailError(input.email);
  if (emailErr) return { ok: false, error: emailErr };
  for (const [k, max] of Object.entries(LIMITS)) {
    if (k !== "name" && tooLong(input[k as keyof AffiliateDetailsInput], max)) {
      return { ok: false, error: `Isian terlalu panjang (maks ${max} karakter).` };
    }
  }
  const opt = (v: string | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
  try {
    const rows = await withTenant(storeId, (db) =>
      db
        .update(schema.affiliates)
        .set({
          name: normalizeName(input.name),
          phone,
          email: normalizeEmail(input.email),
          bankName: opt(input.bankName),
          bankAccount: opt(input.bankAccount),
          bankHolder: opt(input.bankHolder),
          note: opt(input.note),
        })
        .where(and(eq(schema.affiliates.id, id), eq(schema.affiliates.storeId, storeId)))
        .returning({ id: schema.affiliates.id }),
    );
    if (!rows.length) return { ok: false, error: "Affiliate tidak ditemukan." };
  } catch (e) {
    if (uniqueViolationConstraint(e) === "affiliates_store_id_phone_unique") {
      return { ok: false, error: "Nomor WhatsApp ini sudah dipakai affiliate lain di toko ini." };
    }
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** F-A8: only a READY commission (pending, hold window over) can be marked paid — one statement decides. */
export async function markCommissionPaid(id: string, note?: string): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND };
  if (tooLong(note, LIMITS.note)) return { ok: false, error: `Catatan terlalu panjang (maks ${LIMITS.note} karakter).` };
  const c = schema.affiliateCommissions;
  const rows = await withTenant(storeId, (db) =>
    db
      .update(c)
      .set({ status: "dibayar", paidAt: sql`now()`, paidNote: note?.trim() || null })
      .where(
        and(
          eq(c.id, id),
          eq(c.storeId, storeId),
          eq(c.status, "pending"),
          sql`${c.eligibleAt} is not null and ${c.eligibleAt} <= now()`,
        ),
      )
      .returning({ id: c.id }),
  );
  if (!rows.length) return { ok: false, error: "Komisi ini belum siap dibayar (pesanan belum selesai atau masih masa retur)." };
  revalidatePath(PATH);
  return { ok: true };
}

/** F-A9: per-product rate. `ratePct = null` removes the override (back to the store default). */
export async function setProductAffiliateRate(productId: string, ratePct: string | number | null): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  if (!isUuid(productId)) return { ok: false, error: "Produk tidak ditemukan." };
  let bps: number | null = null;
  if (ratePct !== null) {
    const parsed = parseAffiliateRatePct(ratePct);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    bps = parsed.bps;
  }
  const rows = await withTenant(storeId, (db) =>
    db
      .update(schema.products)
      .set({ affiliateRateBps: bps })
      .where(and(eq(schema.products.id, productId), eq(schema.products.storeId, storeId)))
      .returning({ id: schema.products.id }),
  );
  if (!rows.length) return { ok: false, error: "Produk tidak ditemukan." };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * F-A11: the store's commissions for a date range (by ORDER date, WIB, both ends inclusive) as a CSV — the
 * merchant's bookkeeping and tax record (OD-A4: withholding is the merchant's duty; the screen says so).
 * `affiliates:write` only: the file carries every affiliate's name and code and the seller's payment notes.
 * A READ, so a suspended store may still take its own records out (`allowSuspended`).
 * Every join repeats `store_id`; RLS (withTenant) is the net, the WHERE is the rule.
 */
export async function exportAffiliateCommissionsCsv(input: {
  from: string;
  to: string;
}): Promise<{ ok: true; csv: string; filename: string; rows: number } | { ok: false; error: string }> {
  const { storeId } = await requireCapability("affiliates:write", { allowSuspended: true });
  const range = parseExportRange(input?.from, input?.to);
  if (!range.ok) return range;
  const c = schema.affiliateCommissions;
  const o = schema.orders;
  const a = schema.affiliates;
  // The merchant's calendar: [from 00:00 WIB, to + 1 day 00:00 WIB) — compared on the raw column, so the
  // (store_id, placed_at) index serves it.
  const start = sql`timezone(${STORE_TZ}, ${range.from}::date::timestamp)`;
  const end = sql`timezone(${STORE_TZ}, (${range.to}::date + 1)::timestamp)`;
  const ready = sql<boolean>`${c.status} = 'pending' and ${c.eligibleAt} is not null and ${c.eligibleAt} <= now()`;
  const rows = await withTenant(storeId, (db) =>
    db
      .select({
        orderNumber: o.number,
        placedAt: o.placedAt,
        affiliateName: a.name,
        affiliateCode: a.code,
        source: c.source,
        baseIdr: c.baseIdr,
        rateNote: c.rateNote,
        commissionIdr: c.commissionIdr,
        status: c.status,
        isReady: ready,
        eligibleAt: c.eligibleAt,
        paidAt: c.paidAt,
        paidNote: c.paidNote,
      })
      .from(c)
      .innerJoin(o, and(eq(o.id, c.orderId), eq(o.storeId, storeId)))
      .innerJoin(a, and(eq(a.id, c.affiliateId), eq(a.storeId, storeId)))
      .where(and(eq(c.storeId, storeId), sql`${o.placedAt} >= ${start}`, sql`${o.placedAt} < ${end}`))
      .orderBy(o.placedAt, o.number),
  );
  const csv = commissionCsv(
    rows.map((r) => ({
      ...r,
      state: commissionState({ status: r.status, isReady: r.isReady, hasEligibleAt: !!r.eligibleAt }),
    })),
  );
  return { ok: true, csv, filename: `komisi-affiliate_${range.from}_${range.to}.csv`, rows: rows.length };
}

/**
 * F-A15 (as changed by ADR 0022): invite an ACTIVE, not-yet-linked affiliate to bind this store's row to
 * their affiliate account at affiliate.tokophi.com. The ONLY binding path for an existing row — never an
 * email/phone match. Owner/admin/advertiser only (staff never mints one). Single use and 7 days: only
 * the token's sha256 is stored, and minting again replaces the previous link (the old one stops working).
 */
export async function inviteAffiliateToAccount(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { storeId } = await requireCapability("affiliates:write");
  if (!isUuid(id)) return { ok: false, error: "Hanya affiliate aktif yang belum terhubung ke akun yang bisa diundang." };
  const base = affiliateAppUrl();
  if (!base) return { ok: false, error: "Area affiliate TokoΦ belum dibuka di server." };
  const inv = newInvite();
  const rows = await withTenant(storeId, (db) =>
    db
      .update(schema.affiliates)
      .set({ inviteHash: inv.hash, inviteExpiresAt: sql`now() + make_interval(days => ${INVITE_TTL_DAYS})` })
      .where(
        and(
          eq(schema.affiliates.id, id),
          eq(schema.affiliates.storeId, storeId),
          eq(schema.affiliates.status, "aktif"),
          isNull(schema.affiliates.accountId),
        ),
      )
      .returning({ id: schema.affiliates.id }),
  );
  if (!rows.length) return { ok: false, error: "Hanya affiliate aktif yang belum terhubung ke akun yang bisa diundang." };
  return { ok: true, url: `${base}/undangan?t=${inv.token}` };
}
