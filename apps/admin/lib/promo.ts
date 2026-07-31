import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";

// THE ONE place a voucher is validated + priced (PROMO P0, spec: specs/PROMO_SPEC.md). The order API
// applies it at the boundary and the /api/public/promo preview shows it — both call THIS, so the shopper
// is charged exactly what they were shown.
//
// ⚠️ The `storeId` filter below is LOAD-BEARING, not belt-and-braces. Codes used to be unique across
// the whole platform, so scoping was a second lock on a door only one key fitted. Since 0084 they are
// unique PER STORE — two shops may both run `GAJIAN25` — so this filter is now the ONLY thing keeping
// one store from redeeming another's code. Do not "simplify" it away.
// Case-insensitive match (a shopper typing "hemat25" gets the merchant's "HEMAT25").
export type DiscountResult =
  | {
      ok: true;
      discount: { id: string; code: string; kind: "persen" | "nominal" | "gratis_ongkir"; value: number };
      priceOff: number; // Rp off the goods subtotal
      shipOff: number; // Rp off the shipping (gratis_ongkir)
    }
  | { ok: false; error: string };

export async function applyDiscount(opts: {
  storeId: string;
  code: string;
  subtotal: number;
  shippingCost: number;
}): Promise<DiscountResult> {
  const code = (opts.code ?? "").trim();
  if (!code) return { ok: false, error: "Masukkan kode voucher." };

  const [d] = await db
    .select({
      id: schema.discounts.id,
      code: schema.discounts.code,
      kind: schema.discounts.kind,
      value: schema.discounts.value,
      minPurchaseIdr: schema.discounts.minPurchaseIdr,
      usageLimit: schema.discounts.usageLimit,
      usedCount: schema.discounts.usedCount,
      startsAt: schema.discounts.startsAt,
      endsAt: schema.discounts.endsAt,
      status: schema.discounts.status,
    })
    .from(schema.discounts)
    .where(and(eq(schema.discounts.storeId, opts.storeId), sql`upper(${schema.discounts.code}) = upper(${code})`))
    .limit(1);

  if (!d) return { ok: false, error: "Kode voucher tidak ditemukan." };
  if (d.status === "nonaktif") return { ok: false, error: "Kode voucher tidak aktif." };
  const now = new Date();
  if (d.startsAt && now < d.startsAt) return { ok: false, error: "Voucher belum berlaku." };
  if (d.endsAt && now > d.endsAt) return { ok: false, error: "Voucher sudah kedaluwarsa." };
  if (d.usageLimit != null && d.usedCount >= d.usageLimit) return { ok: false, error: "Kuota voucher sudah habis." };
  if (opts.subtotal < d.minPurchaseIdr) {
    return { ok: false, error: `Minimum belanja Rp${d.minPurchaseIdr.toLocaleString("id-ID")} untuk voucher ini.` };
  }

  let priceOff = 0;
  let shipOff = 0;
  if (d.kind === "persen") priceOff = Math.min(opts.subtotal, Math.round((opts.subtotal * d.value) / 100));
  else if (d.kind === "nominal") priceOff = Math.min(opts.subtotal, d.value);
  else if (d.kind === "gratis_ongkir") shipOff = opts.shippingCost;

  return { ok: true, discount: { id: d.id, code: d.code, kind: d.kind, value: d.value }, priceOff, shipOff };
}
