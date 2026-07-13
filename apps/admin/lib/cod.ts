import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COD policy — the ONE place that answers "may this order be paid on delivery?".
//
// FIVE switches must all agree (migration 0038 + lib/actions/shipping.ts):
//   1. platform_cod.enabled                     — the platform allows COD at all
//   2. store_settings.cod_enabled               — this MERCHANT wants COD (0038, default false)
//   3. platform_cod.max_amount_idr              — the order total may not exceed the cap (0 = no cap)
//   4. platform_cod.allowed_provinces           — the buyer's province must be listed (empty = anywhere)
//   5. platform_couriers.services[].codAllowed  — this SERVICE may carry it (super-admin), and
//      KiriminAja itself reports cod=true for it (services[].cod). The courier row must be enabled.
//
// 3+4 are the platform's RISK limits — the whole point of COD being a money decision: an unpaid
// Rp8jt parcel refused at the door in a province we have no return leg for is the loss this table
// exists to bound. They were stored but never read, so they bounded nothing.
//
// Both public endpoints go through this: /api/public/ongkir labels the rates it returns with the
// EFFECTIVE per-service flag (so the storefront can only ever show COD where the courier can carry
// it), and /api/public/order REJECTS a COD order that fails ANY of the five — the UI is UX, this is
// the boundary. A script posting channelCode:"cod" cannot force COD past the cap, outside the
// allowed provinces, or on a store that turned it off.
// ─────────────────────────────────────────────────────────────────────────────

/** What the shopper actually asked for, checked against the policy. */
export type CodRequest = {
  courier?: string | null;
  serviceType?: string | null;
  /** order total in IDR (subtotal + ongkir) — what the driver would collect */
  total?: number | null;
  /** buyer's province, as typed at checkout (free text — normalised below) */
  province?: string | null;
};

export type CodPolicy = {
  /** store_settings.cod_enabled */
  storeEnabled: boolean;
  /** platform_cod.enabled */
  platformEnabled: boolean;
  /** COD is possible for this store at all (both global switches on). Still per-request below. */
  enabled: boolean;
  /** platform_cod.max_amount_idr (0 = no cap) */
  maxAmountIdr: number;
  /** platform_cod.allowed_provinces, normalised ([] = every province) */
  allowedProvinces: string[];
  /** …and this courier+service is COD-allowed at the platform level. */
  allows(courier?: string | null, serviceType?: string | null): boolean;
  /** why COD is unavailable for THIS request (Bahasa Indonesia) — null = allowed. */
  reason(req: CodRequest): string | null;
};

type StoredService = { type?: string; name?: string; group?: string; cod?: boolean; codAllowed?: boolean };

const key = (courier: string, type: string) => `${courier.trim().toLowerCase()}:${type.trim().toLowerCase()}`;

// Province matching is by NORMALISED name, because the buyer TYPES their province into a free-text
// field (the datalist is a suggestion, not a constraint): "DI Yogyakarta", "Daerah Istimewa
// Yogyakarta", "prov. jawa barat" must all match the stored list. We strip honorifics/prefixes and
// all non-alphanumerics. This is a best-effort string match, NOT a verified geography:
// a determined client can type "Jawa Barat" and ship to Papua. Bounding that needs the destination
// the ongkir quote was actually issued for (KiriminAja district id → province), which the order API
// does not currently receive — see the note at the call site in app/api/public/order/route.ts.
export const normProvince = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\b(provinsi|prov\.?|daerah istimewa|daerah khusus ibukota|d\.?k\.?i\.?|d\.?i\.?y?\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");

export async function getCodPolicy(storeId: string): Promise<CodPolicy> {
  const [[ss], [pc], couriers] = await Promise.all([
    db
      .select({ cod: schema.storeSettings.codEnabled })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1),
    db
      .select({
        enabled: schema.platformCod.enabled,
        maxAmountIdr: schema.platformCod.maxAmountIdr,
        allowedProvinces: schema.platformCod.allowedProvinces,
      })
      .from(schema.platformCod)
      .limit(1),
    db
      .select({
        courier: schema.platformCouriers.courier,
        services: schema.platformCouriers.services,
        enabled: schema.platformCouriers.enabled,
      })
      .from(schema.platformCouriers),
  ]);

  const storeEnabled = !!ss?.cod;
  const platformEnabled = !!pc?.enabled;
  const enabled = storeEnabled && platformEnabled;
  const maxAmountIdr = Number(pc?.maxAmountIdr ?? 0);
  const provinceList = Array.isArray(pc?.allowedProvinces) ? (pc.allowedProvinces as unknown[]) : [];
  const allowedProvinces = provinceList.filter((p): p is string => typeof p === "string" && !!p.trim());
  const allowedProvinceKeys = new Set(allowedProvinces.map(normProvince));

  // courier:service → COD permitted by the platform (and supported by KiriminAja)
  const allowedServices = new Set<string>();
  for (const row of couriers) {
    if (!row.enabled) continue;
    const list = (row.services as StoredService[] | null) ?? [];
    for (const s of list) {
      // legacy rows stored plain strings ("REG") — no cod info, so no COD
      if (typeof s !== "object" || !s?.type) continue;
      if (s.cod && s.codAllowed !== false) allowedServices.add(key(row.courier, s.type));
    }
  }

  const allows = (courier?: string | null, serviceType?: string | null) =>
    enabled && !!courier && !!serviceType && allowedServices.has(key(courier, serviceType));

  const idr = (n: number) => "Rp" + n.toLocaleString("id-ID");

  return {
    storeEnabled,
    platformEnabled,
    enabled,
    maxAmountIdr,
    allowedProvinces,
    allows,
    reason({ courier, serviceType, total, province }: CodRequest) {
      if (!platformEnabled) return "COD sedang tidak tersedia.";
      if (!storeEnabled) return "Toko ini tidak menerima COD (bayar di tempat).";

      // 3 — the cap. A missing/negative total cannot be checked against a cap → reject, don't assume.
      if (maxAmountIdr > 0) {
        if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
          return "Total pesanan tidak dapat diverifikasi untuk COD.";
        }
        if (total > maxAmountIdr) {
          return `COD hanya untuk pesanan sampai ${idr(maxAmountIdr)}. Silakan pilih metode pembayaran lain.`;
        }
      }

      // 4 — the province allow-list (empty list = COD anywhere).
      if (allowedProvinceKeys.size > 0) {
        const p = province ? normProvince(province) : "";
        if (!p) return "Isi provinsi tujuan terlebih dahulu untuk memakai COD.";
        if (!allowedProvinceKeys.has(p)) return "COD belum tersedia untuk provinsi tujuanmu.";
      }

      // 5 — the service actually picked.
      if (!courier || !serviceType) return "COD memerlukan layanan pengiriman yang mendukung COD.";
      if (!allowedServices.has(key(courier, serviceType))) {
        return "Layanan pengiriman yang dipilih tidak mendukung COD.";
      }
      return null;
    },
  };
}
