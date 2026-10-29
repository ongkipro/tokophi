"use server";
import { schema } from "@tokophi/db";
import { normalizeAffiliateCode, parseAffiliateHoldDays, parseAffiliateRatePct, suggestAffiliateCode } from "@tokophi/lib/affiliate";
import { INVITE_TTL_DAYS, newInvite } from "@tokophi/lib/account-invite";
import { accountAppUrl } from "@/lib/account-url";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import { normalizePhone } from "@tokophi/lib/validate";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/uuid";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

// Seller panel → Affiliate writes (Task 9.4). Every action: capability first, tenant transaction,
// explicit `store_id` predicate, and a returned `{ ok, error }` (a thrown Error is masked in prod).
type Result = { ok: true } | { ok: false; error: string };
const PATH = "/affiliate";
// A server action is a public endpoint: its arguments are whatever the caller sends. A non-UUID reaching
// `eq(table.id, …)` makes Postgres throw 22P02 (masked to a 500 in production) instead of answering.
const NOT_FOUND = "Data tidak ditemukan.";

// Same ceilings the public storefront form already applies (apps/storefront/src/pages/affiliate.astro).
// REFUSED rather than clipped: a bank account cut short is an affiliate paid to the wrong place.
const LIMITS = { name: 80, email: 120, bankName: 60, bankAccount: 40, bankHolder: 80, note: 200 } as const;
const tooLong = (v: string | undefined, max: number) => (v?.trim().length ?? 0) > max;

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
      if (uniqueViolationConstraint(e) === null) throw e;
      if (wanted) return { ok: false, error: `Kode ${wanted} sudah dipakai affiliate lain di toko ini.` };
    }
  }
  return { ok: false, error: "Gagal membuat kode unik, coba lagi." };
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
 * F-A15 / ACC-14: invite an ACTIVE, not-yet-linked affiliate to bind this store's row to their TokoΦ
 * Account. The ONLY binding path for an existing row — never an email/phone match. Owner/admin/
 * advertiser only (staff never mints one). Single use and 7 days: only the token's sha256 is stored,
 * and minting again replaces the previous link (the old one stops working).
 */
export async function inviteAffiliateToAccount(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { storeId } = await requireCapability("affiliates:write");
  if (!isUuid(id)) return { ok: false, error: "Hanya affiliate aktif yang belum terhubung ke akun yang bisa diundang." };
  const base = accountAppUrl();
  if (!base) return { ok: false, error: "Akun TokoΦ belum diaktifkan di server." };
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
  return { ok: true, url: `${base}/affiliate/undangan?t=${inv.token}` };
}
