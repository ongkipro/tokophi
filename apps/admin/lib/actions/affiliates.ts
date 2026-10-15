"use server";
import { schema } from "@tokophi/db";
import { clampBps, normalizeAffiliateCode, suggestAffiliateCode } from "@tokophi/lib/affiliate";
import { affiliateLinkSecret, issueAffiliateLink } from "@tokophi/lib/affiliate-link";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import { normalizePhone } from "@tokophi/lib/validate";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { systemDomainFor } from "@/lib/data/domain";

// Seller panel → Affiliate writes (Task 9.4). Every action: capability first, tenant transaction,
// explicit `store_id` predicate, and a returned `{ ok, error }` (a thrown Error is masked in prod).
type Result = { ok: true } | { ok: false; error: string };
const PATH = "/affiliate";

export async function saveAffiliateSettings(input: { enabled: boolean; ratePct: number; holdDays: number }): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  const values = {
    affiliateEnabled: !!input.enabled,
    affiliateRateBps: clampBps(Number(input.ratePct) * 100),
    affiliateHoldDays: Math.max(0, Math.min(90, Math.round(Number(input.holdDays)) || 0)),
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
export async function setProductAffiliateRate(productId: string, ratePct: number | null): Promise<Result> {
  const { storeId } = await requireCapability("affiliates:write");
  const rows = await withTenant(storeId, (db) =>
    db
      .update(schema.products)
      .set({ affiliateRateBps: ratePct === null ? null : clampBps(Number(ratePct) * 100) })
      .where(and(eq(schema.products.id, productId), eq(schema.products.storeId, storeId)))
      .returning({ id: schema.products.id }),
  );
  if (!rows.length) return { ok: false, error: "Produk tidak ditemukan." };
  revalidatePath(PATH);
  return { ok: true };
}

/** F-A18: the affiliate's private dashboard link (interim until buyer-account sign-in, F-A15). Owner/
 *  admin/advertiser only — staff never mints one. Active affiliates only: the page re-checks `aktif`,
 *  so deactivating an affiliate kills every link already sent. */
export async function affiliateDashboardLink(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { storeId } = await requireCapability("affiliates:write");
  const secret = affiliateLinkSecret();
  if (!secret) return { ok: false, error: "Link dashboard affiliate belum diaktifkan di server." };
  const [row] = await withTenant(storeId, (db) =>
    db
      .select({ id: schema.affiliates.id, slug: schema.stores.slug })
      .from(schema.affiliates)
      .innerJoin(schema.stores, eq(schema.stores.id, schema.affiliates.storeId))
      .where(and(eq(schema.affiliates.id, id), eq(schema.affiliates.storeId, storeId), eq(schema.affiliates.status, "aktif")))
      .limit(1),
  );
  if (!row) return { ok: false, error: "Hanya affiliate aktif yang punya link dashboard." };
  return { ok: true, url: `https://${systemDomainFor(row.slug)}/affiliate/saya?t=${issueAffiliateLink(row.id, storeId, secret)}` };
}
