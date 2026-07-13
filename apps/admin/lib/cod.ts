import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COD policy — the ONE place that answers "may this order be paid on delivery?".
//
// Three switches must all agree (see migration 0038 + lib/actions/shipping.ts):
//   1. platform_cod.enabled                     — the platform allows COD at all
//   2. platform_couriers.services[].codAllowed  — this SERVICE may carry it (super-admin), and
//      KiriminAja itself reports cod=true for it (services[].cod). The courier row must be enabled.
//   3. store_settings.cod_enabled               — this MERCHANT wants COD (0038, default false)
//
// Both public endpoints go through this: /api/public/ongkir labels the rates it returns with the
// EFFECTIVE flag (so the storefront can only ever show COD where it is real), and
// /api/public/order REJECTS a COD order that does not satisfy it — the UI is UX, this is the
// boundary. A shopper posting straight at the API cannot force COD on a store that turned it off.
// ─────────────────────────────────────────────────────────────────────────────

export type CodPolicy = {
  /** store_settings.cod_enabled */
  storeEnabled: boolean;
  /** platform_cod.enabled */
  platformEnabled: boolean;
  /** COD is possible for this store at all (both global switches on). Still per-service below. */
  enabled: boolean;
  /** …and this courier+service is COD-allowed at the platform level. */
  allows(courier?: string | null, serviceType?: string | null): boolean;
  /** why COD is unavailable (Bahasa Indonesia) — for the API's error body. */
  reason(courier?: string | null, serviceType?: string | null): string | null;
};

type StoredService = { type?: string; name?: string; group?: string; cod?: boolean; codAllowed?: boolean };

const key = (courier: string, type: string) => `${courier.trim().toLowerCase()}:${type.trim().toLowerCase()}`;

export async function getCodPolicy(storeId: string): Promise<CodPolicy> {
  const [[ss], [pc], couriers] = await Promise.all([
    db
      .select({ cod: schema.storeSettings.codEnabled })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1),
    db.select({ enabled: schema.platformCod.enabled }).from(schema.platformCod).limit(1),
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

  return {
    storeEnabled,
    platformEnabled,
    enabled,
    allows,
    reason(courier, serviceType) {
      if (!platformEnabled) return "COD sedang tidak tersedia.";
      if (!storeEnabled) return "Toko ini tidak menerima COD (bayar di tempat).";
      if (!courier || !serviceType) return "COD memerlukan layanan pengiriman yang mendukung COD.";
      if (!allowedServices.has(key(courier, serviceType))) {
        return "Layanan pengiriman yang dipilih tidak mendukung COD.";
      }
      return null;
    },
  };
}
