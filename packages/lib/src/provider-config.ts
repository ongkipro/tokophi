// Provider configuration seam (Task 8.33, 2026-09-17): WHICH KiriminAja / AutoLaris key and WHICH
// environment the platform talks to, resolved from a DB row first and the container env second.
//
// Before this module the keys were module constants read from `process.env` at import time
// (`kiriminaja.ts` `ENV/BASE/KEY`, `autolaris.ts` `BASE/KEY`). Rotating a key or moving from the
// sandbox to production was a redeploy, and — N35 — a wrong `KIRIMINAJA_ENV` was invisible because a
// sandbox booking is shaped exactly like a production one. Super Admin now stores the keys encrypted
// (`shipping_aggregator.sandbox_key_enc` / `production_key_enc` / `active_env`,
// `platform_payment_gateways.credentials_enc`, migration 0111) and every consumer resolves through
// here.
//
// PRECEDENCE: a DB row with a key WINS over the env var; the env var is the FALLBACK so a deploy that
// has never opened the Super Admin card keeps working exactly as before. The environment follows the
// same rule: `active_env` from the row, else `KIRIMINAJA_ENV`, else `sandbox` (the env var's old
// default — the failure mode stays "sandbox", never "production").
//
// SHAPE: the resolver functions are PURE (no env, no DB, no `server-only`) so the precedence rule is
// table-tested. The DB read is INJECTED (`setProviderConfigLoader`, registered by `@tokophi/db` at
// import) because `packages/lib` must not import `packages/db` — the dependency runs the other way.
// A process that never registers a loader (unit tests, scripts) resolves from env alone, unchanged.
//
// CACHE: one in-process value with a 60 s TTL. `ka()` is called on every rate quote and every
// tracking poll; a DB round-trip per call would be the wrong trade, and a key rotation reaching a
// replica within a minute is the trade the operator was promised. `invalidateProviderConfig()` is
// called by the writers so the replica that took the write sees it at once.
//
// NEVER put a key VALUE anywhere but the resolved config. Logs, audit lines, screens and errors get
// `maskKey()` — the last four characters — and nothing else.

export type ProviderEnv = "sandbox" | "production";

export const PROVIDER_ENVS: readonly ProviderEnv[] = ["sandbox", "production"];

export const isProviderEnv = (v: unknown): v is ProviderEnv => v === "sandbox" || v === "production";

/** KiriminAja host per environment — the API is the same on both (owner ruling 2026-08-03). */
export const KA_BASE: Record<ProviderEnv, string> = {
  production: "https://client.kiriminaja.com",
  sandbox: "https://tdev.kiriminaja.com",
};

export const AUTOLARIS_DEFAULT_BASE = "https://api-h2h.autolaris.com";

/** The decrypted row (the loader decrypts; the resolver never sees ciphertext). */
export type KiriminajaRow = {
  activeEnv?: string | null;
  sandboxKey?: string | null;
  productionKey?: string | null;
};

export type AutolarisRow = { key?: string | null };

/** The env vars the seam still honours, passed in rather than read — a pure function has no `process`. */
export type ProviderEnvVars = {
  KIRIMINAJA_ENV?: string;
  KIRIMINAJA_API_KEY?: string;
  AUTOLARIS_API_KEY?: string;
  AUTOLARIS_BASE?: string;
};

/** Where a resolved value came from — surfaced on the Super Admin card, never guessed from the value. */
export type ConfigSource = "db" | "env" | "none";

export type KiriminajaConfig = {
  env: ProviderEnv;
  /** Which side decided `env`: the row's `active_env`, the env var, or the sandbox default. */
  envSource: "db" | "env" | "default";
  base: string;
  key: string | null;
  keySource: ConfigSource;
};

export type AutolarisConfig = {
  base: string;
  key: string | null;
  keySource: ConfigSource;
};

export type ProviderConfig = {
  kiriminaja: KiriminajaConfig;
  autolaris: AutolarisConfig;
};

const nonEmpty = (v: string | null | undefined): string | null => (v && v.trim().length > 0 ? v.trim() : null);

export function resolveKiriminaja(input: { row: KiriminajaRow | null | undefined; env: ProviderEnvVars }): KiriminajaConfig {
  const { row, env } = input;
  let envName: ProviderEnv = "sandbox";
  let envSource: KiriminajaConfig["envSource"] = "default";
  if (isProviderEnv(row?.activeEnv)) {
    envName = row.activeEnv;
    envSource = "db";
  } else if (isProviderEnv(env.KIRIMINAJA_ENV)) {
    envName = env.KIRIMINAJA_ENV;
    envSource = "env";
  }
  const rowKey = nonEmpty(envName === "production" ? row?.productionKey : row?.sandboxKey);
  const envKey = nonEmpty(env.KIRIMINAJA_API_KEY);
  const key = rowKey ?? envKey;
  return {
    env: envName,
    envSource,
    base: KA_BASE[envName],
    key,
    keySource: rowKey ? "db" : envKey ? "env" : "none",
  };
}

export function resolveAutolaris(input: { row: AutolarisRow | null | undefined; env: ProviderEnvVars }): AutolarisConfig {
  const rowKey = nonEmpty(input.row?.key);
  const envKey = nonEmpty(input.env.AUTOLARIS_API_KEY);
  return {
    base: nonEmpty(input.env.AUTOLARIS_BASE) ?? AUTOLARIS_DEFAULT_BASE,
    key: rowKey ?? envKey,
    keySource: rowKey ? "db" : envKey ? "env" : "none",
  };
}

