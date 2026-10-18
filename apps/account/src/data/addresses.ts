// TokoΦ Account → saved addresses (ACC-7, Task 10.8). Up to 10 per account, at most one primary
// (partial unique index in 0118). These rows belong to the account only: an order keeps its own
// `ship_*` snapshot, so nothing here ever writes a store-owned row. Owner connection — every
// statement carries `buyer_id = <me>`.
import * as schema from "@tokophi/db/schema";
import { areaById, type Area } from "@tokophi/lib/area-search";
import { isUuid } from "@tokophi/lib/uuid";
import {
  addressError,
  nameError,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  normalizePostcode,
  phoneError,
  postcodeError,
} from "@tokophi/lib/validate";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "./account";

export const MAX_ADDRESSES = 10;
const ad = schema.buyerAddresses;

export type SavedAddress = {
  id: string;
  label: string | null;
  recipient: string;
  phone: string;
  address: string;
  kelurahan: string | null;
  postalCode: string;
  isPrimary: boolean;
  area: Area | null;
};

export type AddressInput = { label?: unknown; recipient: unknown; phone: unknown; address: unknown; districtId: unknown; kelurahan?: unknown; postalCode: unknown };
export type AddressErrors = Partial<Record<"label" | "recipient" | "phone" | "address" | "districtId" | "postalCode" | "kelurahan" | "form", string>>;
export type SaveResult = { ok: true; id: string } | { ok: false; errors: AddressErrors };

export async function myAddresses(db: Db, buyerId: string): Promise<SavedAddress[]> {
  const rows = await db
    .select()
    .from(ad)
    .where(eq(ad.buyerId, buyerId))
    .orderBy(desc(ad.isPrimary), desc(ad.updatedAt), desc(ad.id));
  return Promise.all(rows.map(async (r) => view(r, await areaById(db, r.districtId))));
}

export async function myAddress(db: Db, buyerId: string, id: unknown): Promise<SavedAddress | null> {
  if (!isId(id)) return null;
  const [r] = await db.select().from(ad).where(and(eq(ad.id, id), eq(ad.buyerId, buyerId))).limit(1);
  return r ? view(r, await areaById(db, r.districtId)) : null;
}

/** Create (`id` absent) or update one of MY addresses. Validation is the checkout's own rules. */
export async function saveAddress(db: Db, buyerId: string, input: AddressInput, id?: unknown): Promise<SaveResult> {
  const errors: AddressErrors = {};
  const label = typeof input.label === "string" ? input.label.replace(/\s+/g, " ").trim().slice(0, 30) : "";
  const recipientErr = nameError(input.recipient);
  if (recipientErr) errors.recipient = recipientErr;
  const phoneErr = phoneError(input.phone);
  if (phoneErr) errors.phone = phoneErr;
  const addressErr = addressError(input.address);
  if (addressErr) errors.address = addressErr;
  const postcode = normalizePostcode(input.postalCode);
  const postErr = postcodeError(postcode);
  if (postErr) errors.postalCode = postErr;
  const kelurahan = typeof input.kelurahan === "string" ? input.kelurahan.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const districtId = Number(input.districtId);
  const area = await areaById(db, districtId);
  if (!area) errors.districtId = "Pilih kecamatan dari daftar.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const values = {
    label: label || null,
    recipient: normalizeName(input.recipient),
    phone: normalizePhone(input.phone)!,
    address: normalizeAddress(input.address),
    districtId,
    kelurahan: kelurahan || null,
    postalCode: postcode,
  };
  return db.transaction(async (tx) => {
    // Serialise this account's address writes on its own row, so two tabs cannot both pass the cap.
    await tx.execute(sql`select 1 from buyer_accounts where id = ${buyerId} for update`);
    if (id !== undefined) {
      if (!isId(id)) return { ok: false, errors: { form: "Alamat tidak ditemukan." } } as const;
      const [row] = await tx
        .update(ad)
        .set({ ...values, updatedAt: sql`now()` })
        .where(and(eq(ad.id, id), eq(ad.buyerId, buyerId)))
        .returning({ id: ad.id });
      return row ? ({ ok: true, id: row.id } as const) : ({ ok: false, errors: { form: "Alamat tidak ditemukan." } } as const);
    }
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from buyer_addresses where buyer_id = ${buyerId}`)) as unknown as { n: number }[];
    if (n >= MAX_ADDRESSES) return { ok: false, errors: { form: `Maksimal ${MAX_ADDRESSES} alamat. Hapus salah satu dulu.` } } as const;
    const [row] = await tx
      .insert(ad)
      .values({ ...values, buyerId, isPrimary: n === 0 })
      .returning({ id: ad.id });
    return { ok: true, id: row.id } as const;
  });
}

/** Make one of MY addresses the primary — the old one is cleared first, in the same transaction. */
export async function setPrimaryAddress(db: Db, buyerId: string, id: unknown): Promise<boolean> {
  if (!isId(id)) return false;
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: ad.id }).from(ad).where(and(eq(ad.id, id), eq(ad.buyerId, buyerId))).for("update");
    if (!target) return false;
    await tx.update(ad).set({ isPrimary: false }).where(and(eq(ad.buyerId, buyerId), ne(ad.id, id), eq(ad.isPrimary, true)));
    await tx.update(ad).set({ isPrimary: true }).where(and(eq(ad.id, id), eq(ad.buyerId, buyerId)));
    return true;
  });
}

/** Delete one of MY addresses; if it was the primary, the most recently updated other one takes over —
 *  the same order `myAddresses` lists them in (ties broken by id in both), so the list's second row
 *  is exactly the one the confirm dialog can name as the next primary. */
export async function deleteAddress(db: Db, buyerId: string, id: unknown): Promise<boolean> {
  if (!isId(id)) return false;
  return db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(ad)
      .where(and(eq(ad.id, id), eq(ad.buyerId, buyerId)))
      .returning({ wasPrimary: ad.isPrimary });
    if (!gone) return false;
    if (gone.wasPrimary) {
      await tx.execute(sql`
        update buyer_addresses set is_primary = true
         where id = (select id from buyer_addresses where buyer_id = ${buyerId} order by updated_at desc, id desc limit 1)`);
    }
    return true;
  });
}

const isId = (v: unknown): v is string => typeof v === "string" && isUuid(v);

function view(r: typeof ad.$inferSelect, area: Area | null): SavedAddress {
  return { id: r.id, label: r.label, recipient: r.recipient, phone: r.phone, address: r.address, kelurahan: r.kelurahan, postalCode: r.postalCode, isPrimary: r.isPrimary, area };
}

/** What people type ("Kota Yogyakarta", "Kab. Bantul") → what `kiriminaja_areas.city_name` holds
 *  ("Yogyakarta", "Bantul"): the Kota/Kabupaten prefix lives in its own column. */
export function areaTerm(q: string): string {
  return q.replace(/\s+/g, " ").trim().replace(/^(kota|kabupaten|kab\.?|kec\.?|kecamatan)\s+/i, "").slice(0, 60);
}
