/**
 * WHAT THE RUNNING PROCESS ACTUALLY HAS — N60.
 *
 * ── THE FAILURE THIS EXISTS FOR, MEASURED 5→6 AUGUST ────────────────────────────────────────────
 *
 * `SIGNUP_ENABLED=true` was saved in Coolify at 17:03 UTC. Deployment #368 had started at 16:59 —
 * Coolify snapshots the environment when a deployment BEGINS — so the generated compose read
 * `SIGNUP_ENABLED: ''`. Containers came up healthy, all four hosts answered 200/307, `/daftar`
 * stayed shut, and **nothing anywhere said the value had not arrived**. It was found only because
 * somebody ran `docker exec … printenv` by hand. The same class had already happened in #154, where
 * the variable was not forwarded in `docker-compose.coolify.yml` at all.
 *
 * ⚠️ AND COMPOSE IS NOT THE SOURCE OF TRUTH — measured 2026-08-06: the running admin container holds
 * **56** variables, including `ADMIN_URL`, `STOREFRONT_BASE_DOMAIN` and `POSTGRES_PASSWORD`, none of
 * which appear in the `admin:` block of `docker-compose.coolify.yml`. Coolify injects its app-level
 * variables into every service on top of the compose interpolation. So a checker that reads compose
 * would describe a world nobody runs in. This reads `process.env` inside the live process instead.
 *
 * ── WHY REQUIRED/OPTIONAL IS THE LOAD-BEARING DISTINCTION ───────────────────────────────────────
 *
 * A list that flags every empty variable is noise, and noise is how a check stops being read. Half
 * of these are SUPPOSED to be empty: `SIGNUP_ENABLED` empty means signup is closed on purpose,
 * `GOOGLE_CLIENT_ID` empty means the button is hidden — both are honest states, not faults. Only
 * `required` ones make `ok` false.
 *
 * 🔴 NEVER report a value. Half this list is credentials. Presence and absence are facts an operator
 * needs; the value is one screenshot away from being leaked.
 */
export type EnvCheck = { name: string; present: boolean; required: boolean; why: string };

/**
 * Every variable this app reads, classified. Derived from the SINK — `apps/admin/lib/env-census.test.ts`
 * scans the source for `process.env.X` and fails until a new one is classified here, so this cannot
 * quietly fall behind the code (the same shape as `rbac-census.test.ts`).
 */
export const ENV_CHECKS: Record<string, { required: boolean; why: string }> = {
  DATABASE_URL: { required: true, why: "Setiap baca/tulis. Kosong = aplikasi tidak jalan sama sekali." },
  AUTH_SECRET: { required: true, why: "Menandatangani cookie sesi. Kosong di produksi = login mati." },
  CRON_SECRET: { required: true, why: "Gerbang semua route cron — kosong berarti route-nya menolak semua (fail closed), jadi resi berhenti terbit sendiri." },
  INTEGRATION_TOKEN_KEY: { required: true, why: "Kunci enkripsi token CAPI di store_tracking_channels. Kosong = token tersimpan tak bisa dibaca." },

  KIRIMINAJA_API_KEY: { required: true, why: "Tanpa ini tidak ada tarif ongkir sama sekali — dan tanpa tarif, tidak ada pesanan." },
  KIRIMINAJA_ENV: { required: true, why: "sandbox vs production. Salah setel TIDAK terlihat: booking sandbox berbentuk identik, tapi tak ada kurir yang menjemput." },
  KIRIMINAJA_ORDER_PREFIX: { required: false, why: "Prefiks nomor order ke kurir. Kosong = tanpa prefiks, sah." },

  AUTOLARIS_BASE: { required: true, why: "Basis URL PSP. Ada default di compose, tapi kosong berarti pembayaran menunjuk ke mana-mana." },
  AUTOLARIS_API_KEY: { required: true, why: "Tanpa ini tidak ada VA/QRIS yang bisa dibuat — checkout prabayar mati." },
  AUTOLARIS_CALLBACK_SECRET: { required: true, why: "Memverifikasi callback pembayaran. Kosong = callback tak terverifikasi diterima atau ditolak, dua-duanya buruk." },

  PUBLIC_APP_URL: { required: false, why: "Dipakai untuk menyusun tautan absolut; ada fallback." },
  STOREFRONT_BASE_DOMAIN: { required: true, why: "Domain induk storefront merchant (<slug>.tokophi.id). Kosong = tautan storefront salah di seluruh panel." },
  CUSTOM_DOMAIN_CNAME_TARGET: { required: false, why: "Target CNAME yang ditampilkan ke merchant saat pasang domain sendiri; ada default." },
  CF_SAAS_ZONE_ID: { required: true, why: "Zone Cloudflare for SaaS (tokophi.cc). Kosong = domain terverifikasi tidak bisa didaftarkan untuk SSL." },
  CF_SAAS_API_TOKEN: { required: true, why: "Mendaftarkan dan memeriksa Custom Hostnames. Kosong = domain berhenti di aktivasi SSL." },
  MARKETING_URL: { required: false, why: "Ke mana wordmark di /login dan /daftar membawa orang keluar; default https://tokophi.com. Salah isi = jalan keluar dari pintu depan menunjuk ke tempat lain." },

  SIGNUP_ENABLED: { required: false, why: "KOSONG BERARTI PENDAFTARAN TERTUTUP — itu keadaan yang sah, bukan cacat. Justru variabel inilah yang gagal sampai pada 5–6 Agustus." },
  GOOGLE_CLIENT_ID: { required: false, why: "Kosong = tombol 'Daftar dengan Google' disembunyikan, dan itu default yang jujur." },
  GOOGLE_CLIENT_SECRET: { required: false, why: "Sepasang dengan CLIENT_ID; kosong = jalur Google mati, bukan rusak." },
  GOOGLE_REDIRECT_URI: { required: false, why: "Sepasang dengan CLIENT_ID." },
  META_GRAPH_API_VERSION: { required: false, why: "Versi Graph API untuk CAPI; ada default di kode." },
  CHECKOUT_RECOVERY_SECRET: { required: false, why: "Menandatangani tautan pemulihan keranjang; ada fallback ke AUTH_SECRET." },

  NODE_ENV: { required: false, why: "Disetel runtime, bukan oleh operator — didaftar agar sensusnya lengkap." },
};

/**
 * ⚠️ Ada yang dianggap ADA hanya kalau isinya bukan spasi kosong. Coolify menulis `VAR: ''` saat
 * nilainya belum sampai — persis yang terjadi 5 Agustus — jadi "terdefinisi" bukan jawaban yang
 * berguna; yang ditanya operator adalah "sudah terisi atau belum".
 */
export function checkEnv(): { ok: boolean; missing: string[]; checks: EnvCheck[] } {
  const checks: EnvCheck[] = Object.entries(ENV_CHECKS).map(([name, meta]) => ({
    name,
    present: Boolean(process.env[name]?.trim()),
    required: meta.required,
    why: meta.why,
  }));
  const missing = checks.filter((c) => c.required && !c.present).map((c) => c.name);
  return { ok: missing.length === 0, missing, checks };
}
