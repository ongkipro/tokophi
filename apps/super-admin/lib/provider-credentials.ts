import {
  KA_BASE,
  maskKey,
  resolveKiriminaja,
  type AutolarisConfig,
  type KiriminajaConfig,
  type ProviderEnv,
  type ProviderEnvVars,
  type ProviderRows,
} from "@tokophi/lib/provider-config";

// The DECISIONS behind Super Admin's provider-credential actions (Task 8.33), with every side
// effect injected — the same split as `payout-transition.ts`: `actions.ts` is `"use server"` with
// `@tokophi/db` at module scope and cannot be driven by a test, and the two rules here are worth a
// real test with a stubbed provider rather than a source-guard:
//
//   1. A key is STORED ONLY AFTER IT PASSED A LIVE TEST against the environment it is for. The
//      DB row wins over the env var, so storing an untested key for the active environment would
//      replace a working credential with a broken one on every replica within a minute.
//   2. The active environment is FLIPPED ONLY AFTER THE TARGET ENVIRONMENT'S KEY PASSED A LIVE
//      TEST. N35: a sandbox booking is shaped like a production one, so a switch onto a dead key
//      would read "dibooking" on every order while no courier ever collects.
//
// Every audit line names the OPERATOR'S E-MAIL and the key's MASKED TAIL. The plaintext key is a
// parameter here and nowhere else: it goes into the cipher and into the provider's test call.

export type ProviderId = "kiriminaja" | "autolaris";

export type CredentialResult = { ok: boolean; message: string };

export type CredentialDeps = {
  /** The decrypted rows, exactly as the runtime loader reads them (`loadProviderRows`). */
  rows: () => Promise<ProviderRows>;
  /** The container env — the fallback half of the precedence rule. */
  env: () => ProviderEnvVars;
  testKiriminaja: (cfg: KiriminajaConfig) => Promise<{ ok: boolean; message: string; provinces?: number }>;
  testAutolaris: (cfg: AutolarisConfig) => Promise<{ ok: boolean; message: string }>;
  writeKiriminajaKey: (env: ProviderEnv, key: string) => Promise<void>;
  markKiriminajaTested: (env: ProviderEnv) => Promise<void>;
  writeKiriminajaActiveEnv: (env: ProviderEnv) => Promise<void>;
  writeAutolarisKey: (key: string) => Promise<void>;
  markAutolarisTested: () => Promise<void>;
  /** `logPlatform` — one `platform_activity` row, platform-wide. */
  log: (text: string) => Promise<void>;
};

const KEY_MIN = 16;

/** A key is a single opaque token: trimmed, no inner whitespace, long enough to be one at all. */
export function keyError(key: string): string | null {
  const k = key.trim();
  if (!k) return "Kunci API kosong.";
  if (/\s/.test(k)) return "Kunci API tidak boleh mengandung spasi.";
  if (k.length < KEY_MIN) return `Kunci API terlalu pendek (minimal ${KEY_MIN} karakter).`;
  return null;
}

const ENV_LABEL: Record<ProviderEnv, string> = { sandbox: "sandbox", production: "production" };

/** Build the config the provider call would use for `env` with `key` — nothing read from the row. */
export const kiriminajaConfigFor = (env: ProviderEnv, key: string): KiriminajaConfig => ({
  env,
  envSource: "db",
  base: KA_BASE[env],
  key,
  keySource: "db",
});

/**
 * Store a provider key: validate → LIVE TEST against the target environment → encrypt + write →
 * stamp `tested_at` → audit. A failed test stores NOTHING and returns the provider's own sentence
 * (the operator is exactly who must read "Your IP address … were not allowed").
 */