export type ProviderRows = { kiriminaja: KiriminajaRow | null; autolaris: AutolarisRow | null };

export function resolveProviderConfig(rows: ProviderRows | null, env: ProviderEnvVars): ProviderConfig {
  return {
    kiriminaja: resolveKiriminaja({ row: rows?.kiriminaja, env }),
    autolaris: resolveAutolaris({ row: rows?.autolaris, env }),
  };
}

/**
 * The ONLY representation of a key that may leave this module's callers: the last four characters.
 * `—` for nothing stored. A key shorter than eight characters is masked entirely — four visible
 * characters of a six-character string is most of it.
 */
export function maskKey(key: string | null | undefined): string {
  const k = nonEmpty(key);
  if (!k) return "—";
  if (k.length < 8) return "…";
  return `…${k.slice(-4)}`;
}

// ---------------------------------------------------------------------------------------------
// The injectable loader + the 60 s cache.

export type ProviderConfigLoader = () => Promise<ProviderRows>;

export const PROVIDER_CONFIG_TTL_MS = 60_000;

let loader: ProviderConfigLoader | null = null;
// What is cached is the DB READ (the rows, or `null` for a failed/empty read) — never the merged
// result. The env half is re-read on every resolve: it is a property lookup, and caching it would
// make a changed env var invisible for a minute for no gain (and would pin a test's env edits).
let cache: { rows: ProviderRows | null; at: number } | null = null;
let inFlight: Promise<ProviderConfig> | null = null;

/** Registered once by `@tokophi/db` (which owns the query + the decrypt). `null` = env only. */
export function setProviderConfigLoader(fn: ProviderConfigLoader | null): void {
  loader = fn;
  cache = null;
  inFlight = null;
}

/** Drop the cached value — the writers call this so the replica that took the write sees it now. */
export function invalidateProviderConfig(): void {
  cache = null;
  inFlight = null;
}

const envVars = (): ProviderEnvVars => ({
  KIRIMINAJA_ENV: process.env.KIRIMINAJA_ENV,
  KIRIMINAJA_API_KEY: process.env.KIRIMINAJA_API_KEY,
  AUTOLARIS_API_KEY: process.env.AUTOLARIS_API_KEY,
  AUTOLARIS_BASE: process.env.AUTOLARIS_BASE,
});

/**
 * The resolved config: cached for `PROVIDER_CONFIG_TTL_MS`, loaded through the registered loader,
 * env-only when no loader is registered. A loader that THROWS (database down) falls back to env
 * and that fallback is cached for the TTL too — a provider outage must not turn every rate quote
 * into a second, failing database round-trip.
 */
export async function getProviderConfig(opts?: { now?: number }): Promise<ProviderConfig> {
  const now = opts?.now ?? Date.now();
  if (cache && now - cache.at < PROVIDER_CONFIG_TTL_MS) return resolveProviderConfig(cache.rows, envVars());
  if (!loader) return resolveProviderConfig(null, envVars());
  if (inFlight) return inFlight;
  const load = loader;
  inFlight = (async () => {
    let rows: ProviderRows | null = null;
    try {
      rows = await load();
    } catch (e) {
      console.error("[provider-config] loader failed; falling back to env for this TTL:", e instanceof Error ? e.message : e);
    }
    cache = { rows, at: now };
    return resolveProviderConfig(rows, envVars());
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * For the SYNCHRONOUS callers (`kiriminajaConfigured()` / `autolarisConfigured()`, read in render
 * paths and route guards that were never async). Returns the cached value when one exists — even a
 * stale one — and env-only before the first load, kicking the async load off in the background so
 * the next call sees the row. A sync caller can never be handed a database read; this is the
 * honest best it can get, and the async `getProviderConfig()` is what every network call uses.
 */
export function providerConfigSync(): ProviderConfig {
  if (cache) {
    if (Date.now() - cache.at >= PROVIDER_CONFIG_TTL_MS) void getProviderConfig().catch(() => {});
    return resolveProviderConfig(cache.rows, envVars());
  }
  if (loader) void getProviderConfig().catch(() => {});
  return resolveProviderConfig(null, envVars());
}

// Brand-free accessors for the CLIENT-FACING apps. `provider-label.test.ts` (ADR 0004) scans
// `apps/admin` for a bare vendor name, and after tokenisation `cfg . kiriminaja . env` carries one;
// these keep the vendor's name in this package, where the operator-facing code lives.

/** The environment KiriminAja bookings currently go to. */
export const activeKaEnv = async (): Promise<ProviderEnv> => (await getProviderConfig()).kiriminaja.env;

/** The key KiriminAja calls currently carry (the webhook's bearer must equal it). `null` = none anywhere. */
export const activeKaKey = async (): Promise<string | null> => (await getProviderConfig()).kiriminaja.key;

/** For `api/health/env`: which SIDE each key resolves from and which env is live — never a value, never a tail. */
export async function providerHealthSummary(): Promise<{
  kiriminaja: { env: ProviderEnv; envSource: KiriminajaConfig["envSource"]; key: ConfigSource };
  autolaris: { key: ConfigSource };
}> {
  const cfg = await getProviderConfig();
  return {
    kiriminaja: { env: cfg.kiriminaja.env, envSource: cfg.kiriminaja.envSource, key: cfg.kiriminaja.keySource },
    autolaris: { key: cfg.autolaris.keySource },
  };
}

/** Test seam: what the module currently holds, without triggering a load. */
export function _providerConfigCacheForTests(): { cached: boolean; hasLoader: boolean } {
  return { cached: cache !== null, hasLoader: loader !== null };
}
