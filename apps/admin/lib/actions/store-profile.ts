"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { withCurrentTenant } from "@/lib/tenant";

// Store profile — the fields that actually have a column and reach the shopper's storefront:
// name, tagline (the storefront's meta description + footer line), whatsapp (the CS button).
//
// Pengaturan → Profil used to render these as hardcoded `defaultValue`s with no save wiring — a
// cosmetic form that looked editable and persisted nothing, and showed a placeholder WhatsApp number
// no shopper could reach. This makes them real.
//
// whatsapp/tagline are NULLABLE (migration 0049): a store that has not set a number renders NO
// WhatsApp button on its storefront (apps/storefront/src/data/store.ts) rather than a dead one. So
// clearing the field is a valid action, not an error — the button simply goes away.

export type StoreProfile = { name: string; tagline: string; whatsapp: string };

export async function getStoreProfile(): Promise<StoreProfile> {
  return withCurrentTenant(async (db) => {
    const [row] = await db
      .select({ name: schema.stores.name, tagline: schema.stores.tagline, whatsapp: schema.stores.whatsapp })
      .from(schema.stores)
      .limit(1);
    return { name: row?.name ?? "", tagline: row?.tagline ?? "", whatsapp: row?.whatsapp ?? "" };
  });
}

// Indonesian mobile numbers, stored digits-only, country code first (62…) — the shape the storefront's
// wa.me link and the CRM already assume. Accepts what a merchant naturally types (08…, +62…, spaces,
// dashes) and normalises it, so the input is forgiving but the stored value is canonical.
function normalizeWa(input: string): string | null {
  var d = (input || "").replace(/[^0-9]/g, "");
  if (!d) return null; // cleared → NULL → no button (intentional)
  if (d.slice(0, 2) === "62") { /* already country code */ }
  else if (d[0] === "0") d = "62" + d.slice(1);
  else if (d[0] === "8") d = "62" + d;
  // 62 + 9..13 digits is the real Indonesian range; reject anything obviously not a phone number.
  return /^62[0-9]{8,13}$/.test(d) ? d : "invalid";
}

type Result = { ok: true } | { ok: false; error: string };

export async function saveStoreProfile(input: { name: string; tagline: string; whatsapp: string }): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");

  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "Nama toko wajib diisi." };
  if (name.length > 80) return { ok: false, error: "Nama toko terlalu panjang (maks. 80 karakter)." };

  const tagline = (input.tagline || "").trim();
  if (tagline.length > 160) return { ok: false, error: "Deskripsi terlalu panjang (maks. 160 karakter)." };

  const wa = normalizeWa(input.whatsapp);
  if (wa === "invalid") return { ok: false, error: "Nomor WhatsApp tidak valid. Contoh: 0812xxxxxxxx." };

  return withTenant(storeId, async (db) => {
    await db
      .update(schema.stores)
      .set({ name, tagline: tagline || null, whatsapp: wa })
      .where(eq(schema.stores.id, storeId));
    revalidatePath("/pengaturan");
    return { ok: true };
  });
}
