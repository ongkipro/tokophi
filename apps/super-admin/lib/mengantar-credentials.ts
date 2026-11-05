import {
  maskKey,
  resolveMengantar,
  resolveShippingProvider,
  SHIPPING_PROVIDERS,
  isProviderEnv,
  type MengantarPartnerConfig,
  type ProviderEnv,
  type ProviderEnvVars,
  type ProviderRows,
  type ShippingProvider,
} from "@tokophi/lib/provider-config";
import { keyError, type CredentialResult } from "./provider-credentials";

// Mengantar Partner Business API (0116) — the DECISIONS behind Super Admin's Mengantar card and the
// platform shipping-provider switch, every side effect injected (same split as `provider-credentials.ts`:
// `actions.ts` is `"use server"` with `@tokophi/db` at module scope and cannot be driven by a test).
//
// PARTNER MODEL: the platform no longer holds a Mengantar shipping key. It holds a PARTNER credential
// (partner id + partner secret, per environment) that registers one seller account PER STORE; each
// store's own key ships its parcels. So:
//   1. A partner credential is STORED ONLY AFTER A READ-ONLY PROBE PASSED (the seller list, page size 1)
//      — when the env has a known Partner origin. Production has none yet: the credential is stored and
//      the reply says it is untested (it cannot be tested until Mengantar names the origin).
//   2. The switch goes TO Mengantar only when the active env has a partner credential AND a Partner
//      origin. Stores that are not connected keep quoting the default provider (owner O6), so the switch
//      can never take checkout down. Switching BACK is never blocked.
//   3. A switch needs a written reason (≥5 characters); the audit line reports what the row holds AFTER
//      the write.
// The plaintext secret is a parameter here and nowhere else; audit lines carry `maskKey()`'s tail.

/** A read-only probe result, restated so this module never imports provider code. */
type Probe = { ok: true } | { ok: false; error: string };

export type MengantarDeps = {
  rows: () => Promise<ProviderRows>;
  env: () => ProviderEnvVars;
  /** Read-only partner probe with THIS config (seller list, size 1). */
  testPartner: (cfg: MengantarPartnerConfig) => Promise<Probe>;
  writePartner: (env: ProviderEnv, partnerId: string, secret: string) => Promise<void>;
  /** Returns the value the row holds AFTER the write. */
  writeActiveProvider: (p: ShippingProvider) => Promise<string>;
  log: (text: string) => Promise<void>;
};

const PROVIDER_LABEL: Record<ShippingProvider, string> = { kiriminaja: "KiriminAja", mengantar: "Mengantar" };
export const SWITCH_REASON_MIN = 5;
const PARTNER_ID_RE = /^[A-Za-z0-9_.-]{2,64}$/;

export const isShippingProvider = (v: unknown): v is ShippingProvider => (SHIPPING_PROVIDERS as readonly unknown[]).includes(v);

/** The partner config a probe with THESE values would use (origin from the env table, nothing from the row). */
function configFor(deps: MengantarDeps, env: ProviderEnv, partnerId: string, secret: string): MengantarPartnerConfig {
  return { ...resolveMengantar({ row: null, env: { ...deps.env(), MENGANTAR_ENV: env } }), partnerId, partnerSecret: secret, source: "db" };
}

/** Store the partner credential for one env (validate → probe when possible → encrypt + write → audit). A failed probe stores NOTHING. */
export async function saveMengantarPartnerWith(deps: MengantarDeps, operatorEmail: string, env: string, partnerId: string, secret: string): Promise<CredentialResult> {
  if (!isProviderEnv(env)) return { ok: false, message: "Lingkungan Mengantar tidak dikenal." };
  const id = String(partnerId ?? "").trim();
  if (!PARTNER_ID_RE.test(id)) return { ok: false, message: "Partner ID tidak valid (2–64 karakter: huruf, angka, . _ -)." };
  const err = keyError(String(secret ?? ""));
  if (err) return { ok: false, message: err.replace("Kunci API", "Partner secret") };
  const s = secret.trim();
  const tail = maskKey(s);
  const cfg = configFor(deps, env, id, s);
  let tested = false;
  if (cfg.partnerBase) {
    const t = await deps.testPartner(cfg);
    if (!t.ok) {
      await deps.log(`Kredensial Partner Mengantar ${env} (${id}, ${tail}) DITOLAK saat uji oleh ${operatorEmail} — tidak disimpan: ${t.error}`);
      return { ok: false, message: `Kredensial tidak disimpan — uji Partner API gagal: ${t.error}` };
    }
    tested = true;
  }
  await deps.writePartner(env, id, s);
  await deps.log(`Kredensial Partner Mengantar ${env} diganti oleh ${operatorEmail}: partner ${id}, secret ${tail}${tested ? " — uji OK" : " — BELUM diuji (origin Partner API belum diketahui)"}`);
  return {
    ok: true,
    message: tested
      ? `Kredensial Partner Mengantar ${env} (${id}) tersimpan dan teruji.`
      : `Kredensial Partner Mengantar ${env} (${id}) tersimpan, tapi belum bisa diuji: origin Partner API ${env} belum diketahui.`,
  };
}

