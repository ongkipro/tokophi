// Does THIS store's checkout actually quote through Mengantar right now — and if not, why?
//
// A "Terhubung" badge alone misled: quotes go to Mengantar only when every link below holds, and any
// broken link falls back to the default provider silently (owner O6 — correct for the shopper, invisible
// to the seller). This mirrors the order of the checks in `quoteShipping` / `quoteMengantar`, so the
// sentence names the FIRST thing stopping it. Pure, so it is tested without a database.
// Seller copy may say "Mengantar" (owner O5); the default provider is never named (ADR 0004).

export type MengantarReadinessInput = {
  /** `getProviderConfig().shipping === "mengantar"`. */
  switchOn: boolean;
  /** `MENGANTAR_ENV` explicitly named in this process (`envSource === "env"`). */
  envNamed: boolean;
  /** `store_mengantar_accounts.state` for the active env (`none` when there is no row). */
  state: string;
  /** `store_settings.sender_mengantar_area_id` is set. */
  hasPickupArea: boolean;
  /** `store_settings.sender_kecamatan_id` is set (the pickup address was saved at all). */
  hasPickupAddress: boolean;
};

export type MengantarReadiness =
  | { active: true; reason: null; fix: null }
  | { active: false; reason: string; fix: "alamat" | "akun" | null };

export function mengantarReadiness(i: MengantarReadinessInput): MengantarReadiness {
  if (!i.switchOn || !i.envNamed) {
    return { active: false, reason: "TokoΦ belum mengaktifkan Mengantar untuk checkout. Ongkir memakai pengiriman standar TokoΦ.", fix: null };
  }
  if (i.state !== "connected") {
    return { active: false, reason: "Akun Mengantar toko belum terhubung, jadi ongkir memakai pengiriman standar TokoΦ.", fix: "akun" };
  }
  if (!i.hasPickupAddress) {
    return { active: false, reason: "Alamat pengambilan toko belum diisi — Mengantar tidak bisa menghitung ongkir tanpa itu.", fix: "alamat" };
  }
  if (!i.hasPickupArea) {
    return {
      active: false,
      reason: "Kecamatan/kelurahan alamat pengambilan belum dikenali Mengantar. Pilih ulang kelurahannya, atau ongkir tetap memakai pengiriman standar TokoΦ.",
      fix: "alamat",
    };
  }
  return { active: true, reason: null, fix: null };
}
