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
  /** `store_mengantar_accounts.last_error_code` — splits `pending` into "waiting on the owner" vs "waiting on us". */
  lastErrorCode?: string | null;
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
  if (i.state !== "connected") return accountNotReady(i.state, i.lastErrorCode ?? null);
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

const STANDARD = "ongkir memakai pengiriman standar TokoΦ";

/**
 * `fix: "akun"` only where a click by the owner can change the outcome — `none`, `failed`, a `pending` row
 * waiting for the owner's consent, and `email_taken` (the owner's email is re-read live, so changing it and
 * connecting again is the way out). A row waiting on TokoΦ (approval, a retry already scheduled, a key
 * being rotated) or refused for review (`blocked`, which `sellerConnectRefusal` always refuses) gets
 * `fix: null`: telling the seller to connect there is a button that cannot work.
 */
function accountNotReady(state: string, code: string | null): MengantarReadiness {
  switch (state) {
    case "pending":
      if (code === "awaiting_consent") {
        return { active: false, reason: `Akun Mengantar toko menunggu persetujuan pemilik di Pengaturan → Pengiriman. Sementara itu ${STANDARD}.`, fix: "akun" };
      }
      if (code === "awaiting_approval") return { active: false, reason: `Akun Mengantar dibuat setelah toko disetujui TokoΦ. Sementara itu ${STANDARD}.`, fix: null };
      return { active: false, reason: `Akun Mengantar toko sedang didaftarkan otomatis. Sementara itu ${STANDARD}.`, fix: null };
    case "registering":
    case "rotating":
      return { active: false, reason: `Akun Mengantar toko sedang diproses. Sementara itu ${STANDARD}.`, fix: null };
    case "blocked":
      return { active: false, reason: `Akun Mengantar toko perlu ditinjau tim TokoΦ — hubungi dukungan TokoΦ. Sementara itu ${STANDARD}.`, fix: null };
    case "email_taken":
      return {
        active: false,
        reason: `Email pemilik toko sudah dipakai akun Mengantar lain. Ganti email login pemilik, lalu hubungkan lagi. Sementara itu ${STANDARD}.`,
        fix: "akun",
      };
  }
  return { active: false, reason: `Akun Mengantar toko belum terhubung, jadi ${STANDARD}.`, fix: "akun" };
}

/** The dashboard banner for a store that is NOT on Mengantar while the platform is. `null` = no banner. */
export type MengantarNotice = { title: string; body: string; href: string; cta: string };

/**
 * Shown only when there is something THIS viewer can fix: the platform already quotes through Mengantar
 * (`fix !== null` — a platform-level reason has `fix: null`) and the viewer may change Pengaturan
 * (`settings:write`, the capability both fixes require). An active store, a platform still on the
 * default provider, or a viewer who cannot act → no banner: a warning nobody can act on is noise.
 */
export function mengantarNotice(r: MengantarReadiness, canFix: boolean): MengantarNotice | null {
  if (r.active || r.fix === null || !canFix) return null;
  return r.fix === "akun"
    ? {
        title: "Hubungkan akun Mengantar toko",
        body: r.reason,
        href: "/pengaturan?section=pengiriman",
        cta: "Buka Pengaturan Pengiriman",
      }
    : {
        title: "Periksa alamat pengambilan toko",
        body: r.reason,
        href: "/pengaturan?section=alamat",
        cta: "Buka Alamat Pengambilan",
      };
}