/** Readiness of the ACTIVE env for the switch (and for the card). */
export function mengantarReadiness(rows: ProviderRows, env: ProviderEnvVars): { ready: boolean; why: string | null; cfg: MengantarPartnerConfig } {
  const cfg = resolveMengantar({ row: rows.mengantar, env });
  // An UNSET `MENGANTAR_ENV` reads as sandbox (the safe default for a call), but switching real
  // checkouts onto it would price and "book" live orders in the sandbox — no courier ever comes, while
  // the buyer's ongkir is passed through to the seller. The switch therefore needs the env NAMED.
  if (cfg.envSource !== "env") return { ready: false, why: "MENGANTAR_ENV belum diset di server (kosong dibaca sandbox) — set eksplisit 'sandbox' atau 'production' dulu.", cfg };
  if (!cfg.partnerBase) return { ready: false, why: `origin Partner API Mengantar untuk ${cfg.env} belum diketahui.`, cfg };
  if (!cfg.partnerId || !cfg.partnerSecret) return { ready: false, why: `kredensial Partner Mengantar (${cfg.env}) belum disimpan.`, cfg };
  return { ready: true, why: null, cfg };
}

/** Flip which provider quotes NEW checkouts of CONNECTED stores. See rules 2 and 3 above. */
export async function switchShippingProviderWith(deps: MengantarDeps, operatorEmail: string, target: string, reason: string): Promise<CredentialResult> {
  if (!isShippingProvider(target)) return { ok: false, message: "Provider pengiriman tidak dikenal." };
  const why = String(reason ?? "").trim();
  if (why.length < SWITCH_REASON_MIN) return { ok: false, message: `Tulis alasan peralihan (minimal ${SWITCH_REASON_MIN} karakter) — alasannya masuk ke log aktivitas.` };
  const rows = await deps.rows();
  const current = resolveShippingProvider({ row: rows.shipping, env: deps.env() });
  if (current === target) return { ok: true, message: `Provider pengiriman sudah ${PROVIDER_LABEL[target]}.` };
  let note = "";
  if (target === "mengantar") {
    const r = mengantarReadiness(rows, deps.env());
    if (!r.ready) {
      await deps.log(`Peralihan provider pengiriman ${PROVIDER_LABEL[current]} → Mengantar DITOLAK untuk ${operatorEmail}: ${r.why}`);
      return { ok: false, message: `Tidak beralih ke Mengantar: ${r.why}` };
    }
    note = ` (partner ${r.cfg.partnerId}, ${r.cfg.env})`;
  }
  const written = await deps.writeActiveProvider(target);
  const outcome = isShippingProvider(written) ? PROVIDER_LABEL[written] : written;
  await deps.log(
    `Provider pengiriman dialihkan ${PROVIDER_LABEL[current]} → ${PROVIDER_LABEL[target]} oleh ${operatorEmail} — alasan: ${why}. ` +
      `Hasil tersimpan: ${outcome}${note}. Toko tanpa akun Mengantar terhubung dan semua pesanan COD tetap lewat KiriminAja; pesanan lama tetap di provider masing-masing.`,
  );
  if (written !== target) return { ok: false, message: `Penulisan tidak berlaku — provider tersimpan masih ${outcome}.` };
  return {
    ok: true,
    message:
      target === "mengantar"
        ? "Provider pengiriman kini Mengantar untuk toko yang akun Mengantar-nya terhubung. Toko lain dan semua COD tetap lewat KiriminAja."
        : "Provider pengiriman kini KiriminAja untuk semua checkout baru. Pesanan Mengantar yang sudah ada tetap dilacak lewat akun Mengantar tokonya.",
  };
}