export async function saveCredentials(
  deps: CredentialDeps,
  operatorEmail: string,
  provider: ProviderId,
  env: ProviderEnv,
  key: string,
): Promise<CredentialResult> {
  const err = keyError(key);
  if (err) return { ok: false, message: err };
  const k = key.trim();
  const tail = maskKey(k);

  if (provider === "kiriminaja") {
    const t = await deps.testKiriminaja(kiriminajaConfigFor(env, k));
    if (!t.ok) {
      await deps.log(`Kunci KiriminAja (${ENV_LABEL[env]}) ${tail} DITOLAK saat uji oleh ${operatorEmail} — tidak disimpan: ${t.message}`);
      return { ok: false, message: `Kunci tidak disimpan — uji koneksi ${ENV_LABEL[env]} gagal: ${t.message}` };
    }
    await deps.writeKiriminajaKey(env, k);
    await deps.markKiriminajaTested(env);
    await deps.log(`Kunci KiriminAja (${ENV_LABEL[env]}) diganti oleh ${operatorEmail}: ${tail} — uji koneksi OK${t.provinces != null ? ` (${t.provinces} provinsi)` : ""}`);
    return { ok: true, message: `Kunci ${ENV_LABEL[env]} ${tail} tersimpan dan teruji. ${t.message}` };
  }

  // AutoLaris has ONE environment (a single H2H base); `env` is accepted for the shared signature
  // and ignored. Its test creates a minimal QRIS bill — the same call "Test koneksi" always made.
  const base = deps.env().AUTOLARIS_BASE?.trim() || "https://api-h2h.autolaris.com";
  const t = await deps.testAutolaris({ base, key: k, keySource: "db" });
  if (!t.ok) {
    await deps.log(`Kunci AutoLaris ${tail} DITOLAK saat uji oleh ${operatorEmail} — tidak disimpan: ${t.message}`);
    return { ok: false, message: `Kunci tidak disimpan — uji koneksi gagal: ${t.message}` };
  }
  await deps.writeAutolarisKey(k);
  await deps.markAutolarisTested();
  await deps.log(`Kunci AutoLaris diganti oleh ${operatorEmail}: ${tail} — uji koneksi OK`);
  return { ok: true, message: `Kunci AutoLaris ${tail} tersimpan dan teruji. ${t.message}` };
}

/**
 * Re-test the key a slot currently resolves to (stored, or the env fallback) and re-stamp
 * `tested_at` when it is a stored one. Read-only apart from the stamp.
 */
export async function testStoredKey(deps: CredentialDeps, provider: ProviderId, env: ProviderEnv): Promise<CredentialResult> {
  const rows = await deps.rows();
  if (provider === "kiriminaja") {
    const cfg = resolveKiriminaja({ row: { ...rows.kiriminaja, activeEnv: env }, env: deps.env() });
    if (!cfg.key) return { ok: false, message: `Belum ada kunci ${ENV_LABEL[env]} — simpan dulu.` };
    const t = await deps.testKiriminaja(cfg);
    if (t.ok && cfg.keySource === "db") await deps.markKiriminajaTested(env);
    return { ok: t.ok, message: t.message };
  }
  const envVars = deps.env();
  const key = rows.autolaris?.key?.trim() || envVars.AUTOLARIS_API_KEY?.trim() || null;
  if (!key) return { ok: false, message: "Belum ada kunci AutoLaris — simpan dulu." };
  const t = await deps.testAutolaris({ base: envVars.AUTOLARIS_BASE?.trim() || "https://api-h2h.autolaris.com", key, keySource: rows.autolaris?.key ? "db" : "env" });
  if (t.ok && rows.autolaris?.key) await deps.markAutolarisTested();
  return { ok: t.ok, message: t.message };
}

/**
 * Flip the environment KiriminAja bookings go to. The TARGET environment's key (stored, or the env
 * fallback) is tested FIRST; a failure refuses the switch and writes nothing but the audit line.
 */
export async function switchKiriminajaEnv(deps: CredentialDeps, operatorEmail: string, target: ProviderEnv): Promise<CredentialResult> {
  const rows = await deps.rows();
  const current = resolveKiriminaja({ row: rows.kiriminaja, env: deps.env() });
  if (current.env === target) return { ok: true, message: `Lingkungan sudah ${ENV_LABEL[target]}.` };
  const cfg = resolveKiriminaja({ row: { ...rows.kiriminaja, activeEnv: target }, env: deps.env() });
  if (!cfg.key) {
    return { ok: false, message: `Tidak bisa beralih ke ${ENV_LABEL[target]}: belum ada kunci ${ENV_LABEL[target]}. Simpan dan uji kuncinya dulu.` };
  }
  const tail = maskKey(cfg.key);
  const t = await deps.testKiriminaja(cfg);
  if (!t.ok) {
    await deps.log(`Peralihan KiriminAja ${ENV_LABEL[current.env]} → ${ENV_LABEL[target]} DITOLAK untuk ${operatorEmail}: uji kunci ${tail} gagal — ${t.message}`);
    return { ok: false, message: `Tidak beralih — uji koneksi ${ENV_LABEL[target]} gagal: ${t.message}` };
  }
  await deps.writeKiriminajaActiveEnv(target);
  if (cfg.keySource === "db") await deps.markKiriminajaTested(target);
  await deps.log(`Lingkungan KiriminAja dialihkan ${ENV_LABEL[current.env]} → ${ENV_LABEL[target]} oleh ${operatorEmail} (kunci ${tail}, uji OK)`);
  return {
    ok: true,
    message:
      target === "production"
        ? `KiriminAja kini PRODUCTION (kunci ${tail}). Setiap booking mulai sekarang adalah pemesanan nyata yang ditagihkan.`
        : `KiriminAja kini SANDBOX (kunci ${tail}). Booking tidak lagi menjemput paket nyata.`,
  };
}
